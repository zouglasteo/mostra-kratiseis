// Mostra – sends the confirmation email for an online booking (once).
// Needs the secret RESEND_API_KEY (Supabase → Edge Functions → Secrets).
// Until it is set, the function answers {sent:false, reason:"not_configured"} and the booking still stands.

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = Deno.env.get("MAIL_FROM") ?? "Mostra Meze Tavern <kratiseis@mostrameze.com>";
const REPLY_TO = Deno.env.get("MAIL_REPLY_TO") ?? "mostrameze@gmail.com";
const NOTIFY = Deno.env.get("MAIL_NOTIFY") ?? "mostrameze@gmail.com"; // the restaurant's inbox
const ALLOWED = ["https://mostrameze.com", "https://www.mostrameze.com", "https://mostrameze-site.vercel.app"];

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED.includes(origin) ? origin : ALLOWED[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const db = (path: string, init: RequestInit = {}) =>
  fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers ?? {}) },
  });
const esc = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function longDate(d: string, lang: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "el-GR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, day)));
}

function mail(b: any) {
  const en = b.lang === "en";
  const when = `${longDate(b.date, b.lang)}, ${b.time}`;
  const cancel = `https://mostrameze.com/kratisi#cancel-${b.ref}`;
  const t = en ? {
    subject: `Your table at Mostra – ${when}`,
    hi: `Hello ${esc(b.name)},`, ok: "your table is booked. We look forward to seeing you!",
    when: "Date & time", ppl: "People", code: "Booking code", where: "Address",
    late: "If you are running late or need to change something, call us on +357 25 101251.",
    cancel: "Can't make it? Cancel online", bye: "See you soon,",
  } : {
    subject: `Το τραπέζι σας στο Mostra – ${when}`,
    hi: `Γεια σας ${esc(b.name)},`, ok: "το τραπέζι σας είναι κλεισμένο. Σας περιμένουμε!",
    when: "Ημέρα & ώρα", ppl: "Άτομα", code: "Κωδικός κράτησης", where: "Διεύθυνση",
    late: "Αν αργήσετε ή θέλετε να αλλάξετε κάτι, καλέστε μας στο 25 101251.",
    cancel: "Δεν μπορείτε να έρθετε; Ακύρωση online", bye: "Τα λέμε σύντομα,",
  };
  const row = (k: string, v: string) => `<tr><td style="padding:8px 0;color:#6a5843;font-size:14px">${k}</td><td style="padding:8px 0;text-align:right;font-weight:600;font-size:15px">${v}</td></tr>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f3eee4;font-family:Arial,Helvetica,sans-serif;color:#2a2118">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3eee4;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fffdf8;border-radius:14px;overflow:hidden">
<tr><td style="background:#0e6b67;color:#f3fbf9;padding:22px 26px;font:700 22px Georgia,serif;letter-spacing:4px">MOSTRA<div style="font:600 11px Arial;letter-spacing:3px;opacity:.8;margin-top:4px">GREEK MEZE TAVERN · LIMASSOL</div></td></tr>
<tr><td style="padding:26px">
<p style="margin:0 0 6px;font-size:16px">${t.hi}</p><p style="margin:0 0 18px;font-size:16px">${t.ok}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px dashed #d8c9ae;border-bottom:1px dashed #d8c9ae">
${row(t.when, esc(when))}${row(t.ppl, String(b.people))}${row(t.code, `<span style="font-family:monospace;letter-spacing:2px">${esc(b.ref)}</span>`)}${row(t.where, en ? "Saripolou 41, Limassol" : "Σαριπόλου 41, Λεμεσός")}
</table>
<p style="margin:18px 0 0;font-size:14px;color:#6a5843">${t.late}</p>
<p style="margin:18px 0 0"><a href="${cancel}" style="color:#b8382a;font-weight:600">${t.cancel}</a></p>
<p style="margin:22px 0 0;font-size:14px">${t.bye}<br>Mostra Meze Tavern</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = `${t.hi}\n${t.ok}\n\n${t.when}: ${when}\n${t.ppl}: ${b.people}\n${t.code}: ${b.ref}\n${t.where}: ${en ? "Saripolou 41, Limassol" : "Σαριπόλου 41, Λεμεσός"}\n\n${t.late}\n${t.cancel}: ${cancel}\n\n${t.bye}\nMostra Meze Tavern`;
  return { subject: t.subject, html, text };
}

function shortDate(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Intl.DateTimeFormat("el-GR", { weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, day)));
}
function staffMail(b: any, kind: "new" | "cancel") {
  const isNew = kind === "new";
  const head = isNew ? "Νέα online κράτηση" : "Ακύρωση online κράτησης";
  const subject = `${head}: ${b.name}, ${b.people} άτ., ${shortDate(b.date)} ${b.time}`;
  const row = (k: string, v: string) => `<tr><td style="padding:7px 0;color:#6a5843;font-size:14px;width:120px">${k}</td><td style="padding:7px 0;font-weight:600;font-size:15px">${v}</td></tr>`;
  const phone = String(b.phone ?? "");
  const html = `<!doctype html><html><body style="margin:0;background:#f3eee4;font-family:Arial,Helvetica,sans-serif;color:#2a2118">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:20px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fffdf8;border-radius:14px;overflow:hidden">
<tr><td style="background:${isNew ? "#0e6b67" : "#b8382a"};color:#fff;padding:16px 22px;font:700 17px Arial">${head}</td></tr>
<tr><td style="padding:18px 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${row("Ημέρα", esc(longDate(b.date, "el")))}${row("Ώρα", esc(b.time))}${row("Άτομα", String(b.people))}${row("Όνομα", esc(b.name))}
${row("Τηλέφωνο", `<a href="tel:${esc(phone.replace(/[^\d+]/g, ""))}" style="color:#0e6b67">${esc(phone)}</a>`)}${row("Email", esc(b.email))}
${b.notes ? row("Σχόλια", esc(b.notes)) : ""}${row("Κωδικός", `<span style="font-family:monospace;letter-spacing:2px">${esc(b.ref)}</span>`)}
</table>
<p style="margin:16px 0 0"><a href="https://kratiseis.mostrameze.com" style="display:inline-block;background:#0e6b67;color:#fff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:999px">Άνοιγμα κρατήσεων</a></p>
</td></tr></table></td></tr></table></body></html>`;
  const text = `${head}\n\nΗμέρα: ${longDate(b.date, "el")}\nΏρα: ${b.time}\nΆτομα: ${b.people}\nΌνομα: ${b.name}\nΤηλέφωνο: ${phone}\nEmail: ${b.email}\n${b.notes ? "Σχόλια: " + b.notes + "\n" : ""}Κωδικός: ${b.ref}\n\nhttps://kratiseis.mostrameze.com`;
  return { subject, html, text };
}
async function send(to: string, m: { subject: string; html: string; text: string }, replyTo: string) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], reply_to: replyTo, subject: m.subject, html: m.html, text: m.text }),
  });
  if (!r.ok) console.error("resend", to, r.status, await r.text());
  return r.ok;
}

Deno.serve(async (req) => {
  const h = { ...cors(req.headers.get("origin")), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "method" }), { status: 405, headers: h });
  let ref = "", type = "new";
  try { const j = await req.json(); ref = String(j.ref ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8); type = j.type === "cancel" ? "cancel" : "new"; } catch { /* ignore */ }
  if (!ref) return new Response(JSON.stringify({ error: "ref" }), { status: 400, headers: h });
  if (!RESEND) return new Response(JSON.stringify({ sent: false, reason: "not_configured" }), { headers: h });

  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  // online cancellation: tell the restaurant once
  if (type === "cancel") {
    const c = await db(`bookings?ref=eq.${ref}&status=eq.cancelled&cancel_notified_at=is.null&updated_at=gte.${encodeURIComponent(since)}&select=id,ref,name,email,phone,notes,date,time,people`, {
      method: "PATCH", body: JSON.stringify({ cancel_notified_at: new Date().toISOString() }),
    });
    const cr = c.ok ? await c.json() : [];
    if (!cr.length) return new Response(JSON.stringify({ sent: false, reason: "not_found_or_sent" }), { headers: h });
    const ok = await send(NOTIFY, staffMail(cr[0], "cancel"), cr[0].email || REPLY_TO);
    return new Response(JSON.stringify({ sent: ok }), { headers: h });
  }

  // new booking: claim it (online, made in the last 30 minutes, not yet emailed)
  const claim = await db(`bookings?ref=eq.${ref}&source=eq.online&email_sent_at=is.null&created_at=gte.${encodeURIComponent(since)}&select=id,ref,name,email,phone,notes,date,time,people,lang`, {
    method: "PATCH", body: JSON.stringify({ email_sent_at: new Date().toISOString() }),
  });
  const rows = claim.ok ? await claim.json() : [];
  if (!rows.length) return new Response(JSON.stringify({ sent: false, reason: "not_found_or_sent" }), { headers: h });
  const b = rows[0], m = mail(b);

  const [guestOk] = await Promise.all([
    send(b.email, m, REPLY_TO),
    send(NOTIFY, staffMail(b, "new"), b.email || REPLY_TO),
  ]);
  if (!guestOk) return new Response(JSON.stringify({ sent: false, reason: "send_failed" }), { headers: h });
  return new Response(JSON.stringify({ sent: true }), { headers: h });
});
