// Mostra – one review request per customer, ever.
// Runs once a day (pg_cron). Sends to online bookings from YESTERDAY (Cyprus time) that were not
// cancelled or marked no-show, have an email, and whose customer (same email or phone) never got one.
// Safe to call more than once: every booking is claimed before sending, so nobody gets two emails.

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = Deno.env.get("MAIL_FROM") ?? "Mostra Meze Tavern <kratiseis@mostrameze.com>";
const REPLY_TO = Deno.env.get("MAIL_REPLY_TO") ?? "mostrameze@gmail.com";
const GOOGLE = "https://search.google.com/local/writereview?placeid=ChIJgwz68YEz5xQRYO8XuChp7-s";
const TRIP = "https://www.tripadvisor.com/Restaurant_Review-g190382-d23873437-Reviews-Mostra_Meze_Tavern-Limassol_City_Limassol.html";

const db = (path: string, init: RequestInit = {}) =>
  fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers ?? {}) },
  });
const esc = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cyprusNow() {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Nicosia", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, hour: Number(g("hour")) };
}
function addDays(d: string, n: number) {
  const [y, m, day] = d.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, day + n));
  return x.toISOString().slice(0, 10);
}
function firstName(n: string) { return String(n || "").trim().split(/\s+/)[0] || ""; }

function mail(b: any) {
  const en = b.lang === "en", name = esc(firstName(b.name));
  const t = en ? {
    subject: "How was your evening at Mostra?",
    hi: name ? `Hello ${name},` : "Hello,",
    p1: "thank you for choosing Mostra yesterday. We hope you enjoyed the meze and the evening.",
    p2: "If you have a minute, we would be grateful for a short review on Google. It helps other people find us.",
    btn: "Write a review on Google", alt: "Prefer Tripadvisor? Leave a review here",
    p3: "If something was not right, simply reply to this email and tell us directly.",
    bye: "Thank you,",
  } : {
    subject: "Πώς σας φάνηκε το Mostra;",
    hi: name ? `Γεια σας ${name},` : "Γεια σας,",
    p1: "σας ευχαριστούμε που μας επισκεφτήκατε χθες. Ελπίζουμε να απολαύσατε τους μεζέδες και τη βραδιά.",
    p2: "Αν έχετε ένα λεπτό, θα χαιρόμασταν πολύ με μια σύντομη κριτική στο Google. Βοηθάει κι άλλους να μας βρουν.",
    btn: "Γράψτε κριτική στο Google", alt: "Προτιμάτε το Tripadvisor; Γράψτε κριτική εδώ",
    p3: "Αν κάτι δεν ήταν όπως έπρεπε, απαντήστε σε αυτό το email και πείτε μας το απευθείας.",
    bye: "Ευχαριστούμε,",
  };
  const html = `<!doctype html><html><body style="margin:0;background:#f3eee4;font-family:Arial,Helvetica,sans-serif;color:#2a2118">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3eee4;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fffdf8;border-radius:14px;overflow:hidden">
<tr><td style="background:#0e6b67;color:#f3fbf9;padding:22px 26px;font:700 22px Georgia,serif;letter-spacing:4px">MOSTRA<div style="font:600 11px Arial;letter-spacing:3px;opacity:.8;margin-top:4px">GREEK MEZE TAVERN · LIMASSOL</div></td></tr>
<tr><td style="padding:26px;font-size:16px;line-height:1.5">
<p style="margin:0 0 6px">${t.hi}</p><p style="margin:0 0 14px">${t.p1}</p><p style="margin:0 0 22px">${t.p2}</p>
<p style="margin:0 0 18px;text-align:center"><a href="${GOOGLE}" style="display:inline-block;background:#b8382a;color:#fff;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:999px">${t.btn}</a></p>
<p style="margin:0 0 22px;text-align:center;font-size:14px"><a href="${TRIP}" style="color:#0e6b67">${t.alt}</a></p>
<p style="margin:0 0 18px;font-size:14px;color:#6a5843">${t.p3}</p>
<p style="margin:0;font-size:14px">${t.bye}<br>Mostra Meze Tavern</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = `${t.hi}\n${t.p1}\n\n${t.p2}\n${t.btn}: ${GOOGLE}\n\n${t.alt}: ${TRIP}\n\n${t.p3}\n\n${t.bye}\nMostra Meze Tavern`;
  return { subject: t.subject, html, text };
}

Deno.serve(async (req) => {
  const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json" } });
  let dry = false;
  try { dry = (await req.json()).dry === true; } catch { /* empty body */ }
  if (!RESEND && !dry) return json({ sent: 0, reason: "not_configured" });
  const now = cyprusNow();
  if (now.hour < 11 && !dry) return json({ sent: 0, reason: "too_early" }); // never before 11:00 Cyprus time
  const day = addDays(now.date, -1);

  const r = await db(`bookings?date=eq.${day}&source=eq.online&review_sent_at=is.null&email=neq.&status=in.(seated,left,confirmed)&select=id,name,email,phone_key,lang&order=created_at.asc`);
  if (!r.ok) return json({ sent: 0, reason: "db", status: r.status });
  const list: any[] = await r.json();
  const seen = new Set<string>();
  let sent = 0, skipped = 0, failed = 0, would = 0;

  for (const b of list) {
    const email = String(b.email).toLowerCase();
    if (seen.has(email) || (b.phone_key && seen.has(b.phone_key))) { skipped++; continue; }
    seen.add(email); if (b.phone_key) seen.add(b.phone_key);

    // one request per customer, ever: any earlier booking with the same email or phone already got one?
    const orq = "or=" + encodeURIComponent(`(email.eq."${email.replace(/"/g, "")}"${b.phone_key ? `,phone_key.eq.${b.phone_key}` : ""})`);
    const prev = await db(`bookings?${orq}&review_sent_at=not.is.null&select=id&limit=1`);
    if (!prev.ok || (await prev.json()).length) { skipped++; continue; }

    if (dry) { would++; continue; } // test mode: count only, send nothing

    // claim, then send
    const claim = await db(`bookings?id=eq.${b.id}&review_sent_at=is.null&select=id`, { method: "PATCH", body: JSON.stringify({ review_sent_at: new Date().toISOString() }) });
    if (!claim.ok || !(await claim.json()).length) { skipped++; continue; }
    const m = mail(b);
    const s = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [b.email], reply_to: REPLY_TO, subject: m.subject, html: m.html, text: m.text }),
    });
    if (s.ok) sent++;
    else {
      failed++; console.error("resend", s.status, await s.text());
      await db(`bookings?id=eq.${b.id}`, { method: "PATCH", body: JSON.stringify({ review_sent_at: null }) });
    }
    await sleep(600); // stay under the email provider's rate limit
  }
  return json({ day, dry, candidates: list.length, would_send: would, sent, skipped, failed });
});
