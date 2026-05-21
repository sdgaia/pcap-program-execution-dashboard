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
  if (n >= 0.8) return "#07923b";
  if (n >= 0.6) return "#2563eb";
  if (n >= 0.4) return "#f97316";
  return "#dc2626";
}

function label(v: any) {
  const n = num(v);
  if (n === null) return "Placeholder";
  if (n >= 0.8) return "Stable";
  if (n >= 0.6) return "Partial";
  if (n >= 0.4) return "Fragile";
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
    programName: pick(f, ["Program Name"], "Programme Execution Dashboard"),
    leadAuthority: pick(f, ["Lead Authority", "Lead Authority Name", "Lead Authority Names"], "Not specified"),
    supportingAuthorities: pick(f, ["Supporting Authorities", "Supporting Authorities Names"], "Not specified"),
    coordinationOwner: pick(f, ["Coordination Owner", "Coordination Owner Name"], "Not specified"),
    escalationAuthority: pick(f, ["Escalation Authority", "Escalation Authority Name"], "Not specified"),
    validationAuthority: pick(f, ["Validation Authority", "Validation Authority Name"], "Not specified"),
    statusText: pick(f, ["Status"], "Draft / Placeholder"),
    reviewStatus: pick(f, ["Program Review Status"], "Pending review"),
    reviewPriority: pick(f, ["Reviewer Priority"], "Medium"),
    governanceScore: raw["Program Governance Score"] ?? raw["Program Coherence Score"] ?? f["Program Governance Score"] ?? f["Program Coherence Score"],
    continuityScore: raw["Program Continuity Score"] ?? raw["Programme Stability Index"] ?? f["Program Continuity Score"] ?? f["Programme Stability Index"],
    coordinationScore: raw["Cross-Action Coherence"] ?? raw["Program Governance Score"] ?? f["Cross-Action Coherence"],
    resourceScore: raw["C3 Score"] ?? raw["C3 Continuity Score"] ?? f["C3 Score"],
    monitoringScore: raw["C4 Score"] ?? raw["C4 Continuity Score"] ?? f["C4 Score"],
    escalationScore: raw["C5 Score"] ?? raw["C5 Continuity Score"] ?? f["C5 Score"],
    auditScore: raw["C6 Score"] ?? raw["C6 Continuity Score"] ?? f["C6 Score"],
    criticalActions: pick(f, ["Critical Actions Count"], "0"),
    weakestLayer: pick(f, ["Weakest Governance Layer"], "Not assessed"),
    weakestAction: pick(f, ["Weakest Action"], "Not assessed"),
    resourceDiagnosis: pick(f, ["Resources Diagnosis"], "Resource diagnosis placeholder."),
    monitoringDiagnosis: pick(f, ["Monitoring Diagnosis"], "Monitoring diagnosis placeholder."),
    escalationDiagnosis: pick(f, ["Escalation Diagnosis"], "Escalation diagnosis placeholder."),
    auditDiagnosis: pick(f, ["Audit Trail Diagnosis"], "Audit trail diagnosis placeholder."),
    summary: runtimeMessage || pick(f, ["Program Governance Summary (AI)", "Program Governance Summary"], "Placeholder dashboard rendered successfully."),
    actions
  };
}

function render(d: any) {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(d.programName)}</title><style>*{box-sizing:border-box}body{margin:0;background:#f6f8fc;color:#07164a;font-family:Arial,sans-serif;padding:18px}.page{max-width:1500px;margin:0 auto}.header,.card{background:#fff;border:1px solid #e8edf5;border-radius:16px;padding:18px;box-shadow:0 8px 24px rgba(15,23,42,.05)}.header{margin-bottom:14px}.kicker{font-size:12px;font-weight:900;text-transform:uppercase;color:#2563eb;margin-bottom:8px}.top{display:flex;justify-content:space-between;gap:18px}.title{font-size:30px;font-weight:900}.meta{display:flex;flex-wrap:wrap;gap:18px;margin-top:10px;font-size:13px}.badge{background:#eef4ff;color:#2563eb;border-radius:10px;padding:8px 12px;font-weight:900}.grid6{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:14px}.grid3{display:grid;grid-template-columns:1fr 1.15fr 1fr;gap:14px;margin-bottom:14px}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}.kpi{text-align:center}.kpi b{display:block;font-size:31px;margin:8px 0}.sub{font-size:12px;font-weight:800;color:#64748b}.section{font-size:18px;font-weight:900;margin-bottom:12px}.row{display:grid;grid-template-columns:160px 1fr;gap:10px;margin:10px 0;font-size:13px}.bar{display:grid;grid-template-columns:190px 1fr 48px;gap:12px;align-items:center;margin:13px 0}.bar span,.table span{display:block;color:#64748b;font-size:11px;margin-top:2px}.track{height:9px;background:#e5e7eb;border-radius:99px;overflow:hidden}.track i{display:block;height:9px;border-radius:99px}.warn{background:#fff7ed;border-color:#fed7aa}.ai{background:#f4f0ff;border-radius:14px;padding:14px;font-size:13px;line-height:1.55}.small{font-size:13px;line-height:1.55}.pill{display:inline-block;padding:5px 9px;border-radius:8px;font-size:11px;font-weight:900;background:#eef4ff;color:#2563eb}.table{width:100%;border-collapse:collapse;font-size:12px}.table th{background:#f8fafc;text-align:left;padding:8px;border-bottom:1px solid #e5e7eb}.table td{padding:8px;border-bottom:1px solid #e5e7eb;vertical-align:top}@media(max-width:1100px){.grid6,.grid3,.grid2{grid-template-columns:1fr}.bar{grid-template-columns:1fr}}</style></head><body><div class="page"><div class="header"><div class="kicker">Programme Execution & Institutional Coordination Interface</div><div class="top"><div><div class="title">${esc(d.programName)}</div><div class="meta"><div><b>Program ID:</b> ${esc(d.programId)}</div><div><b>Lead Authority:</b> ${esc(d.leadAuthority)}</div><div><b>Status:</b> ${esc(d.statusText)}</div><div><b>Validation:</b> ${esc(d.reviewStatus)}</div></div></div><div class="badge">${esc(d.reviewPriority)} Review Priority</div></div></div><div class="grid6"><div class="card kpi"><div>Execution Condition</div><b style="color:${color(d.governanceScore)}">${pct(d.governanceScore)}</b><div class="sub">${label(d.governanceScore)}</div></div><div class="card kpi"><div>Continuity Posture</div><b style="color:${color(d.continuityScore)}">${pct(d.continuityScore)}</b><div class="sub">Programme continuity</div></div><div class="card kpi"><div>Coordination Health</div><b style="color:${color(d.coordinationScore)}">${pct(d.coordinationScore)}</b><div class="sub">Cross-action coherence</div></div><div class="card kpi"><div>Monitoring Reliability</div><b style="color:${color(d.monitoringScore)}">${pct(d.monitoringScore)}</b><div class="sub">C4 visibility</div></div><div class="card kpi"><div>Escalation Readiness</div><b style="color:${color(d.escalationScore)}">${pct(d.escalationScore)}</b><div class="sub">C5 response chain</div></div><div class="card kpi"><div>Critical Actions</div><b style="color:#f97316">${esc(d.criticalActions)}</b><div class="sub">Below threshold</div></div></div><div class="grid3"><div class="card"><div class="section">Institutional Coordination Map</div><div class="row"><b>Lead Authority</b><div>${esc(d.leadAuthority)}</div></div><div class="row"><b>Supporting Authorities</b><div>${esc(d.supportingAuthorities)}</div></div><div class="row"><b>Coordination Owner</b><div>${esc(d.coordinationOwner)}</div></div><div class="row"><b>Escalation Authority</b><div>${esc(d.escalationAuthority)}</div></div><div class="row"><b>Validation Authority</b><div>${esc(d.validationAuthority)}</div></div></div><div class="card"><div class="section">Operational Dependency Matrix</div>${bar("Resource continuity", d.resourceScore, "C3 funding and resource feasibility")}${bar("Monitoring reliability", d.monitoringScore, "C4 data continuity")}${bar("Escalation readiness", d.escalationScore, "C5 trigger and response integrity")}${bar("Auditability integrity", d.auditScore, "C6 traceability chain")}${bar("Coordination health", d.coordinationScore, "Cross-action institutional coherence")}</div><div class="card warn"><div class="section">Programme Trigger Monitor</div><div class="small"><b>Weakest Layer:</b> ${esc(d.weakestLayer)}</div><br/><div class="small"><b>Weakest Action:</b> ${esc(d.weakestAction)}</div><br/><span class="pill">Renderer active</span></div></div><div class="grid2"><div class="card"><div class="section">Execution Diagnostics</div><div class="small"><b>Resource:</b> ${esc(d.resourceDiagnosis)}</div><br/><div class="small"><b>Monitoring:</b> ${esc(d.monitoringDiagnosis)}</div><br/><div class="small"><b>Escalation:</b> ${esc(d.escalationDiagnosis)}</div><br/><div class="small"><b>Audit:</b> ${esc(d.auditDiagnosis)}</div></div><div class="card"><div class="section">Programme Operational Narrative</div><div class="ai">${esc(d.summary)}</div></div></div><div class="card"><div class="section">Linked Action Continuity Heatmap</div><table class="table"><thead><tr><th>Action</th><th>Coherence</th><th>Weakest Layer</th><th>Workflow</th><th>Status</th></tr></thead><tbody>${actionRows(d.actions)}</tbody></table></div></div></body></html>`;
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
