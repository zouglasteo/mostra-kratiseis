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
    walkin: !!r.walkin, createdAt: r.created_at, updatedAt: r.updated_at,
    source: r.source || 'staff', email: r.email || '', ref: r.ref || '', reviewSentAt: r.review_sent_at || '' };
}
function toDb(b) {
  return { date: b.date, time: b.time, name: b.name, phone: b.phone, phone_key: b.phoneKey, people: b.people,
    table_no: b.table, notes: b.notes, tags: b.tags, status: b.status, walkin: b.walkin };
}

function onlineAlert(b) {
  toast('Νέα online κράτηση: ' + b.name + ', ' + b.people + ' άτ., ' + fmtDate(b.date) + ' ' + b.time);
  try { if (navigator.vibrate) navigator.vibrate([120, 60, 120]); } catch (e) {}
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
          if (p.eventType === 'INSERT' && p.new && p.new.source === 'online') onlineAlert(fromDb(p.new));
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
      (b.table ? '<span>Τραπ. ' + esc(b.table) + '</span>' : '') + (b.walkin ? '<span>Walk-in</span>' : '') + (b.source === 'online' ? '<span class="tag online">Online</span>' : '') + tags + '</span>' +
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
  $('scrim').hidden = true; $('tblPicker').hidden = true; ['actSheet', 'formSheet', 'menuSheet', 'itemSheet', 'custSheet', 'tblEdSheet'].forEach(function (id) { $(id).hidden = true; });
  current = null; if (lastFocus && lastFocus.focus) try { lastFocus.focus({ preventScroll: true }); } catch (e) {}
}
$('scrim').addEventListener('click', closeSheets);
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { if (!$('tblPicker').hidden) closePicker(); else closeSheets(); } });

function openActions(b) {
  current = b;
  $('actTitle').textContent = b.time + ' · ' + (b.name || 'Χωρίς όνομα');
  $('actSub').textContent = b.people + ' άτομα' + (b.table ? ' · τραπέζι ' + b.table : '') + (b.phone ? ' · ' + b.phone : '') + (b.source === 'online' ? ' · online, κωδικός ' + b.ref + (b.email ? ' · ' + b.email : '') : '');
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
  markPeople();
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
$('pMinus').addEventListener('click', function () { $('f-people').value = Math.max(1, (+$('f-people').value || 1) - 1); markPeople(); });
$('pPlus').addEventListener('click', function () { $('f-people').value = Math.min(99, (+$('f-people').value || 0) + 1); markPeople(); });
$('cancelForm').addEventListener('click', closeSheets);

/* customer history by phone */
var lkTimer = null, lkSeq = 0;
$('f-phone').addEventListener('input', function () { clearTimeout(lkTimer); lkTimer = setTimeout(lookup, 450); });
function lookup() {
  var k = phoneKey($('f-phone').value), box = $('history');
  if (k.length < 8) { box.hidden = true; return; }
  var seq = ++lkSeq;
  var cust = client ? client.from('customers').select('notes,tags').eq('phone_key', k).maybeSingle().then(function (r) { return r.data; }, function () { return null; }) : Promise.resolve(null);
  Promise.all([store.byPhone(k), cust]).then(function (res) {
    var rows = res[0], cu = res[1];
    if (seq !== lkSeq) return;
    rows = rows.filter(function (o) { return !editing || o.id !== editing.id; });
    box.hidden = false;
    if (!rows.length) { box.className = 'history'; box.textContent = 'Νέος πελάτης. Δεν υπάρχει άλλη κράτηση με αυτό το τηλέφωνο.'; return; }
    var today = iso(new Date());
    var came = rows.filter(function (r) { return r.status === 'seated' || r.status === 'left' || (r.status === 'confirmed' && r.date < today); }).length;
    var ns = rows.filter(function (r) { return r.status === 'noshow'; }).length;
    var last = rows[0], note = rows.find(function (r) { return r.notes; });
    var nm = $('f-name').value.trim(); if (!nm || nm === 'Walk-in') $('f-name').value = last.name || '';
    box.className = 'history' + (ns ? ' warn' : '');
    box.innerHTML = '<b>' + esc(last.name || 'Πελάτης') + '</b> · ' + rows.length + (rows.length === 1 ? ' κράτηση' : ' κρατήσεις') + ', ήρθε ' + came + (ns ? ', <b>δεν ήρθε ' + ns + '</b>' : '') +
      '<br>Τελευταία: ' + esc(fmtDate(last.date)) + ' ' + esc(last.time) + ' · ' + esc(last.people) + ' άτομα' + (note ? '<br>Σημείωση κράτησης: ' + esc(note.notes) : '') +
      (cu && cu.tags && cu.tags.length ? '<br><b>' + cu.tags.map(esc).join(' · ') + '</b>' : '') + (cu && cu.notes ? '<br>Για τον πελάτη: <b>' + esc(cu.notes) + '</b>' : '');
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

/* ---------------- people grid ---------------- */
(function () {
  var h = ''; for (var i = 1; i <= 24; i++) h += '<button type="button" data-n="' + i + '" aria-pressed="false">' + i + '</button>';
  $('pGrid').innerHTML = h;
})();
function markPeople() {
  var n = parseInt($('f-people').value, 10);
  document.querySelectorAll('#pGrid button').forEach(function (b) { b.setAttribute('aria-pressed', +b.dataset.n === n); });
}
$('pGrid').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; $('f-people').value = b.dataset.n; markPeople(); });
$('f-people').addEventListener('input', markPeople);

/* ---------------- tables (plan + picker + editor) ---------------- */
var TB = { list: [], loaded: false };
var SIT = C.tableMinutes || 120; /* a table counts as taken this many minutes around a booking */
var TB_KEY = 'mostra-demo-tables';
function sortTables(a) { return a.slice().sort(function (x, y) { return (x.sort || 0) - (y.sort || 0); }); }
function loadTables() {
  if (!client) {
    try { TB.list = JSON.parse(localStorage.getItem(TB_KEY) || 'null') || []; } catch (e) { TB.list = []; }
    if (!TB.list.length) TB.list = [1, 2, 3, 4, 5, 6, 7, 8].map(function (n, i) { return { id: uid(), zone: i < 4 ? 'Μέσα' : 'Έξω', name: String(n), min_people: 1, max_people: n % 2 ? 2 : 4, sort: i }; });
    TB.loaded = true; return Promise.resolve(TB.list);
  }
  return client.from('restaurant_tables').select('*').order('sort').then(function (r) {
    if (r.error) throw r.error; TB.list = r.data; TB.loaded = true; return TB.list;
  });
}
function tableNames(v) { return String(v || '').split(/\s*[+,&\/]\s*|\s+/).filter(Boolean); }
function zonesOf(list) { var z = []; list.forEach(function (t) { if (z.indexOf(t.zone) < 0) z.push(t.zone); }); return z; }
function dayBookings(date) {
  if (date === state.date && !state.loading) return Promise.resolve(state.bookings);
  if (!client) return store.all().then(function (r) { return r.filter(function (b) { return b.date === date; }); });
  return client.from('bookings').select('*').eq('date', date).then(function (r) { if (r.error) throw r.error; return r.data.map(fromDb); });
}

var tp = { zone: '', sel: [], day: [], people: 2, time: '20:00', date: '' };
function tpOpen() { return !$('tblPicker').hidden; }
function closePicker() { $('tblPicker').hidden = true; try { $('tblOpen').focus({ preventScroll: true }); } catch (e) {} }
function tableState(t) {
  var t0 = mins(tp.time), mine = tp.day.filter(function (b) {
    return (!editing || b.id !== editing.id) && (b.status === 'confirmed' || b.status === 'seated') && tableNames(b.table).indexOf(t.name) >= 0;
  }).sort(function (a, b) { return mins(a.time) - mins(b.time); });
  var busy = mine.some(function (b) { return Math.abs(mins(b.time) - t0) < SIT; });
  return { mine: mine, busy: busy, fit: !busy && tp.people >= t.min_people && tp.people <= t.max_people };
}
function renderPicker() {
  var zones = zonesOf(TB.list);
  $('tpZones').hidden = zones.length < 2;
  $('tpZones').innerHTML = zones.map(function (z) { return '<button type="button" data-z="' + esc(z) + '" aria-pressed="' + (z === tp.zone) + '">' + esc(z) + '</button>'; }).join('');
  var t0 = mins(tp.time);
  $('tpGrid').innerHTML = TB.list.filter(function (t) { return t.zone === tp.zone; }).map(function (t) {
    var s = tableState(t), sel = tp.sel.indexOf(t.name) >= 0;
    var lines = s.mine.slice(0, 3).map(function (b) {
      var hit = Math.abs(mins(b.time) - t0) < SIT;
      return '<span class="bk1' + (hit ? ' hit' : '') + '">' + esc(b.time) + ' ' + esc(String(b.name || '').split(' ')[0]) + ' ' + esc(b.people) + 'άτ</span>';
    }).join('') + (s.mine.length > 3 ? '<span class="bk1">+' + (s.mine.length - 3) + ' ακόμα</span>' : '') + (s.mine.length ? '' : '<span class="bk1 none">ελεύθερο</span>');
    var label = 'Τραπέζι ' + t.name + ', ' + t.min_people + ' έως ' + t.max_people + ' άτομα' + (s.busy ? ', πιασμένο εκείνη την ώρα' : s.fit ? ', προτείνεται' : '');
    return '<button type="button" class="tcard' + (sel ? ' sel' : s.busy ? ' busy' : s.fit ? ' fit' : '') + '" data-t="' + esc(t.name) + '" aria-pressed="' + sel + '" aria-label="' + esc(label) + '">' +
      '<b class="num">' + esc(t.name) + '</b><span class="cap num">(' + t.min_people + '-' + t.max_people + ')</span>' + lines + '</button>';
  }).join('');
  var seats = tp.sel.reduce(function (s, n) { var t = TB.list.find(function (x) { return x.name === n; }); return s + (t ? t.max_people : 0); }, 0);
  $('tpSum').textContent = 'Χωράνε ' + seats + '/' + tp.people;
  $('tpSum').className = 'sum' + (tp.sel.length && seats >= tp.people ? ' ok' : '');
  var other = tp.sel.filter(function (n) { var t = TB.list.find(function (x) { return x.name === n; }); return t && t.zone !== tp.zone; });
  $('tpHint').textContent = (tp.sel.length ? 'Επιλεγμένα: ' + tp.sel.join(' + ') + (other.length ? ' (και σε άλλη ζώνη)' : '') + '. ' : '') +
    'Πατήστε πολλά τραπέζια για να τα ενώσετε. Ένα τραπέζι θεωρείται πιασμένο ' + (SIT / 60) + ' ώρες γύρω από κάθε κράτηση.';
}
function openPicker() {
  tp.date = $('f-date').value || state.date; tp.time = $('f-time').value; tp.people = parseInt($('f-people').value, 10) || 1;
  $('tpSub').textContent = fmtDate(tp.date) + ' · ' + tp.time + ' · ' + tp.people + ' άτομα';
  $('tpGrid').innerHTML = '<p class="hint-sm">Φόρτωση…</p>'; $('tpZones').innerHTML = ''; $('tpSum').textContent = ''; $('tpHint').textContent = '';
  $('tblPicker').hidden = false;
  Promise.all([TB.loaded ? TB.list : loadTables(), dayBookings(tp.date)]).then(function (res) {
    tp.day = res[1];
    if (!TB.list.length) { $('tpGrid').innerHTML = ''; $('tpHint').textContent = 'Δεν έχουν οριστεί τραπέζια. Προσθέστε τα από ☰ → Τραπέζια.'; return; }
    tp.sel = tableNames($('f-table').value).filter(function (n) { return TB.list.some(function (t) { return t.name === n; }); });
    var first = TB.list.find(function (t) { return t.name === tp.sel[0]; }) || TB.list.find(function (t) { return tableState(t).fit; }) || TB.list[0];
    tp.zone = first.zone; renderPicker();
  }).catch(function (e) { $('tpGrid').innerHTML = '<p class="err">' + esc(errText(e)) + '</p>'; });
}
$('tblOpen').addEventListener('click', openPicker);
$('tpClose').addEventListener('click', closePicker);
$('tpZones').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; tp.zone = b.dataset.z; renderPicker(); });
$('tpGrid').addEventListener('click', function (e) {
  var b = e.target.closest('.tcard'); if (!b) return; var n = b.dataset.t, i = tp.sel.indexOf(n);
  if (i >= 0) tp.sel.splice(i, 1); else tp.sel.push(n); renderPicker();
});
$('tpSave').addEventListener('click', function () { $('f-table').value = tp.sel.join('+'); closePicker(); });
$('tpClear').addEventListener('click', function () { $('f-table').value = ''; closePicker(); });

/* editor */
var te = { rows: [], removed: [] };
function renderTe() {
  $('teZones').innerHTML = zonesOf(te.rows).map(function (z) { return '<option value="' + esc(z) + '">'; }).join('');
  $('teList').innerHTML = te.rows.map(function (r, i) {
    return '<div class="te-row"><input class="input" list="teZones" data-i="' + i + '" data-k="zone" value="' + esc(r.zone) + '" aria-label="Ζώνη">' +
      '<input class="input num" data-i="' + i + '" data-k="name" value="' + esc(r.name) + '" aria-label="Τραπέζι">' +
      '<input class="input num" type="number" inputmode="numeric" min="1" data-i="' + i + '" data-k="min_people" value="' + r.min_people + '" aria-label="Από άτομα">' +
      '<input class="input num" type="number" inputmode="numeric" min="1" data-i="' + i + '" data-k="max_people" value="' + r.max_people + '" aria-label="Έως άτομα">' +
      '<button type="button" class="x" data-del="' + i + '" aria-label="Αφαίρεση τραπεζιού ' + esc(r.name) + '">×</button></div>';
  }).join('') || '<p class="hint-sm">Κανένα τραπέζι ακόμα.</p>';
}
function openTablesEd() {
  closeSheets(); $('teErr').hidden = true;
  loadTables().catch(function () { return TB.list; }).then(function () {
    te.rows = TB.list.map(function (t) { return { id: t.id, zone: t.zone, name: t.name, min_people: t.min_people, max_people: t.max_people }; });
    te.removed = []; renderTe(); openSheet('tblEdSheet');
  });
}
$('m-tables').addEventListener('click', openTablesEd);
$('teList').addEventListener('input', function (e) {
  var el = e.target; if (el.dataset.i == null) return; var r = te.rows[+el.dataset.i];
  r[el.dataset.k] = /people/.test(el.dataset.k) ? parseInt(el.value, 10) || 0 : el.value;
});
$('teList').addEventListener('change', function (e) { if (e.target.dataset.k === 'zone') renderTe(); });
$('teList').addEventListener('click', function (e) {
  var b = e.target.closest('[data-del]'); if (!b) return; var r = te.rows.splice(+b.dataset.del, 1)[0];
  if (r && r.id) te.removed.push(r.id); renderTe();
});
$('teAdd').addEventListener('click', function () {
  var last = te.rows[te.rows.length - 1], max = te.rows.reduce(function (m, r) { return Math.max(m, parseInt(r.name, 10) || 0); }, 0);
  te.rows.push({ id: null, zone: last ? last.zone : 'Μέσα', name: String(max + 1), min_people: 1, max_people: 4 }); renderTe();
  var ins = $('teList').querySelectorAll('[data-k="name"]'); if (ins.length) ins[ins.length - 1].focus();
});
$('teCancel').addEventListener('click', closeSheets);
$('teSave').addEventListener('click', function () {
  var err = $('teErr'), seen = {}, bad = '';
  te.rows.forEach(function (r) {
    r.zone = String(r.zone || '').trim() || 'Μέσα'; r.name = String(r.name || '').trim();
    if (!r.name) bad = bad || 'Κάθε τραπέζι χρειάζεται αριθμό ή όνομα.';
    else if (/[\s+,&\/]/.test(r.name)) bad = bad || 'Το τραπέζι «' + r.name + '»: χωρίς κενά ή +.';
    else if (seen[r.name]) bad = bad || 'Το τραπέζι ' + r.name + ' υπάρχει δύο φορές.';
    else if (!(r.min_people >= 1) || !(r.max_people >= r.min_people)) bad = bad || 'Τραπέζι ' + r.name + ': το «Έως» πρέπει να είναι ίσο ή μεγαλύτερο από το «Από».';
    seen[r.name] = 1;
  });
  if (bad) { err.textContent = bad; err.hidden = false; return; }
  var rows = te.rows.map(function (r, i) { return { id: r.id || uid(), zone: r.zone, name: r.name, min_people: r.min_people, max_people: r.max_people, sort: i + 1 }; });
  var btn = $('teSave'); btn.disabled = true; err.hidden = true;
  var done = function () { btn.disabled = false; TB.list = sortTables(rows); TB.loaded = true; closeSheets(); toast('Αποθηκεύτηκαν ' + rows.length + ' τραπέζια'); };
  if (!client) { try { localStorage.setItem(TB_KEY, JSON.stringify(rows)); } catch (e) {} done(); return; }
  var del = te.removed.length ? client.from('restaurant_tables').delete().in('id', te.removed) : Promise.resolve({});
  Promise.resolve(del).then(function (r) {
    if (r && r.error) throw r.error; return rows.length ? client.from('restaurant_tables').upsert(rows) : {};
  }).then(function (r) { if (r && r.error) throw r.error; done(); })
    .catch(function (e) { btn.disabled = false; err.textContent = errText(e); err.hidden = false; });
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
    var cols = ['date', 'time', 'name', 'phone', 'email', 'people', 'table', 'status', 'source', 'walkin', 'tags', 'notes'];
    var head = ['Ημερομηνία', 'Ώρα', 'Όνομα', 'Τηλέφωνο', 'Email', 'Άτομα', 'Τραπέζι', 'Κατάσταση', 'Πηγή', 'Walk-in', 'Ετικέτες', 'Σχόλια'];
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
var menu = { cats: [], items: [], q: '', soldOnly: false, noAl: false, al: null, editing: null, tags: [], avail: true, loaded: false, photo: null };
var BUCKET = 'menu-photos';
var ALLERGENS = [['gluten','Γλουτένη'],['milk','Γάλα / λακτόζη'],['eggs','Αυγά'],['fish','Ψάρι'],['crustaceans','Οστρακοειδή'],['molluscs','Μαλάκια'],['nuts','Ξηροί καρποί'],['peanuts','Αράπικα φιστίκια'],['sesame','Σουσάμι'],['soy','Σόγια'],['celery','Σέλινο'],['mustard','Μουστάρδα'],['sulphites','Θειώδη'],['lupin','Λούπινο']];
$('it-al').innerHTML = ALLERGENS.map(function (a) { return '<button type="button" id="al-' + a[0] + '" data-al="' + a[0] + '" aria-pressed="false">' + a[1] + '</button>'; }).join('');
function setAl(list) {
  menu.al = list === null ? null : list.slice();
  document.querySelectorAll('#it-al button').forEach(function (b) { b.setAttribute('aria-pressed', !!menu.al && menu.al.indexOf(b.dataset.al) >= 0); });
  $('al-none').setAttribute('aria-pressed', !!menu.al && menu.al.length === 0);
  var st = $('al-status');
  if (menu.al === null) { st.textContent = 'Δεν έχουν συμπληρωθεί. Επιλέξτε ό,τι περιέχει το πιάτο, ή «Δεν περιέχει κανένα».'; st.className = 'al-status warn'; }
  else if (!menu.al.length) { st.textContent = 'Ελέγχθηκε: δεν περιέχει κανένα από τα 14 αλλεργιογόνα.'; st.className = 'al-status'; }
  else { st.textContent = 'Περιέχει ' + menu.al.length + (menu.al.length === 1 ? ' αλλεργιογόνο.' : ' αλλεργιογόνα.'); st.className = 'al-status'; }
}
$('it-al').addEventListener('click', function (e) {
  var b = e.target.closest('button'); if (!b) return;
  var l = menu.al ? menu.al.slice() : [], i = l.indexOf(b.dataset.al);
  if (i >= 0) l.splice(i, 1); else l.push(b.dataset.al);
  setAl(l.length ? l : null);
});
$('al-none').addEventListener('click', function () { setAl(menu.al && menu.al.length === 0 ? null : []); });
function photoUrl(path, thumb) { return path ? C.SUPABASE_URL + '/storage/v1/object/public/' + BUCKET + '/' + path + (thumb ? '-t' : '') + '.jpg' : ''; }
/* shrink a picked photo on the phone before upload: full 1200px + square 320px thumbnail */
function loadBitmap(file) {
  if (window.createImageBitmap) return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return createImageBitmap(file); });
  return new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = rej; i.src = URL.createObjectURL(file); });
}
function toJpeg(src, w, h, sx, sy, sw, sh) {
  var c = document.createElement('canvas'); c.width = w; c.height = h;
  var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
  return new Promise(function (res, rej) { c.toBlob(function (b) { b ? res(b) : rej(new Error('encode')); }, 'image/jpeg', 0.82); });
}
function preparePhoto(file) {
  return loadBitmap(file).then(function (bm) {
    var W = bm.width, H = bm.height, k = Math.min(1, 1200 / Math.max(W, H)), side = Math.min(W, H);
    return Promise.all([
      toJpeg(bm, Math.round(W * k), Math.round(H * k), 0, 0, W, H),
      toJpeg(bm, 320, 320, (W - side) / 2, (H - side) / 2, side, side)
    ]);
  }).then(function (b) { return { full: b[0], thumb: b[1] }; });
}
function showPhoto(src) {
  var img = $('it-photo-img');
  if (src) { img.src = src; img.hidden = false; $('it-photo-none').hidden = true; } else { img.removeAttribute('src'); img.hidden = true; $('it-photo-none').hidden = false; }
  $('it-photo-rm').hidden = !src;
  $('it-photo-pick-lbl').textContent = src ? 'Αλλαγή φωτογραφίας' : 'Επιλογή φωτογραφίας';
}
$('it-file').addEventListener('change', function () {
  var f = this.files && this.files[0]; this.value = ''; if (!f) return;
  if (!/^image\//.test(f.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)) { $('itErr').textContent = 'Διαλέξτε αρχείο εικόνας.'; $('itErr').hidden = false; return; }
  $('it-photo-pick-lbl').textContent = 'Επεξεργασία…';
  preparePhoto(f).then(function (p) {
    menu.photo.blobs = p; menu.photo.removed = false;
    if (menu.photo.preview) URL.revokeObjectURL(menu.photo.preview);
    menu.photo.preview = URL.createObjectURL(p.thumb); showPhoto(menu.photo.preview); $('itErr').hidden = true;
  }).catch(function () { showPhoto(menu.photo.preview || photoUrl(menu.photo.path, true)); $('itErr').textContent = 'Αυτή η φωτογραφία δεν διαβάζεται. Δοκιμάστε άλλη, ή τραβήξτε screenshot της και ανεβάστε εκείνο.'; $('itErr').hidden = false; });
});
$('it-photo-rm').addEventListener('click', function () { menu.photo.blobs = null; menu.photo.removed = true; showPhoto(''); });
function uploadPhoto(p) {
  var base = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  var st = client.storage.from(BUCKET), opt = { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false };
  return st.upload(base + '.jpg', p.full, opt).then(function (r) { if (r.error) throw r.error; return st.upload(base + '-t.jpg', p.thumb, opt); })
    .then(function (r) { if (r.error) throw r.error; return base; });
}
function removePhotoFiles(path) { if (path) client.storage.from(BUCKET).remove([path + '.jpg', path + '-t.jpg']).catch(function () {}); }
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
      return i.category_id === c.id && (!menu.soldOnly || !i.available) && (!menu.noAl || i.allergens == null) &&
        (!nq || (i.name_el + ' ' + i.name_en).toLowerCase().indexOf(nq) >= 0);
    });
    if (!rows.length) return;
    var off = rows.filter(function (i) { return !i.available; }).length;
    h += '<section class="mv-cat"><h2><span>' + esc(c.name_el) + '</span><span>' + rows.length + (off ? ' · ' + off + ' εκτός' : '') + '</span></h2><div class="mv-rows">' +
      rows.map(function (i) {
        return '<div class="mv-row' + (i.available ? '' : ' off') + (i.photo_path ? ' has-ph' : '') + '">' + (i.photo_path ? '<img class="mv-thumb" loading="lazy" alt="" src="' + esc(photoUrl(i.photo_path, true)) + '">' : '') +
          '<button type="button" class="mv-edit" data-id="' + esc(i.id) + '"><span class="mv-name">' + esc(i.name_el) + '</span><span class="mv-sub">' + esc(i.name_en) + (i.available ? '' : ' · δεν εμφανίζεται') + (i.allergens == null ? ' · <b style="color:var(--bad)">λείπουν αλλεργιογόνα</b>' : '') + '</span></button>' +
          '<span class="mv-price">' + eur(i.price) + '</span>' +
          '<button type="button" class="sw" role="switch" aria-checked="' + (!!i.available) + '" aria-label="Διαθέσιμο: ' + esc(i.name_el) + '" data-sw="' + esc(i.id) + '"></button></div>';
      }).join('') + '</div></section>';
  });
  if (!h) h = menu.loaded ? '<div class="empty"><b>' + (menu.noAl ? 'Όλα τα πιάτα έχουν αλλεργιογόνα' : menu.soldOnly ? 'Όλα είναι διαθέσιμα' : 'Δεν βρέθηκε πιάτο') + '</b>' + (menu.noAl ? 'Κάθε πιάτο έχει συμπληρωμένα αλλεργιογόνα.' : menu.soldOnly ? 'Κανένα πιάτο δεν είναι σημειωμένο ως εξαντλημένο.' : 'Δοκιμάστε άλλη λέξη.') + '</div>' : '';
  $('mvList').innerHTML = h;
  $('mvSoldOnly').setAttribute('aria-pressed', menu.soldOnly);
  $('mvNoAl').setAttribute('aria-pressed', menu.noAl);
  var missing = menu.items.filter(function (i) { return i.allergens == null; }).length;
  if (menu.loaded) mvNote(missing ? missing + (missing === 1 ? ' πιάτο δεν έχει' : ' πιάτα δεν έχουν') + ' ακόμα αλλεργιογόνα. Πατήστε «Χωρίς αλλεργ.» για να τα δείτε.' : '');
}
function showMenuView() { closeSheets(); $('appView').hidden = true; $('menuView').hidden = false; window.scrollTo(0, 0); loadMenu(); }
function hideMenuView() { $('menuView').hidden = true; $('appView').hidden = false; }
$('m-menu').addEventListener('click', showMenuView);
$('mvBack').addEventListener('click', hideMenuView);
$('mq').addEventListener('input', function () { menu.q = this.value; renderMenu(); });
$('mvSoldOnly').addEventListener('click', function () { menu.soldOnly = !menu.soldOnly; renderMenu(); });
$('mvNoAl').addEventListener('click', function () { menu.noAl = !menu.noAl; renderMenu(); });
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
  setItTags(it ? (it.tags || []) : []); setAvail(it ? !!it.available : true); setAl(it && Array.isArray(it.allergens) ? it.allergens : null);
  if (menu.photo && menu.photo.preview) URL.revokeObjectURL(menu.photo.preview);
  menu.photo = { path: it ? (it.photo_path || '') : '', blobs: null, removed: false, preview: '' };
  showPhoto(photoUrl(menu.photo.path, true));
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
  var row = { category_id: cat, name_el: name, name_en: $('it-name-en').value.trim(), desc_el: $('it-desc-el').value.trim(), desc_en: $('it-desc-en').value.trim(), price: price, tags: menu.tags.slice(), available: menu.avail, allergens: menu.al === null ? null : menu.al.slice() };
  var ed = menu.editing;
  if (!ed || ed.category_id !== cat) {
    var max = menu.items.filter(function (i) { return i.category_id === cat; }).reduce(function (m, i) { return Math.max(m, i.sort || 0); }, 0);
    row.sort = max + 10;
  }
  var btn = $('itSave'); btn.disabled = true; btn.textContent = menu.photo.blobs ? 'Ανέβασμα φωτογραφίας…' : 'Αποθήκευση…';
  var ph = menu.photo, oldPath = ph.path, newPath = null;
  var step = ph.blobs ? uploadPhoto(ph.blobs).then(function (p) { newPath = p; row.photo_path = p; }) : Promise.resolve();
  if (!ph.blobs && ph.removed) row.photo_path = '';
  step.then(function () {
    return ed ? client.from('menu_items').update(row).eq('id', ed.id) : client.from('menu_items').insert(row);
  }).then(function (r) {
    if (r.error) throw r.error;
    btn.disabled = false; btn.textContent = 'Αποθήκευση';
    if ((newPath || ph.removed) && oldPath) removePhotoFiles(oldPath);
    closeSheets(); toast((ed ? 'Αποθηκεύτηκε: ' : 'Προστέθηκε: ') + name + ' ' + eur(price)); loadMenu();
  }).catch(function (er) {
    if (newPath) removePhotoFiles(newPath);
    btn.disabled = false; btn.textContent = 'Αποθήκευση';
    err.textContent = (er && /size|exceed|mime|payload/i.test(er.message || '')) ? 'Η φωτογραφία δεν ανέβηκε. Δοκιμάστε άλλη φωτογραφία.' : errText(er); err.hidden = false;
  });
});
$('itDel').addEventListener('click', function () {
  var b = $('itDel'), ed = menu.editing; if (!ed) return;
  if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Σίγουρα; Πατήστε ξανά'; return; }
  client.from('menu_items').delete().eq('id', ed.id).then(function (r) {
    if (r.error) throw r.error; removePhotoFiles(ed.photo_path); closeSheets(); toast('Διαγράφηκε: ' + ed.name_el); loadMenu();
  }).catch(function (er) { $('itErr').textContent = errText(er); $('itErr').hidden = false; });
});

/* ================================================================
   CUSTOMERS – built from the bookings (grouped by phone), plus staff notes
   ================================================================ */
var cv = { rows: [], q: '', f: 'all', loaded: false, cur: null, tags: [] };
var CUST_TAGS = ['VIP', 'Φίλος του μαγαζιού', 'Αλλεργία', 'Προτιμά έξω', 'Προτιμά μέσα', 'Με παιδιά'];
$('cs-tags').innerHTML = CUST_TAGS.map(function (t, i) { return '<button type="button" id="ct-' + i + '" data-t="' + esc(t) + '" aria-pressed="false">' + esc(t) + '</button>'; }).join('');
function cvNote(h, bad) { $('cvNotes').innerHTML = h ? '<div class="note-bar ' + (bad ? 'bad' : 'info') + '">' + h + '</div>' : ''; }
function normTxt(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function loadCustomers() {
  if (!client) { cvNote('Οι πελάτες εμφανίζονται μόνο όταν η εφαρμογή είναι συνδεδεμένη με τη βάση δεδομένων.', true); return; }
  if (!cv.loaded) cvNote('Φόρτωση πελατών…');
  client.from('customer_overview').select('*').order('last_visit', { ascending: false, nullsFirst: false }).limit(5000).then(function (r) {
    if (r.error) throw r.error;
    cv.rows = r.data; cv.loaded = true; cvNote(''); renderCustomers();
  }).catch(function (e) { cvNote(esc(errText(e)), true); });
}
function renderCustomers() {
  var q = normTxt(cv.q.trim()), qd = cv.q.replace(/\D/g, '');
  var list = cv.rows.filter(function (c) {
    if (cv.f === 'regular' && c.visits < 3) return false;
    if (cv.f === 'noshow' && !c.noshows) return false;
    if (!q) return true;
    return normTxt(c.name).indexOf(q) >= 0 || (qd.length >= 3 && String(c.phone_key).indexOf(qd.slice(-8)) >= 0);
  });
  if (cv.f === 'regular') list.sort(function (a, b) { return b.visits - a.visits; });
  if (cv.f === 'noshow') list.sort(function (a, b) { return b.noshows - a.noshows; });
  $('cvCount').textContent = cv.rows.length + (cv.rows.length === 1 ? ' πελάτης' : ' πελάτες');
  document.querySelectorAll('[data-cf]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.cf === cv.f); });
  if (!cv.loaded) { $('cvList').innerHTML = ''; return; }
  if (!list.length) { $('cvList').innerHTML = '<div class="empty"><b>Δεν βρέθηκε πελάτης</b>' + (cv.q ? 'Δοκιμάστε άλλο όνομα ή τηλέφωνο.' : 'Οι πελάτες εμφανίζονται εδώ μόλις κάνουν κράτηση με τηλέφωνο.') + '</div>'; return; }
  $('cvList').innerHTML = list.slice(0, 300).map(function (c) {
    var meta = [];
    if (c.last_visit) meta.push('Τελευταία: ' + esc(fmtDate(c.last_visit)));
    if (c.upcoming) meta.push('<span class="chip">Επόμενη κράτηση</span>');
    if (c.noshows) meta.push('<span class="chip noshow">Δεν ήρθε ' + c.noshows + '</span>');
    (c.tags || []).forEach(function (t) { meta.push('<span class="tag' + (t === 'Αλλεργία' || t === 'VIP' ? ' hot' : '') + '">' + esc(t) + '</span>'); });
    if (c.notes) meta.push('📝');
    return '<button type="button" class="cv-row" data-k="' + esc(c.phone_key) + '"><span style="min-width:0"><span class="cv-name">' + esc(c.name || 'Χωρίς όνομα') + '</span>' +
      '<span class="cv-meta"><span class="num">' + esc(c.phone || '') + '</span>' + meta.join('') + '</span></span>' +
      '<span class="cv-visits num">' + c.visits + '<small>' + (c.visits === 1 ? 'επίσκεψη' : 'επισκέψεις') + '</small></span></button>';
  }).join('') + (list.length > 300 ? '<p class="hint-sm">Εμφανίζονται οι πρώτοι 300. Γράψτε όνομα ή τηλέφωνο για να βρείτε κάποιον άλλο.</p>' : '');
}
function showCustView() { closeSheets(); $('appView').hidden = true; $('custView').hidden = false; window.scrollTo(0, 0); loadCustomers(); renderCustomers(); }
function hideCustView() { $('custView').hidden = true; $('appView').hidden = false; }
$('m-cust').addEventListener('click', showCustView);
$('cvBack').addEventListener('click', hideCustView);
$('cq').addEventListener('input', function () { cv.q = this.value; renderCustomers(); });
document.querySelectorAll('[data-cf]').forEach(function (b) { b.addEventListener('click', function () { cv.f = b.dataset.cf; renderCustomers(); }); });
$('cvList').addEventListener('click', function (e) { var b = e.target.closest('.cv-row'); if (b) openCustomer(b.dataset.k); });

function setCustTags(t) { cv.tags = t.slice(); document.querySelectorAll('#cs-tags button').forEach(function (b) { b.setAttribute('aria-pressed', cv.tags.indexOf(b.dataset.t) >= 0); }); }
$('cs-tags').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; var t = b.dataset.t, i = cv.tags.indexOf(t); if (i >= 0) cv.tags.splice(i, 1); else cv.tags.push(t); setCustTags(cv.tags); });
function openCustomer(k) {
  var c = cv.rows.find(function (x) { return x.phone_key === k; }); if (!c) return;
  cv.cur = c;
  $('csName').textContent = c.name || 'Χωρίς όνομα';
  $('csSub').textContent = [c.phone, c.email].filter(Boolean).join(' · ');
  function st(n, l, bad) { return '<div' + (bad && n ? ' class="bad"' : '') + '><b class="num">' + n + '</b><span>' + l + '</span></div>'; }
  $('csStats').innerHTML = st(c.visits, c.visits === 1 ? 'επίσκεψη' : 'επισκέψεις') + st(c.noshows, 'δεν ήρθε', true) + st(c.cancellations, 'ακυρώσεις') + st(c.avg_people ? String(c.avg_people).replace('.', ',') : '–', 'άτομα κατά μ.ό.');
  $('csDates').textContent = 'Πρώτη κράτηση: ' + fmtDate(c.first_date) + (c.last_visit ? ' · Τελευταία επίσκεψη: ' + fmtDate(c.last_visit) : '') + (c.online ? ' · ' + c.online + ' online' : '');
  var tel = String(c.phone || '').replace(/[^\d+]/g, '');
  $('csCall').href = tel ? 'tel:' + tel : '#'; $('csCallNum').textContent = c.phone || 'Χωρίς τηλέφωνο';
  $('cs-notes').value = c.notes || ''; setCustTags(c.tags || []);
  $('csErr').hidden = true; $('csDel').dataset.armed = ''; $('csDel').textContent = 'Διαγραφή πελάτη και ιστορικού';
  $('csHist').innerHTML = '<p class="hint-sm">Φόρτωση…</p>';
  openSheet('custSheet');
  client.from('bookings').select('*').eq('phone_key', k).order('date', { ascending: false }).order('time', { ascending: false }).limit(200).then(function (r) {
    if (r.error) throw r.error;
    if (!cv.cur || cv.cur.phone_key !== k) return;
    $('csHist').innerHTML = r.data.map(fromDb).map(function (b) {
      var s = STATUS[b.status] || STATUS.confirmed;
      return '<div><span class="num"><b>' + esc(fmtDate(b.date)) + '</b> ' + esc(b.time) + '</span><small>' + b.people + ' άτ.' + (b.table ? ' · τραπ. ' + esc(b.table) : '') + (b.source === 'online' ? ' · online' : '') + (b.reviewSentAt ? ' · email κριτικής ' + esc(fmtDate(String(b.reviewSentAt).slice(0, 10))) : '') + (b.notes ? ' · ' + esc(b.notes) : '') + '</small><span class="chip ' + esc(b.status) + '">' + s.l + '</span></div>';
    }).join('') || '<p class="hint-sm">Καμία κράτηση.</p>';
  }).catch(function (e) { $('csHist').innerHTML = '<p class="err">' + esc(errText(e)) + '</p>'; });
}
$('csClose').addEventListener('click', closeSheets);
$('csSave').addEventListener('click', function () {
  var c = cv.cur; if (!c) return;
  var notes = $('cs-notes').value.trim(), tags = cv.tags.slice(), btn = $('csSave'); btn.disabled = true;
  client.from('customers').upsert({ phone_key: c.phone_key, notes: notes, tags: tags }).then(function (r) {
    btn.disabled = false; if (r.error) throw r.error;
    c.notes = notes; c.tags = tags; renderCustomers(); closeSheets(); toast('Αποθηκεύτηκε: ' + (c.name || c.phone));
  }).catch(function (e) { btn.disabled = false; $('csErr').textContent = errText(e); $('csErr').hidden = false; });
});
$('csBook').addEventListener('click', function () {
  var c = cv.cur; if (!c) return;
  closeSheets(); hideCustView(); openForm(null);
  $('f-phone').value = c.phone || ''; $('f-name').value = c.name || ''; lookup();
});
$('csDel').addEventListener('click', function () {
  var c = cv.cur, b = $('csDel'); if (!c) return;
  if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Σίγουρα; Σβήνει ' + c.bookings + (c.bookings === 1 ? ' κράτηση' : ' κρατήσεις') + '. Πατήστε ξανά'; return; }
  b.disabled = true;
  client.from('bookings').delete().eq('phone_key', c.phone_key).then(function (r) {
    if (r.error) throw r.error; return client.from('customers').delete().eq('phone_key', c.phone_key);
  }).then(function (r) {
    b.disabled = false; if (r && r.error) throw r.error;
    cv.rows = cv.rows.filter(function (x) { return x.phone_key !== c.phone_key; }); renderCustomers(); closeSheets(); toast('Διαγράφηκε ο πελάτης ' + (c.name || ''));
  }).catch(function (e) { b.disabled = false; $('csErr').textContent = errText(e); $('csErr').hidden = false; });
});

/* ---------------- login + boot ---------------- */
function showApp() { $('loginView').hidden = true; $('menuView').hidden = true; $('custView').hidden = true; $('appView').hidden = false; subscribe(); loadTables().catch(function () {}); }
function showLogin(msg) {
  $('appView').hidden = true; $('menuView').hidden = true; $('custView').hidden = true; $('loginView').hidden = false;
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
