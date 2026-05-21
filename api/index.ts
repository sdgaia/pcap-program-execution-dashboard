const BASE_ID = process.env.AIRTABLE_BASE_ID || "app1ulAFNbDuizG4n";
const PROGRAMS_TABLE = process.env.AIRTABLE_PROGRAMS_TABLE || "tblb080LKdZLFit2x";

const esc = (v: any) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tok = () => process.env.AIRTABLE || process.env.AIRTABLE_API_KEY || "";

function rid(req: any) {
  const q = req.query?.recordId;
  if (typeof q === "string" && q.trim()) return q.trim();
  const url = new URL(req.url || "/", "https://x.local");
  return url.searchParams.get("recordId") || "";
}

function show(v: any, fb = "—") {
  if (Array.isArray(v)) return v.map(x => x?.name || x).filter(Boolean).join(", ") || fb;
  if (v === undefined || v === null || v === "") return fb;
  if (typeof v === "object") return v.name || v.id || fb;
  return String(v);
}

function pick(f: any, names: string[], fb = "—") {
  for (const n of names) {
    const v = show(f?.[n], "");
    if (v) return v;
  }
  return fb;
}

function n(v: any): number | null {
  if (Array.isArray(v)) return v.length ? n(v[0]) : null;
  if (v === undefined || v === null || v === "") return null;
  const x = Number(String(v).replace("%", "").trim());
  if (Number.isNaN(x)) return null;
  return x > 1 && x <= 100 ? x / 100 : x;
}

function pct(v: any) {
  const x = n(v);
  return x === null ? "—" : `${Math.round(x * 100)}%`;
}

function col(v: any) {
  const x = n(v);
  if (x === null) return "#94a3b8";
  if (x >= 0.85) return "#059669";
  if (x >= 0.70) return "#2563eb";
  if (x >= 0.50) return "#f97316";
  return "#dc2626";
}

function lab(v: any) {
  const x = n(v);
  if (x === null) return "Not assessed";
  if (x >= 0.85) return "High";
  if (x >= 0.70) return "Moderate";
  if (x >= 0.50) return "Fragile";
  return "Critical";
}

async function afetch(url: string) {
  const t = tok();
  if (!t) throw new Error("Missing AIRTABLE environment variable.");
  const r = await fetch(url, { headers: { Authorization: `Bearer ${t}` } });
  const text = await r.text();
  if (!r.ok) throw new Error(`Airtable ${r.status}: ${text}`);
  return JSON.parse(text);
}

async function load(recordId: string) {
  const formula = `OR(RECORD_ID()="${recordId}",{Program ID}="${recordId}")`;
  const p1 = new URLSearchParams({ filterByFormula: formula, maxRecords: "1" });
  const p2 = new URLSearchParams({ filterByFormula: formula, maxRecords: "1", cellFormat: "string", timeZone: "Europe/Paris", userLocale: "en-us" });
  const u1 = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PROGRAMS_TABLE)}?${p1}`;
  const u2 = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PROGRAMS_TABLE)}?${p2}`;
  const [raw, str] = await Promise.all([afetch(u1), afetch(u2)]);
  if (!raw.records?.length) throw new Error(`No Program found for ${recordId}`);
  return { raw: raw.records[0].fields || {}, str: str.records?.[0]?.fields || raw.records[0].fields || {}, id: raw.records[0].id };
}

function gauge(title: string, value: any, sub: string) {
  const x = n(value) ?? 0;
  return `<div class="card g"><div class="gt">${esc(title)}</div><div class="ring" style="--p:${Math.round(x * 360)}deg;--c:${col(value)}"><div><b>${pct(value)}</b><span>${esc(lab(value))}</span></div></div><small>${esc(sub)}</small></div>`;
}

function heat(name: string, value: any) {
  return `<div class="h"><span>${esc(name)}</span><i style="background:${col(value)};width:${Math.max(4, Math.round((n(value) ?? 0) * 100))}%"></i><b>${pct(value)}</b></div>`;
}

function data(pair: any, msg = "") {
  const r = pair?.raw || {};
  const s = pair?.str || {};
  return {
    id: pick(s, ["Program ID"], pair?.id || "PLACEHOLDER"),
    name: pick(s, ["Program Name"], "Programme Coherence Dashboard"),
    lead: pick(s, ["Lead Authority"], "—"),
    support: pick(s, ["Supporting Authorities"], "—"),
    status: pick(s, ["Status"], "—"),
    badge: pick(s, ["Final Programme Coherence Status", "Program Governance State"], lab(r["Final Programme Coherence Score"])),
    final: r["Final Programme Coherence Score"] ?? r["Overall Coherence Score"],
    d: r["Final Programme OCI-D Score"],
    o: r["Final Programme OCI-O Score"],
    action: r["Action Aggregation Coherence Score"] ?? r["Overall Coherence Score"],
    supportRate: r["Claim Evidence Support Rate"],
    weak: r["Weak Claims Count"],
    claims: r["Programme Claim Count"],
    evidence: r["Evidence-Linked Claim Count"],
    c1: r["Programme C1 Claim-Evidence Score"],
    c2: r["Programme C2 Claim-Evidence Score"],
    c3: r["Programme C3 Claim-Evidence Score"],
    c4: r["Programme C4 Claim-Evidence Score"],
    c5: r["Programme C5 Claim-Evidence Score"],
    c6: r["Programme C6 Claim-Evidence Score"],
    weakest: pick(s, ["Weakest Governance Layer", "Weakest Component"], "—"),
    narrative: msg || pick(s, ["Program Governance Summary (AI)", "Program Governance Summary", "Programme OCI-D Rationale"], "Programme coherence dashboard rendered successfully.")
  };
}

function render(d: any) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.name)}</title><style>
*{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#06164a;font-family:Arial,sans-serif;padding:18px}.page{max-width:1500px;margin:auto}.card,.head{background:white;border:1px solid #e8edf5;border-radius:18px;padding:18px;box-shadow:0 8px 24px rgba(15,23,42,.05)}.head{margin-bottom:14px;display:flex;justify-content:space-between;gap:20px;align-items:center}.k{font-size:12px;font-weight:900;color:#2563eb;text-transform:uppercase}.title{font-size:30px;font-weight:900;margin:8px 0}.meta{display:flex;gap:18px;flex-wrap:wrap;font-size:13px}.badge{background:#eef4ff;color:#2563eb;border-radius:14px;padding:16px 20px;font-size:20px;font-weight:900}.grid5{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:14px}.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}.g{text-align:center;min-height:185px}.gt{font-size:15px;font-weight:900}.ring{width:112px;height:112px;border-radius:50%;margin:12px auto;background:conic-gradient(var(--c) var(--p),#e5e7eb 0deg);display:grid;place-items:center}.ring div{width:78px;height:78px;border-radius:50%;background:#fff;display:grid;place-items:center;align-content:center}.ring b{font-size:25px}.ring span,small{font-size:11px;color:#64748b;font-weight:900}.section{font-size:19px;font-weight:900;margin-bottom:14px}.h{display:grid;grid-template-columns:150px 1fr 48px;gap:12px;align-items:center;margin:13px 0;font-weight:900}.h i{height:17px;border-radius:99px}.stat{display:flex;justify-content:space-between;border-bottom:1px solid #e5e7eb;padding:12px 0}.stat:last-child{border:0}.stat b{font-size:22px}.risk{background:#fff7ed;border-color:#fed7aa}.risk strong{font-size:24px;display:block;margin-bottom:12px}.narr{background:#f4f0ff;border-radius:14px;padding:14px;line-height:1.55;font-size:14px}@media(max-width:1100px){.grid5,.grid3{grid-template-columns:1fr}.head{display:block}.badge{margin-top:12px}.h{grid-template-columns:1fr}}</style></head><body><div class="page"><div class="head"><div><div class="k">Programme OCI-D / OCI-O Dashboard</div><div class="title">${esc(d.name)}</div><div class="meta"><div><b>Program ID:</b> ${esc(d.id)}</div><div><b>Lead:</b> ${esc(d.lead)}</div><div><b>Status:</b> ${esc(d.status)}</div></div></div><div class="badge">${esc(d.badge)}</div></div>
<div class="grid5">${gauge("Final Coherence", d.final, "Programme")}${gauge("OCI-D", d.d, "Design")}${gauge("OCI-O", d.o, "Operational")}${gauge("Action Signal", d.action, "Inherited")}${gauge("Evidence", d.supportRate, "Claim support")}</div>
<div class="grid3"><div class="card"><div class="section">C1–C6 Heatmap</div>${heat("C1 Policy", d.c1)}${heat("C2 Operational", d.c2)}${heat("C3 Resources", d.c3)}${heat("C4 Monitoring", d.c4)}${heat("C5 Escalation", d.c5)}${heat("C6 Traceability", d.c6)}</div><div class="card"><div class="section">Claim Control</div><div class="stat"><span>Claims</span><b>${esc(show(d.claims))}</b></div><div class="stat"><span>Evidence-linked</span><b>${esc(show(d.evidence))}</b></div><div class="stat"><span>Weak claims</span><b style="color:#f97316">${esc(show(d.weak))}</b></div><div class="stat"><span>Support rate</span><b style="color:${col(d.supportRate)}">${pct(d.supportRate)}</b></div></div><div class="card risk"><div class="section">Critical Risk</div><strong>${esc(d.weakest)}</strong><div class="narr">${esc(d.narrative)}</div></div></div></div></body></html>`;
}

export default async function handler(req: any, res: any) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  try {
    const recordId = rid(req);
    const pair = recordId ? await load(recordId) : null;
    res.statusCode = 200;
    res.end(render(data(pair)));
  } catch (e: any) {
    res.statusCode = 200;
    res.end(render(data(null, `Runtime error captured without crashing: ${e?.message || String(e)}`)));
  }
}
