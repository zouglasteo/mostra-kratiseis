/* Mostra Κρατήσεις – app logic */
(function () {
'use strict';

var C = window.MOSTRA_CONFIG || {};
var CFG = {
  open: C.open || '12:30', lastArrival: C.lastArrival || '22:30', step: C.step || 15,
  closedDays: C.closedDays || [1], lunchEnds: C.lunchEnds || '17:00',
  capacity: C.capacity || 60, slotLimit: C.slotLimit || 20,
  tags: C.tags || ['Γενέθλια', 'Επέτειος', 'Αλλεργία']
};
var DEMO = !C.SUPABASE_URL || !C.SUPABASE_ANON_KEY;

var STATUS = {
  confirmed: { l: 'Επιβεβαιωμένη', i: '✓' },
  seated:    { l: 'Στο τραπέζι',   i: '●' },
  left:      { l: 'Έφυγε',         i: '↗' },
  cancelled: { l: 'Ακυρώθηκε',     i: '⦸' },
  noshow:    { l: 'Δεν ήρθε',      i: '!' }
};
var DAYS = ['Κυρ', 'Δευ', 'Τρί', 'Τετ', 'Πέμ', 'Παρ', 'Σάβ'];
var DAYS_LONG = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];

/* ---------------- helpers ---------------- */
var $ = function (id) { return document.getElementById(id); };
function pad(n) { return (n < 10 ? '0' : '') + n; }
function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function parseIso(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function mins(t) { var p = String(t || '0:0').split(':'); return (+p[0]) * 60 + (+p[1]); }
function hhmm(m) { return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
function phoneKey(p) { var d = String(p || '').replace(/\D/g, ''); return d.length > 8 ? d.slice(-8) : d; }
function fmtDate(s) { var d = parseIso(s); return DAYS[d.getDay()] + ' ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function toast(msg) { var t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 2400); }
function nowSlot() { var d = new Date(); var m = Math.round((d.getHours() * 60 + d.getMinutes()) / CFG.step) * CFG.step; return hhmm(m); }
function uid() { return (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2)); }

/* ================================================================
   DATA STORES – same interface for the real database and demo mode
   subscribeDay(date, onRows, onError) -> unsubscribe
   byPhone(key) -> Promise<rows>      save(id|null, row) -> Promise
   setStatus(id, status) -> Promise   remove(id) -> Promise
   all() -> Promise<rows>
   ================================================================ */
function fromDb(r) {
  return { id: r.id, date: r.date, time: r.time, name: r.name, phone: r.phone || '', phoneKey: r.phone_key || '',
    people: r.people, table: r.table_no || '', notes: r.notes || '', tags: r.tags || [], status: r.status,
    walkin: !!r.walkin, createdAt: r.created_at, updatedAt: r.updated_at };
}
function toDb(b) {
  return { date: b.date, time: b.time, name: b.name, phone: b.phone, phone_key: b.phoneKey, people: b.people,
    table_no: b.table, notes: b.notes, tags: b.tags, status: b.status, walkin: b.walkin };
}

function SupabaseStore(client) {
  var T = 'bookings';
  function check(res) { if (res.error) throw res.error; return res.data; }
  return {
    subscribeDay: function (date, onRows, onError) {
      var alive = true, timer = null;
      function load() {
        client.from(T).select('*').eq('date', date).then(function (res) {
          if (!alive) return;
          if (res.error) { onError(res.error); return; }
          onRows(res.data.map(fromDb));
        });
      }
      load();
      var ch = client.channel('bookings-' + date + '-' + Date.now())
        .on('postgres_changes', { event: '*', schema: 'public', table: T }, function (p) {
          var d1 = p.new && p.new.date, d0 = p.old && p.old.date;
          if (d1 === date || d0 === date || (!d1 && !d0)) { clearTimeout(timer); timer = setTimeout(load, 150); }
        })
        .subscribe();
      /* safety net: refresh every 60 s and when the phone wakes up */
      var iv = setInterval(load, 60000);
      function vis() { if (document.visibilityState === 'visible') load(); }
      document.addEventListener('visibilitychange', vis);
      return function () { alive = false; clearInterval(iv); clearTimeout(timer); document.removeEventListener('visibilitychange', vis); client.removeChannel(ch); };
    },
    byPhone: function (key) {
      return client.from(T).select('*').eq('phone_key', key).order('date', { ascending: false }).limit(50)
        .then(function (r) { return check(r).map(fromDb); });
    },
    save: function (id, b) {
      var q = id ? client.from(T).update(toDb(b)).eq('id', id) : client.from(T).insert(toDb(b));
      return q.then(check);
    },
    setStatus: function (id, status) { return client.from(T).update({ status: status }).eq('id', id).then(check); },
    remove: function (id) { return client.from(T).delete().eq('id', id).then(check); },
    all: function () {
      var out = [], size = 1000;
      function page(from) {
        return client.from(T).select('*').order('date').order('time').range(from, from + size - 1).then(function (r) {
          var rows = check(r); out = out.concat(rows.map(fromDb));
          return rows.length === size ? page(from + size) : out;
        });
      }
      return page(0);
    }
  };
}

function DemoStore() {
  var KEY = 'mostra-demo-bookings', subs = [];
  function read() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }
  function write(rows) { try { localStorage.setItem(KEY, JSON.stringify(rows)); } catch (e) {} subs.forEach(function (f) { f(); }); }
  window.addEventListener('storage', function (e) { if (e.key === KEY) subs.forEach(function (f) { f(); }); });
  return {
    subscribeDay: function (date, onRows) {
      function emit() { onRows(read().filter(function (b) { return b.date === date; })); }
      subs.push(emit); setTimeout(emit, 0);
      return function () { subs = subs.filter(function (f) { return f !== emit; }); };
    },
    byPhone: function (key) { return Promise.resolve(read().filter(function (b) { return b.phoneKey === key; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; })); },
    save: function (id, b) {
      var rows = read(), now = new Date().toISOString();
      if (id) rows = rows.map(function (r) { return r.id === id ? Object.assign({}, r, b, { id: id, updatedAt: now }) : r; });
      else rows.push(Object.assign({}, b, { id: uid(), createdAt: now, updatedAt: now }));
      write(rows); return Promise.resolve();
    },
    setStatus: function (id, status) { write(read().map(function (r) { return r.id === id ? Object.assign({}, r, { status: status }) : r; })); return Promise.resolve(); },
    remove: function (id) { write(read().filter(function (r) { return r.id !== id; })); return Promise.resolve(); },
    all: function () { return Promise.resolve(read()); }
  };
}

/* ---------------- state ---------------- */
var state = { date: iso(new Date()), period: 'all', q: '', bookings: [], loading: true, online: navigator.onLine, loadError: '' };
var client = null, store = null, unsub = null, loadTimer = null, current = null, editing = null, selTags = [], installPrompt = null;

/* ---------------- static UI setup ---------------- */
var times = []; for (var m = mins(CFG.open); m <= mins('23:00'); m += CFG.step) times.push(hhmm(m));
$('f-time').innerHTML = times.map(function (t) { return '<option value="' + t + '">' + t + '</option>'; }).join('');
$('f-tags').innerHTML = CFG.tags.map(function (t, i) { return '<button type="button" id="tag-' + i + '" data-tag="' + esc(t) + '" aria-pressed="false">' + esc(t) + '</button>'; }).join('');
$('limitLbl').textContent = 'όριο ' + CFG.slotLimit + ' άτομα';

/* ---------------- rendering ---------------- */
function visible() {
  var q = state.q.trim().toLowerCase(), qk = phoneKey(q);
  return state.bookings.filter(function (b) {
    var t = mins(b.time);
    if (state.period === 'lunch' && t >= mins(CFG.lunchEnds)) return false;
    if (state.period === 'dinner' && t < mins(CFG.lunchEnds)) return false;
    if (!q) return true;
    return String(b.name || '').toLowerCase().indexOf(q) >= 0 || (qk.length >= 3 && String(b.phoneKey || '').indexOf(qk) >= 0);
  }).sort(function (a, b) {
    var r = mins(a.time) - mins(b.time); if (r) return r;
    var o = { seated: 0, confirmed: 1, left: 2, noshow: 3, cancelled: 4 }; return (o[a.status] || 0) - (o[b.status] || 0);
  });
}
function notes() {
  var h = '', d = parseIso(state.date);
  if (DEMO) h += '<div class="note-bar demo">Δοκιμαστική λειτουργία: οι κρατήσεις μένουν μόνο σε αυτή τη συσκευή.</div>';
  if (!state.online) h += '<div class="note-bar bad">Χωρίς σύνδεση στο ίντερνετ. Βλέπετε την τελευταία λίστα που φορτώθηκε, και οι αλλαγές δεν θα αποθηκευτούν.</div>';
  if (state.loadError) h += '<div class="note-bar bad">' + esc(state.loadError) + '</div>';
  if (CFG.closedDays.indexOf(d.getDay()) >= 0) h += '<div class="note-bar bad">' + DAYS_LONG[d.getDay()] + ': το μαγαζί είναι κλειστό.</div>';
  $('notes').innerHTML = h;
}
function render() {
  var d = parseIso(state.date);
  $('dateLabel').textContent = fmtDate(state.date);
  $('todayBtn').hidden = state.date === iso(new Date());
  $('datePick').value = state.date;
  document.querySelectorAll('.seg button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.p === state.period); });
  notes();

  var live = state.bookings.filter(function (b) { return b.status !== 'cancelled' && b.status !== 'noshow'; });
  var exp = live.filter(function (b) { return b.status === 'confirmed'; });
  var seat = live.filter(function (b) { return b.status === 'seated'; });
  var sum = function (a) { return a.reduce(function (s, b) { return s + (+b.people || 0); }, 0); };
  var plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : many); };
  $('sExp').innerHTML = sum(exp) + '<span class="sub"> άτ.</span>';
  $('sExpR').textContent = 'Αναμένονται (' + exp.length + ')';
  $('sSeat').innerHTML = sum(seat) + '<span class="sub"> άτ.</span>';
  $('sSeatR').textContent = 'Στο τραπέζι (' + seat.length + ')';
  var tot = sum(live);
  $('sTot').innerHTML = tot + '<span class="sub"> / ' + CFG.capacity + '</span>';
  $('sTot').style.color = tot > CFG.capacity ? 'var(--bad)' : '';
  $('sTotR').textContent = 'Σύνολο (' + live.length + ')';

  /* half-hour arrival strip */
  var start = mins(CFG.open) - (mins(CFG.open) % 30), end = mins(CFG.lastArrival), slots = [];
  for (var s = start; s <= end; s += 30) slots.push({ m: s, p: 0 });
  live.forEach(function (b) { var t = mins(b.time); for (var i = slots.length - 1; i >= 0; i--) { if (t >= slots[i].m) { slots[i].p += (+b.people || 0); break; } } });
  var peak = Math.max(CFG.slotLimit * 1.25, Math.max.apply(null, slots.map(function (x) { return x.p; })));
  $('bars').innerHTML = slots.map(function (x) {
    var h = Math.round(x.p / peak * 100);
    return '<div class="bar' + (x.p > CFG.slotLimit ? ' over' : '') + (x.p ? '' : ' none') + '" style="--h:' + h + '%" title="' + hhmm(x.m) + ': ' + x.p + ' άτομα"><i style="height:' + h + '%"></i>' + (x.p ? '<em>' + x.p + '</em>' : '') + '</div>';
  }).join('');
  $('limitLine').style.bottom = (CFG.slotLimit / peak * 64) + 'px';
  $('ticks').innerHTML = slots.map(function (x) { return '<span>' + (x.m % 60 === 0 ? hhmm(x.m).slice(0, 2) : '') + '</span>'; }).join('');

  var list = $('list'), v = visible();
  if (state.loading && !state.bookings.length) { list.innerHTML = '<div class="empty"><b>Φόρτωση κρατήσεων…</b>Μια στιγμή.</div>'; return; }
  if (!v.length) {
    list.innerHTML = (state.q || state.period !== 'all')
      ? '<div class="empty"><b>Καμία κράτηση εδώ</b>Αλλάξτε την αναζήτηση ή την περίοδο.</div>'
      : '<div class="empty"><b>Καμία κράτηση για ' + esc(fmtDate(state.date)) + '</b>Πατήστε «+ Νέα κράτηση» όταν πάρει τηλέφωνο πελάτης.</div>';
    return;
  }
  list.innerHTML = v.map(function (b) {
    var st = STATUS[b.status] || STATUS.confirmed;
    var tags = (b.tags || []).map(function (t) { return '<span class="tag' + (/Αλλεργ|Γενέθλ|Επέτει/.test(t) ? ' hot' : '') + '">' + esc(t) + '</span>'; }).join('');
    return '<button type="button" class="bk ' + esc(b.status) + '" data-id="' + esc(b.id) + '">' +
      '<span class="t num">' + esc(b.time) + '</span>' +
      '<span class="who"><span class="name">' + esc(b.name || 'Χωρίς όνομα') + '</span>' +
      '<span class="meta"><span class="chip ' + esc(b.status) + '">' + st.i + ' ' + st.l + '</span>' +
      (b.table ? '<span>Τραπ. ' + esc(b.table) + '</span>' : '') + (b.walkin ? '<span>Walk-in</span>' : '') + tags + '</span>' +
      (b.notes ? '<span class="note">' + esc(b.notes) + '</span>' : '') + '</span>' +
      '<span class="ppl num">' + esc(b.people) + '<small>άτομα</small></span></button>';
  }).join('');
}

/* ---------------- data wiring ---------------- */
function errText(e) {
  var m = (e && (e.message || e.error_description)) || '';
  if (!navigator.onLine) return 'Χωρίς σύνδεση στο ίντερνετ.';
  if (/JWT|expired|not authorized|permission|401|403|row-level/i.test(m)) return 'Η σύνδεση έληξε. Αποσυνδεθείτε και μπείτε ξανά.';
  return 'Κάτι πήγε στραβά με τη βάση δεδομένων. Δοκιμάστε ξανά σε λίγο.';
}
function subscribe() {
  if (unsub) { unsub(); unsub = null; }
  state.loading = true; state.bookings = []; state.loadError = ''; render();
  clearTimeout(loadTimer);
  loadTimer = setTimeout(function () { if (state.loading) { state.loadError = 'Οι κρατήσεις δεν φορτώνουν ακόμα. Ελέγξτε τη σύνδεση στο ίντερνετ.'; render(); } }, 10000);
  var dateAtSub = state.date;
  unsub = store.subscribeDay(dateAtSub, function (rows) {
    if (dateAtSub !== state.date) return;
    state.bookings = rows; state.loading = false; state.loadError = ''; clearTimeout(loadTimer); render();
  }, function (e) {
    state.loading = false; clearTimeout(loadTimer); state.loadError = errText(e); render();
  });
}
function setStatus(b, status) {
  b.status = status; render(); /* optimistic */
  store.setStatus(b.id, status).then(function () { toast(b.name + ': ' + STATUS[status].l); })
    .catch(function (e) { toast(errText(e)); subscribe(); });
}

/* ---------------- sheets ---------------- */
var lastFocus = null;
function openSheet(id) { lastFocus = document.activeElement; $('scrim').hidden = false; $(id).hidden = false; }
function closeSheets() {
  $('scrim').hidden = true; ['actSheet', 'formSheet', 'menuSheet', 'itemSheet'].forEach(function (id) { $(id).hidden = true; });
  current = null; if (lastFocus && lastFocus.focus) try { lastFocus.focus({ preventScroll: true }); } catch (e) {}
}
$('scrim').addEventListener('click', closeSheets);
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheets(); });

function openActions(b) {
  current = b;
  $('actTitle').textContent = b.time + ' · ' + (b.name || 'Χωρίς όνομα');
  $('actSub').textContent = b.people + ' άτομα' + (b.table ? ' · τραπέζι ' + b.table : '') + (b.phone ? ' · ' + b.phone : '');
  function btn(id, cls, label, sub) { return '<button type="button" class="act ' + cls + '" id="' + id + '">' + label + (sub ? '<small>' + sub + '</small>' : '') + '</button>'; }
  var h = '';
  if (b.status !== 'seated' && b.status !== 'left') h += btn('a-seat', 'go wide', 'Ήρθε · στο τραπέζι', 'Σημειώνει την άφιξη');
  if (b.status === 'seated') h += btn('a-left', 'go wide', 'Έφυγε', 'Ελευθερώνει το τραπέζι');
  h += btn('a-edit', '', 'Επεξεργασία', 'Ώρα, άτομα, τραπέζι');
  h += b.phone ? '<a class="act" id="a-call" href="tel:' + esc(String(b.phone).replace(/[^\d+]/g, '')) + '">Κλήση<small class="num">' + esc(b.phone) + '</small></a>' : btn('a-edit2', '', 'Χωρίς τηλέφωνο', 'Προσθέστε στην επεξεργασία');
  if (b.status !== 'cancelled') h += btn('a-cancel', 'danger', 'Ακύρωση', 'Ο πελάτης ακύρωσε');
  if (b.status === 'confirmed') h += btn('a-noshow', 'danger', 'Δεν ήρθε', 'Μένει στο ιστορικό του');
  if (b.status !== 'confirmed') h += btn('a-confirm', '', 'Επαναφορά', 'Ξανά επιβεβαιωμένη');
  $('actBtns').innerHTML = h;
  openSheet('actSheet');
}
$('actBtns').addEventListener('click', function (e) {
  var t = e.target.closest('button'); if (!t || !current) return; var b = current;
  var map = { 'a-seat': 'seated', 'a-left': 'left', 'a-cancel': 'cancelled', 'a-noshow': 'noshow', 'a-confirm': 'confirmed' };
  if (map[t.id]) { closeSheets(); setStatus(b, map[t.id]); }
  else if (t.id === 'a-edit' || t.id === 'a-edit2') { closeSheets(); openForm(b); }
});
$('list').addEventListener('click', function (e) {
  var el = e.target.closest('.bk'); if (!el) return;
  var b = state.bookings.find(function (x) { return String(x.id) === el.dataset.id; }); if (b) openActions(b);
});

/* ---------------- booking form ---------------- */
function setTags(list) { selTags = list.slice(); document.querySelectorAll('#f-tags button').forEach(function (b) { b.setAttribute('aria-pressed', selTags.indexOf(b.dataset.tag) >= 0); }); }
$('f-tags').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; var t = b.dataset.tag, i = selTags.indexOf(t); if (i >= 0) selTags.splice(i, 1); else selTags.push(t); setTags(selTags); });

function openForm(b, opts) {
  opts = opts || {}; editing = b || null;
  $('formTitle').textContent = b ? 'Επεξεργασία κράτησης' : (opts.walkin ? 'Walk-in' : 'Νέα κράτηση');
  $('formSub').textContent = b ? 'Αλλάξτε ό,τι χρειάζεται και πατήστε Αποθήκευση.' : (opts.walkin ? 'Πελάτες που ήρθαν χωρίς κράτηση.' : 'Συμπληρώστε όσο μιλάτε με τον πελάτη.');
  $('f-phone').value = b ? (b.phone || '') : '';
  $('f-name').value = b ? (b.name || '') : (opts.walkin ? 'Walk-in' : '');
  $('f-date').value = b ? b.date : state.date;
  var t = b ? b.time : (opts.walkin ? nowSlot() : '20:00');
  if (!Array.prototype.some.call($('f-time').options, function (o) { return o.value === t; })) { var o = document.createElement('option'); o.value = t; o.textContent = t; $('f-time').appendChild(o); }
  $('f-time').value = t;
  $('f-people').value = b ? b.people : 2;
  $('f-table').value = b ? (b.table || '') : '';
  $('f-notes').value = b ? (b.notes || '') : '';
  $('f-status').value = b ? b.status : (opts.walkin ? 'seated' : 'confirmed');
  setTags(b ? (b.tags || []) : []);
  $('delBtn').hidden = !b; $('delBtn').textContent = 'Διαγραφή'; $('delBtn').dataset.armed = '';
  $('formErr').hidden = true; $('formErr').dataset.okClosed = ''; $('history').hidden = true;
  $('formSheet').dataset.walkin = opts.walkin ? '1' : '';
  openSheet('formSheet');
  setTimeout(function () { (opts.walkin ? $('f-people') : (b ? $('f-name') : $('f-phone'))).focus(); }, 80);
  if (b && b.phone) lookup();
}
$('pMinus').addEventListener('click', function () { $('f-people').value = Math.max(1, (+$('f-people').value || 1) - 1); });
$('pPlus').addEventListener('click', function () { $('f-people').value = Math.min(99, (+$('f-people').value || 0) + 1); });
$('cancelForm').addEventListener('click', closeSheets);

/* customer history by phone */
var lkTimer = null, lkSeq = 0;
$('f-phone').addEventListener('input', function () { clearTimeout(lkTimer); lkTimer = setTimeout(lookup, 450); });
function lookup() {
  var k = phoneKey($('f-phone').value), box = $('history');
  if (k.length < 8) { box.hidden = true; return; }
  var seq = ++lkSeq;
  store.byPhone(k).then(function (rows) {
    if (seq !== lkSeq) return;
    rows = rows.filter(function (o) { return !editing || o.id !== editing.id; });
    box.hidden = false;
    if (!rows.length) { box.className = 'history'; box.textContent = 'Νέος πελάτης. Δεν υπάρχει άλλη κράτηση με αυτό το τηλέφωνο.'; return; }
    var came = rows.filter(function (r) { return r.status === 'seated' || r.status === 'left'; }).length;
    var ns = rows.filter(function (r) { return r.status === 'noshow'; }).length;
    var last = rows[0], note = rows.find(function (r) { return r.notes; });
    var nm = $('f-name').value.trim(); if (!nm || nm === 'Walk-in') $('f-name').value = last.name || '';
    box.className = 'history' + (ns ? ' warn' : '');
    box.innerHTML = '<b>' + esc(last.name || 'Πελάτης') + '</b> · ' + rows.length + (rows.length === 1 ? ' κράτηση' : ' κρατήσεις') + ', ήρθε ' + came + (ns ? ', <b>δεν ήρθε ' + ns + '</b>' : '') +
      '<br>Τελευταία: ' + esc(fmtDate(last.date)) + ' ' + esc(last.time) + ' · ' + esc(last.people) + ' άτομα' + (note ? '<br>Σημείωση: ' + esc(note.notes) : '');
  }).catch(function () { if (seq === lkSeq) box.hidden = true; });
}

$('bkForm').addEventListener('submit', function (e) {
  e.preventDefault();
  var err = $('formErr'); err.hidden = true;
  var name = $('f-name').value.trim(), phone = $('f-phone').value.trim(), people = parseInt($('f-people').value, 10);
  if (!name) { err.textContent = 'Γράψτε ένα όνομα.'; err.hidden = false; $('f-name').focus(); return; }
  if (!people || people < 1) { err.textContent = 'Τα άτομα πρέπει να είναι τουλάχιστον 1.'; err.hidden = false; return; }
  var date = $('f-date').value || state.date, time = $('f-time').value;
  var day = parseIso(date).getDay();
  if (!editing && CFG.closedDays.indexOf(day) >= 0 && !err.dataset.okClosed) {
    err.textContent = DAYS_LONG[day] + ': το μαγαζί είναι κλειστό. Πατήστε ξανά Αποθήκευση αν θέλετε να την περάσετε.'; err.hidden = false; err.dataset.okClosed = '1'; return;
  }
  if (!state.online) { err.textContent = 'Χωρίς σύνδεση στο ίντερνετ. Η κράτηση δεν αποθηκεύτηκε.'; err.hidden = false; return; }
  var row = { date: date, time: time, name: name, phone: phone, phoneKey: phoneKey(phone), people: people,
    table: $('f-table').value.trim(), notes: $('f-notes').value.trim(), tags: selTags.slice(), status: $('f-status').value,
    walkin: editing ? !!editing.walkin : !!$('formSheet').dataset.walkin };
  var btn = $('saveBtn'), wasEdit = !!editing; btn.disabled = true; btn.textContent = 'Αποθήκευση…';
  store.save(editing ? editing.id : null, row).then(function () {
    btn.disabled = false; btn.textContent = 'Αποθήκευση'; closeSheets();
    toast((wasEdit ? 'Αποθηκεύτηκε: ' : 'Νέα κράτηση: ') + name + ', ' + people + ' άτ., ' + fmtDate(date) + ' ' + time);
    if (date !== state.date) { state.date = date; subscribe(); }
  }).catch(function (e2) { btn.disabled = false; btn.textContent = 'Αποθήκευση'; err.textContent = errText(e2); err.hidden = false; });
});
$('delBtn').addEventListener('click', function () {
  var b = $('delBtn'); if (!editing) return;
  if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Σίγουρα; Πατήστε ξανά'; return; }
  var name = editing.name;
  store.remove(editing.id).then(function () { closeSheets(); toast('Διαγράφηκε: ' + name); })
    .catch(function (e) { $('formErr').textContent = errText(e); $('formErr').hidden = false; });
});

/* ---------------- top bar ---------------- */
function goTo(d) { state.date = d; subscribe(); }
function shift(n) { var d = parseIso(state.date); d.setDate(d.getDate() + n); goTo(iso(d)); }
$('prev').addEventListener('click', function () { shift(-1); });
$('next').addEventListener('click', function () { shift(1); });
$('datePick').addEventListener('change', function () { if (this.value) goTo(this.value); });
$('todayBtn').addEventListener('click', function () { goTo(iso(new Date())); });
document.querySelectorAll('.seg button').forEach(function (b) { b.addEventListener('click', function () { state.period = b.dataset.p; render(); }); });
$('q').addEventListener('input', function () { state.q = this.value; render(); });
$('add').addEventListener('click', function () { openForm(null); });
$('walkin').addEventListener('click', function () { var t = iso(new Date()); if (state.date !== t) goTo(t); openForm(null, { walkin: true }); });

/* swipe left/right on the list to change day */
(function () {
  var x0 = null, y0 = null;
  $('list').addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  $('list').addEventListener('touchend', function (e) {
    if (x0 === null) return; var dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
    if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 2) shift(dx < 0 ? 1 : -1);
  }, { passive: true });
})();

/* ---------------- menu ---------------- */
$('menuBtn').addEventListener('click', function () {
  $('menuSub').textContent = DEMO ? 'Δοκιμαστική λειτουργία (χωρίς βάση δεδομένων)' : ('Συνδεδεμένοι ως ' + (state.email || 'προσωπικό'));
  $('m-logout').hidden = DEMO;
  $('m-install').hidden = !installPrompt;
  openSheet('menuSheet');
});
$('m-logout').addEventListener('click', function () {
  closeSheets(); if (!client) return;
  client.auth.signOut().finally(function () { location.reload(); });
});
$('m-install').addEventListener('click', function () {
  closeSheets(); if (!installPrompt) return; installPrompt.prompt(); installPrompt = null;
});
window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installPrompt = e; });
$('m-export').addEventListener('click', function () {
  var b = $('m-export'); b.disabled = true;
  store.all().then(function (rows) {
    var cols = ['date', 'time', 'name', 'phone', 'people', 'table', 'status', 'walkin', 'tags', 'notes'];
    var head = ['Ημερομηνία', 'Ώρα', 'Όνομα', 'Τηλέφωνο', 'Άτομα', 'Τραπέζι', 'Κατάσταση', 'Walk-in', 'Ετικέτες', 'Σχόλια'];
    var q = function (v) { v = Array.isArray(v) ? v.join(', ') : (v === true ? 'ναι' : v === false ? '' : (v == null ? '' : String(v))); return '"' + v.replace(/"/g, '""') + '"'; };
    var lines = [head.map(q).join(';')].concat(rows.map(function (r) {
      return cols.map(function (c) { return q(c === 'status' ? (STATUS[r.status] || {}).l || r.status : r[c]); }).join(';');
    }));
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mostra-kratiseis-' + iso(new Date()) + '.csv';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    b.disabled = false; closeSheets(); toast('Εξήχθησαν ' + rows.length + ' κρατήσεις');
  }).catch(function (e) { b.disabled = false; toast(errText(e)); });
});

/* ---------------- online / offline, midnight ---------------- */
window.addEventListener('online', function () { state.online = true; subscribe(); });
window.addEventListener('offline', function () { state.online = false; render(); });
var lastToday = iso(new Date());
setInterval(function () { var t = iso(new Date()); if (t !== lastToday) { if (state.date === lastToday) goTo(t); lastToday = t; } else render(); }, 60000);

/* ================================================================
   MENU EDITOR – prices, availability, dishes (public site reads the same tables)
   ================================================================ */
var menu = { cats: [], items: [], q: '', soldOnly: false, editing: null, tags: [], avail: true, loaded: false };
function eur(n) { return '€' + Number(n).toFixed(2).replace('.', ','); }
function parsePrice(v) { v = String(v || '').replace('€', '').replace(/\s/g, '').replace(',', '.'); var n = Number(v); return v !== '' && isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null; }
function mvNote(html) { $('mvNotes').innerHTML = html ? '<div class="note-bar ' + (html.indexOf('!') === 0 ? 'bad' : 'info') + '">' + html.replace(/^!/, '') + '</div>' : ''; }
function loadMenu() {
  if (!client) { mvNote('!Το μενού επεξεργάζεται μόνο όταν η εφαρμογή είναι συνδεδεμένη με τη βάση δεδομένων.'); renderMenu(); return; }
  mvNote(menu.loaded ? '' : 'Φόρτωση μενού…');
  Promise.all([
    client.from('menu_categories').select('*').order('sort'),
    client.from('menu_items').select('*').order('sort')
  ]).then(function (r) {
    if (r[0].error || r[1].error) throw (r[0].error || r[1].error);
    menu.cats = r[0].data; menu.items = r[1].data; menu.loaded = true; mvNote(''); renderMenu();
  }).catch(function (e) { mvNote('!' + esc(errText(e))); });
}
function renderMenu() {
  var nq = menu.q.trim().toLowerCase(), h = '';
  menu.cats.forEach(function (c) {
    var rows = menu.items.filter(function (i) {
      return i.category_id === c.id && (!menu.soldOnly || !i.available) &&
        (!nq || (i.name_el + ' ' + i.name_en).toLowerCase().indexOf(nq) >= 0);
    });
    if (!rows.length) return;
    var off = rows.filter(function (i) { return !i.available; }).length;
    h += '<section class="mv-cat"><h2><span>' + esc(c.name_el) + '</span><span>' + rows.length + (off ? ' · ' + off + ' εκτός' : '') + '</span></h2><div class="mv-rows">' +
      rows.map(function (i) {
        return '<div class="mv-row' + (i.available ? '' : ' off') + '">' +
          '<button type="button" class="mv-edit" data-id="' + esc(i.id) + '"><span class="mv-name">' + esc(i.name_el) + '</span><span class="mv-sub">' + esc(i.name_en) + (i.available ? '' : ' · δεν εμφανίζεται') + '</span></button>' +
          '<span class="mv-price">' + eur(i.price) + '</span>' +
          '<button type="button" class="sw" role="switch" aria-checked="' + (!!i.available) + '" aria-label="Διαθέσιμο: ' + esc(i.name_el) + '" data-sw="' + esc(i.id) + '"></button></div>';
      }).join('') + '</div></section>';
  });
  if (!h) h = menu.loaded ? '<div class="empty"><b>' + (menu.soldOnly ? 'Όλα είναι διαθέσιμα' : 'Δεν βρέθηκε πιάτο') + '</b>' + (menu.soldOnly ? 'Κανένα πιάτο δεν είναι σημειωμένο ως εξαντλημένο.' : 'Δοκιμάστε άλλη λέξη.') + '</div>' : '';
  $('mvList').innerHTML = h;
  $('mvSoldOnly').setAttribute('aria-pressed', menu.soldOnly);
}
function showMenuView() { closeSheets(); $('appView').hidden = true; $('menuView').hidden = false; window.scrollTo(0, 0); loadMenu(); }
function hideMenuView() { $('menuView').hidden = true; $('appView').hidden = false; }
$('m-menu').addEventListener('click', showMenuView);
$('mvBack').addEventListener('click', hideMenuView);
$('mq').addEventListener('input', function () { menu.q = this.value; renderMenu(); });
$('mvSoldOnly').addEventListener('click', function () { menu.soldOnly = !menu.soldOnly; renderMenu(); });
$('mvList').addEventListener('click', function (e) {
  var sw = e.target.closest('[data-sw]');
  if (sw) {
    var it = menu.items.find(function (i) { return i.id === sw.dataset.sw; }); if (!it) return;
    var next = !it.available; it.available = next; renderMenu();
    client.from('menu_items').update({ available: next }).eq('id', it.id).then(function (r) {
      if (r.error) throw r.error; toast(it.name_el + (next ? ': ξανά στο μενού' : ': εξαντλήθηκε'));
    }).catch(function (er) { it.available = !next; renderMenu(); toast(errText(er)); });
    return;
  }
  var ed = e.target.closest('.mv-edit');
  if (ed) openItem(menu.items.find(function (i) { return i.id === ed.dataset.id; }));
});
function setItTags(t) { menu.tags = t.slice(); document.querySelectorAll('#it-tags button').forEach(function (b) { b.setAttribute('aria-pressed', menu.tags.indexOf(b.dataset.tag) >= 0); }); }
function setAvail(v) { menu.avail = v; $('it-avail').setAttribute('aria-pressed', v); $('it-avail').textContent = v ? 'Ναι, στο μενού' : 'Όχι, κρυμμένο'; }
$('it-tags').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; var t = b.dataset.tag, i = menu.tags.indexOf(t); if (i >= 0) menu.tags.splice(i, 1); else menu.tags.push(t); setItTags(menu.tags); });
$('it-avail').addEventListener('click', function () { setAvail(!menu.avail); });
function openItem(it) {
  if (!client) return;
  menu.editing = it || null;
  $('it-cat').innerHTML = menu.cats.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name_el) + '</option>'; }).join('');
  $('itTitle').textContent = it ? 'Επεξεργασία πιάτου' : 'Νέο πιάτο';
  $('it-cat').value = it ? it.category_id : (menu.cats[0] && menu.cats[0].id);
  $('it-name-el').value = it ? it.name_el : ''; $('it-name-en').value = it ? it.name_en : '';
  $('it-price').value = it ? Number(it.price).toFixed(2).replace('.', ',') : '';
  $('it-desc-el').value = it ? it.desc_el : ''; $('it-desc-en').value = it ? it.desc_en : '';
  setItTags(it ? (it.tags || []) : []); setAvail(it ? !!it.available : true);
  $('itDel').hidden = !it; $('itDel').textContent = 'Διαγραφή'; $('itDel').dataset.armed = ''; $('itErr').hidden = true;
  openSheet('itemSheet'); setTimeout(function () { $(it ? 'it-price' : 'it-name-el').focus(); }, 80);
}
$('mvAdd').addEventListener('click', function () { openItem(null); });
$('itCancel').addEventListener('click', closeSheets);
$('itForm').addEventListener('submit', function (e) {
  e.preventDefault();
  var err = $('itErr'); err.hidden = true;
  var name = $('it-name-el').value.trim(), price = parsePrice($('it-price').value), cat = $('it-cat').value;
  if (!name) { err.textContent = 'Γράψτε το όνομα στα ελληνικά.'; err.hidden = false; $('it-name-el').focus(); return; }
  if (price === null) { err.textContent = 'Η τιμή πρέπει να είναι αριθμός, π.χ. 7,50.'; err.hidden = false; $('it-price').focus(); return; }
  var row = { category_id: cat, name_el: name, name_en: $('it-name-en').value.trim(), desc_el: $('it-desc-el').value.trim(), desc_en: $('it-desc-en').value.trim(), price: price, tags: menu.tags.slice(), available: menu.avail };
  var ed = menu.editing;
  if (!ed || ed.category_id !== cat) {
    var max = menu.items.filter(function (i) { return i.category_id === cat; }).reduce(function (m, i) { return Math.max(m, i.sort || 0); }, 0);
    row.sort = max + 10;
  }
  var btn = $('itSave'); btn.disabled = true;
  var q = ed ? client.from('menu_items').update(row).eq('id', ed.id) : client.from('menu_items').insert(row);
  q.then(function (r) {
    btn.disabled = false; if (r.error) throw r.error;
    closeSheets(); toast((ed ? 'Αποθηκεύτηκε: ' : 'Προστέθηκε: ') + name + ' ' + eur(price)); loadMenu();
  }).catch(function (er) { btn.disabled = false; err.textContent = errText(er); err.hidden = false; });
});
$('itDel').addEventListener('click', function () {
  var b = $('itDel'), ed = menu.editing; if (!ed) return;
  if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Σίγουρα; Πατήστε ξανά'; return; }
  client.from('menu_items').delete().eq('id', ed.id).then(function (r) {
    if (r.error) throw r.error; closeSheets(); toast('Διαγράφηκε: ' + ed.name_el); loadMenu();
  }).catch(function (er) { $('itErr').textContent = errText(er); $('itErr').hidden = false; });
});

/* ---------------- login + boot ---------------- */
function showApp() { $('loginView').hidden = true; $('menuView').hidden = true; $('appView').hidden = false; subscribe(); }
function showLogin(msg) {
  $('appView').hidden = true; $('menuView').hidden = true; $('loginView').hidden = false;
  if (!C.STAFF_EMAIL) $('emailRow').hidden = false;
  $('l-email').value = C.STAFF_EMAIL || '';
  if (msg) { $('lErr').textContent = msg; $('lErr').hidden = false; }
  setTimeout(function () { ($('emailRow').hidden ? $('l-pass') : $('l-email')).focus(); }, 50);
}
$('otherAcc').addEventListener('click', function () { $('emailRow').hidden = false; $('l-email').value = ''; $('l-email').focus(); });
$('loginForm').addEventListener('submit', function (e) {
  e.preventDefault();
  var email = ($('emailRow').hidden ? C.STAFF_EMAIL : $('l-email').value).trim(), pass = $('l-pass').value;
  if (!email || !pass) { $('lErr').textContent = 'Γράψτε τον κωδικό.'; $('lErr').hidden = false; return; }
  $('lBtn').disabled = true; $('lBtn').textContent = 'Σύνδεση…'; $('lErr').hidden = true;
  client.auth.signInWithPassword({ email: email, password: pass }).then(function (res) {
    $('lBtn').disabled = false; $('lBtn').textContent = 'Είσοδος';
    if (res.error) { $('lErr').textContent = navigator.onLine ? 'Λάθος κωδικός. Δοκιμάστε ξανά.' : 'Χωρίς σύνδεση στο ίντερνετ.'; $('lErr').hidden = false; return; }
    $('l-pass').value = ''; state.email = res.data.user && res.data.user.email; showApp();
  });
});

function boot() {
  if (DEMO) { store = DemoStore(); showApp(); return; }
  if (!window.supabase || !window.supabase.createClient) {
    showLogin('Η εφαρμογή δεν μπόρεσε να φορτώσει τη βιβλιοθήκη της βάσης δεδομένων. Ελέγξτε τη σύνδεση και ανοίξτε την ξανά.');
    $('lBtn').disabled = true; return;
  }
  client = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  store = SupabaseStore(client);
  client.auth.getSession().then(function (res) {
    var s = res.data && res.data.session;
    if (s) { state.email = s.user && s.user.email; showApp(); } else showLogin();
  });
  client.auth.onAuthStateChange(function (ev) { if (ev === 'SIGNED_OUT') showLogin(); });
}
boot();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
}
})();
