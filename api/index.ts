const BASE_ID = process.env.AIRTABLE_BASE_ID || "app1ulAFNbDuizG4n";
const PROGRAMS_TABLE = process.env.AIRTABLE_PROGRAMS_TABLE || "tblb080LKdZLFit2x";
const ACTIONS_TABLE = process.env.AIRTABLE_ACTIONS_TABLE || "tblaMHswXQx4r9ba1";

function esc(v: any): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function token(): string {
  return process.env.AIRTABLE || process.env.AIRTABLE_API_KEY || "";
}

function getRecordId(req: any): string {
  const q = req.query?.recordId;
  if (typeof q === "string" && q.trim()) return q.trim();
  const m = String(req.url || "").match(/[?&]recordId=([^&]+)/);
  return m?.[1] ? decodeURIComponent(m[1]).trim() : "";
}

function display(v: any, fallback = ""): string {
  if (Array.isArray(v)) return v.map(x => x?.name || x).filter(Boolean).join(", ") || fallback;
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v === "object") return v.name || v.id || fallback;
  return String(v);
}

function pick(f: any, names: string[], fallback = "—") {
  for (const n of names) {
    const v = display(f?.[n], "");
    if (v) return v;
  }
  return fallback;
}

function rawIds(f: any, name: string): string[] {
  const v = f?.[name];
  return Array.isArray(v) ? v.filter(x => typeof x === "string" && x.startsWith("rec")) : [];
}

function num(v: any): number | null {
  if (Array.isArray(v)) return v.length ? num(v[0]) : null;
  if (v === undefined || v === null || v === "") return null;
  const n = Number(String(v).replace("%", "").trim());
  if (Number.isNaN(n)) return null;
  return n > 1 && n <= 100 ? n / 100 : n;
}

function pct(v: any) {
  const n = num(v);
  return n === null ? "—" : `${Math.round(n * 100)}%`;
}

function color(v: any) {
  const n = num(v);
  if (n === null) return "#94a3b8";
  if (n >= 0.85) return "#07923b";
  if (n >= 0.70) return "#2563eb";
  if (n >= 0.50) return "#f97316";
  return "#dc2626";
}

function label(v: any) {
  const n = num(v);
  if (n === null) return "Not Assessed";
  if (n >= 0.85) return "High";
  if (n >= 0.70) return "Moderate";
  if (n >= 0.50) return "Fragile";
  return "Critical";
}

async function airtableFetch(url: string) {
  const t = token();
  if (!t) throw new Error("Missing AIRTABLE environment variable.");
  const r = await fetch(url, { headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } });
  const text = await r.text();
  if (!r.ok) throw new Error(`Airtable ${r.status}: ${text}`);
  return JSON.parse(text);
}

function tableUrl(table: string, params = "") {
  return `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}${params}`;
}

async function loadProgram(recordId: string) {
  const formula = `OR(RECORD_ID()="${recordId}",{Program ID}="${recordId}")`;
  const rawParams = new URLSearchParams({ filterByFormula: formula, maxRecords: "1" });
  const stringParams = new URLSearchParams({ filterByFormula: formula, maxRecords: "1", cellFormat: "string", timeZone: "Europe/Paris", userLocale: "en-us" });
  const [raw, str] = await Promise.all([
    airtableFetch(tableUrl(PROGRAMS_TABLE, `?${rawParams}`)),
    airtableFetch(tableUrl(PROGRAMS_TABLE, `?${stringParams}`))
  ]);
  if (!raw.records?.length) throw new Error(`No Program found for ${recordId}`);
  return { raw: raw.records[0], str: str.records?.[0] || raw.records[0] };
}

async function fetchActionById(id: string) {
  try {
    const params = new URLSearchParams({ cellFormat: "string", timeZone: "Europe/Paris", userLocale: "en-us" });
    return await airtableFetch(tableUrl(ACTIONS_TABLE, `/${id}?${params}`));
  } catch (e: any) {
    return { id, fields: { "Action ID": id, "Action Name": `Failed to fetch: ${e.message}` } };
  }
}

async function loadActions(programRaw: any) {
  const ids = rawIds(programRaw?.fields || {}, "Linked Actions");
  if (!ids.length) return [];
  return (await Promise.all(ids.map(fetchActionById))).filter(Boolean);
}

function bar(name: string, value: any, note: string) {
  const n = Math.round((num(value) ?? 0) * 100);
  return `<div class="bar"><div><b>${esc(name)}</b><span>${esc(note)}</span></div><div class="track"><i style="width:${n}%;background:${color(value)}"></i></div><strong>${pct(value)}</strong></div>`;
}

function kpi(title: string, value: any, sub: string) {
  return `<div class="card kpi"><div>${esc(title)}</div><b style="color:${color(value)}">${pct(value)}</b><div class="sub">${esc(sub)}</div></div>`;
}

function actionRows(actions: any[]) {
  if (!actions.length) return `<tr><td colspan="5">No linked actions found.</td></tr>`;
  return actions.map(a => {
    const f = a.fields || {};
    const id = pick(f, ["Action ID", "Action Code"], a.id);
    const name = pick(f, ["Action Name", "Name"], "Untitled action");
    const coherence = f["Overall Coherence"] ?? f["Action Coherence Score"] ?? f["OCI-O"];
    const weakest = pick(f, ["Weakest Component", "Weakest Layer", "Weakest Governance Layer"], "Not assessed");
    const workflow = pick(f, ["Workflow Step", "Step Status", "Status"], "Not specified");
    return `<tr><td><b>${esc(id)}</b><br/><span>${esc(name)}</span></td><td style="color:${color(coherence)}"><b>${pct(coherence)}</b></td><td>${esc(weakest)}</td><td>${esc(workflow)}</td><td><span class="pill">${esc(label(coherence))}</span></td></tr>`;
  }).join("");
}

function buildData(programPair: any, actions: any[], runtimeMessage = "") {
  const raw = programPair?.raw?.fields || {};
  const f = programPair?.str?.fields || {};
  return {
    programId: pick(f, ["Program ID"], programPair?.raw?.id || "PLACEHOLDER"),
    programName: pick(f, ["Program Name"], "Programme Governance Coherence Dashboard"),
    leadAuthority: pick(f, ["Lead Authority", "Lead Authority Name", "Lead Authority Names"], "Not specified"),
    supportingAuthorities: pick(f, ["Supporting Authorities", "Supporting Authorities Names"], "Not specified"),
    coordinationOwner: pick(f, ["Coordination Owner", "Coordination Owner Name"], "Not specified"),
    escalationAuthority: pick(f, ["Escalation Authority", "Escalation Authority Name"], "Not specified"),
    validationAuthority: pick(f, ["Validation Authority", "Validation Authority Name"], "Not specified"),
    statusText: pick(f, ["Status"], "Draft / Placeholder"),
    reviewStatus: pick(f, ["Program Review Status"], "Pending review"),
    reviewPriority: pick(f, ["Reviewer Priority"], "Medium"),

    claimCount: raw["Programme Claim Count"] ?? f["Programme Claim Count"],
    evidenceLinkedClaimCount: raw["Evidence-Linked Claim Count"] ?? f["Evidence-Linked Claim Count"],
    weakClaimsCount: raw["Weak Claims Count"] ?? f["Weak Claims Count"],
    claimSupportRate: raw["Claim Evidence Support Rate"] ?? f["Claim Evidence Support Rate"],

    c1: raw["Programme C1 Claim-Evidence Score"] ?? f["Programme C1 Claim-Evidence Score"],
    c2: raw["Programme C2 Claim-Evidence Score"] ?? f["Programme C2 Claim-Evidence Score"],
    c3: raw["Programme C3 Claim-Evidence Score"] ?? f["Programme C3 Claim-Evidence Score"],
    c4: raw["Programme C4 Claim-Evidence Score"] ?? f["Programme C4 Claim-Evidence Score"],
    c5: raw["Programme C5 Claim-Evidence Score"] ?? f["Programme C5 Claim-Evidence Score"],
    c6: raw["Programme C6 Claim-Evidence Score"] ?? f["Programme C6 Claim-Evidence Score"],

    intrinsicD: raw["Programme Intrinsic OCI-D"] ?? raw["Programme Intrinsic OCI-D Score"] ?? f["Programme Intrinsic OCI-D"],
    intrinsicO: raw["Programme Intrinsic OCI-O"] ?? raw["Programme Intrinsic OCI-O Score"] ?? f["Programme Intrinsic OCI-O"],
    inheritedD: raw["Inherited Action OCI-D Score"] ?? raw["OCI-D"] ?? f["Inherited Action OCI-D Score"],
    inheritedO: raw["Inherited Action OCI-O Score"] ?? raw["OCI-O"] ?? f["Inherited Action OCI-O Score"],
    finalD: raw["Final Programme OCI-D Score"] ?? f["Final Programme OCI-D Score"],
    finalO: raw["Final Programme OCI-O Score"] ?? f["Final Programme OCI-O Score"],
    finalCoherence: raw["Final Programme Coherence Score"] ?? raw["Overall Coherence Score"] ?? f["Final Programme Coherence Score"],
    finalStatus: pick(f, ["Final Programme Coherence Status", "Program Governance State"], label(raw["Final Programme Coherence Score"])),
    actionAggregation: raw["Action Aggregation Coherence Score"] ?? raw["Overall Coherence Score"],

    weakestLayer: pick(f, ["Weakest Governance Layer", "Weakest Component"], "Not assessed"),
    weakestAction: pick(f, ["Weakest Action"], "Not assessed"),
    docCoherence: raw["C1 Document Coherence"] ?? f["C1 Document Coherence"],
    verticalCoherence: raw["C1 Vertical Coherence"] ?? f["C1 Vertical Coherence"],
    horizontalCoherence: raw["C1 Horizontal Coherence"] ?? f["C1 Horizontal Coherence"],

    summary: runtimeMessage || pick(f, ["Programme OCI-D Rationale", "Program Governance Summary (AI)", "Program Governance Summary"], "Programme OCI-D / OCI-O dashboard rendered successfully."),
    oRationale: pick(f, ["Programme OCI-O Rationale"], "OCI-O is calculated from programme C4-C6 claim-evidence scores and inherited action operational coherence."),
    reviewerFocus: pick(f, ["Recommended Reviewer Focus", "Reviewer Action Required"], "Review weak claims, evidence sufficiency, and action translation consistency."),
    actions
  };
}

function render(d: any) {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(d.programName)}</title><style>*{box-sizing:border-box}body{margin:0;background:#f6f8fc;color:#07164a;font-family:Arial,sans-serif;padding:18px}.page{max-width:1560px;margin:0 auto}.header,.card{background:#fff;border:1px solid #e8edf5;border-radius:16px;padding:18px;box-shadow:0 8px 24px rgba(15,23,42,.05)}.header{margin-bottom:14px}.kicker{font-size:12px;font-weight:900;text-transform:uppercase;color:#2563eb;margin-bottom:8px}.top{display:flex;justify-content:space-between;gap:18px}.title{font-size:30px;font-weight:900}.meta{display:flex;flex-wrap:wrap;gap:18px;margin-top:10px;font-size:13px}.badge{background:#eef4ff;color:#2563eb;border-radius:10px;padding:8px 12px;font-weight:900}.grid6{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:14px}.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px}.grid3{display:grid;grid-template-columns:1fr 1.15fr 1fr;gap:14px;margin-bottom:14px}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}.kpi{text-align:center}.kpi b{display:block;font-size:31px;margin:8px 0}.sub{font-size:12px;font-weight:800;color:#64748b}.section{font-size:18px;font-weight:900;margin-bottom:12px}.row{display:grid;grid-template-columns:170px 1fr;gap:10px;margin:10px 0;font-size:13px}.bar{display:grid;grid-template-columns:210px 1fr 48px;gap:12px;align-items:center;margin:13px 0}.bar span,.table span{display:block;color:#64748b;font-size:11px;margin-top:2px}.track{height:9px;background:#e5e7eb;border-radius:99px;overflow:hidden}.track i{display:block;height:9px;border-radius:99px}.warn{background:#fff7ed;border-color:#fed7aa}.ai{background:#f4f0ff;border-radius:14px;padding:14px;font-size:13px;line-height:1.55}.small{font-size:13px;line-height:1.55}.pill{display:inline-block;padding:5px 9px;border-radius:8px;font-size:11px;font-weight:900;background:#eef4ff;color:#2563eb}.flow{font-size:13px;font-weight:900;color:#334155;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:12px;padding:14px;text-align:center;line-height:1.8}.table{width:100%;border-collapse:collapse;font-size:12px}.table th{background:#f8fafc;text-align:left;padding:8px;border-bottom:1px solid #e5e7eb}.table td{padding:8px;border-bottom:1px solid #e5e7eb;vertical-align:top}@media(max-width:1100px){.grid6,.grid4,.grid3,.grid2{grid-template-columns:1fr}.bar{grid-template-columns:1fr}}</style></head><body><div class="page"><div class="header"><div class="kicker">Programme OCI-D / OCI-O Recursive Coherence Dashboard</div><div class="top"><div><div class="title">${esc(d.programName)}</div><div class="meta"><div><b>Program ID:</b> ${esc(d.programId)}</div><div><b>Lead Authority:</b> ${esc(d.leadAuthority)}</div><div><b>Status:</b> ${esc(d.statusText)}</div><div><b>Validation:</b> ${esc(d.reviewStatus)}</div></div></div><div class="badge">${esc(d.finalStatus)}</div></div></div>
<div class="grid6">${kpi("Final Programme OCI-D", d.finalD, "Design Vertical Coherence")}${kpi("Final Programme OCI-O", d.finalO, "Operational Coherence")}${kpi("Final Programme Coherence", d.finalCoherence, "Recursive score")}${kpi("Intrinsic OCI-D", d.intrinsicD, "Programme claims C1-C3")}${kpi("Intrinsic OCI-O", d.intrinsicO, "Programme claims C4-C6")}${kpi("Action Aggregation", d.actionAggregation, "Inherited lower layer")}</div>
<div class="grid4"><div class="card kpi"><div>Programme Claims</div><b>${esc(display(d.claimCount,"—"))}</b><div class="sub">Governance claims</div></div><div class="card kpi"><div>Evidence-Linked Claims</div><b>${esc(display(d.evidenceLinkedClaimCount,"—"))}</b><div class="sub">Claim support</div></div><div class="card kpi"><div>Claim Support Rate</div><b style="color:${color(d.claimSupportRate)}">${pct(d.claimSupportRate)}</b><div class="sub">Evidence coverage</div></div><div class="card kpi"><div>Weak Claims</div><b style="color:#f97316">${esc(display(d.weakClaimsCount,"—"))}</b><div class="sub">Reviewer focus</div></div></div>
<div class="grid3"><div class="card"><div class="section">Institutional Coordination Map</div><div class="row"><b>Lead Authority</b><div>${esc(d.leadAuthority)}</div></div><div class="row"><b>Supporting Authorities</b><div>${esc(d.supportingAuthorities)}</div></div><div class="row"><b>Coordination Owner</b><div>${esc(d.coordinationOwner)}</div></div><div class="row"><b>Escalation Authority</b><div>${esc(d.escalationAuthority)}</div></div><div class="row"><b>Validation Authority</b><div>${esc(d.validationAuthority)}</div></div></div><div class="card"><div class="section">Programme C1-C6 Claim-Evidence Architecture</div>${bar("C1 Policy / Document Coherence", d.c1, "Vertical + horizontal documentary coherence")}${bar("C2 Operational Embedding", d.c2, "Institutional and governance embedding")}${bar("C3 Resources", d.c3, "Budget, capacity, resource continuity")}${bar("C4 Monitoring", d.c4, "KPIs, reporting, visibility")}${bar("C5 Escalation", d.c5, "Triggers and corrective response")}${bar("C6 Traceability", d.c6, "Auditability and evidence continuity")}</div><div class="card warn"><div class="section">Recursive Inheritance Engine</div>${bar("Intrinsic Programme OCI-D", d.intrinsicD, "60% of final OCI-D")}${bar("Inherited Action OCI-D", d.inheritedD, "40% of final OCI-D")}${bar("Intrinsic Programme OCI-O", d.intrinsicO, "60% of final OCI-O")}${bar("Inherited Action OCI-O", d.inheritedO, "40% of final OCI-O")}<div class="small"><b>Weakest Layer:</b> ${esc(d.weakestLayer)}</div><div class="small"><b>Weakest Action:</b> ${esc(d.weakestAction)}</div></div></div>
<div class="grid2"><div class="card"><div class="section">C1 Documentary Coherence</div>${bar("C1 Document Coherence", d.docCoherence, "Documentary alignment")}${bar("Vertical Coherence", d.verticalCoherence, "Upper-layer alignment")}${bar("Horizontal Coherence", d.horizontalCoherence, "Same-layer consistency")}<div class="flow">Documents → Claims → Evidence → Validation → OCI-D / OCI-O → Inherited Action Coherence → Final Programme Coherence</div></div><div class="card"><div class="section">Programme Governance Narrative</div><div class="ai">${esc(d.summary)}</div><br/><div class="ai">${esc(d.oRationale)}</div><br/><div class="small"><b>Reviewer focus:</b> ${esc(d.reviewerFocus)}</div></div></div>
<div class="card"><div class="section">Linked Action Continuity Heatmap</div><table class="table"><thead><tr><th>Action</th><th>Coherence</th><th>Weakest Layer</th><th>Workflow</th><th>Status</th></tr></thead><tbody>${actionRows(d.actions)}</tbody></table></div></div></body></html>`;
}

export default async function handler(req: any, res: any) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  try {
    const recordId = getRecordId(req);
    const programPair = recordId ? await loadProgram(recordId) : null;
    const actions = programPair ? await loadActions(programPair.raw) : [];
    res.statusCode = 200;
    res.end(render(buildData(programPair, actions)));
  } catch (e: any) {
    res.statusCode = 200;
    res.end(render(buildData(null, [], `Runtime error captured without crashing: ${e?.message || String(e)}`)));
  }
}