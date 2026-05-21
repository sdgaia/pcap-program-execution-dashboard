function esc(value: any): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getRecordId(req: any): string {
  const q = req.query?.recordId;
  if (typeof q === "string" && q.trim()) return q.trim();
  const match = String(req.url || "").match(/[?&]recordId=([^&]+)/);
  return match?.[1] ? decodeURIComponent(match[1]).trim() : "";
}

function isRecId(value: any): boolean {
  return typeof value === "string" && /^rec[a-zA-Z0-9]{10,}$/.test(value.trim());
}

function displayValue(value: any, fallback = ""): string {
  if (Array.isArray(value)) {
    const mapped = value
      .map((v) => {
        if (typeof v === "string") return isRecId(v) ? "" : v;
        if (v?.name) return v.name;
        if (v?.filename) return v.filename;
        if (v?.id && !isRecId(v.id)) return v.id;
        return "";
      })
      .filter(Boolean);
    return mapped.length ? mapped.join(", ") : fallback;
  }

  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string") return isRecId(value) ? fallback : value;
  if (typeof value === "object") return value.name || value.filename || fallback;
  return String(value);
}

function pick(fields: any, names: string[], fallback = "—") {
  for (const name of names) {
    const rendered = displayValue(fields?.[name], "");
    if (rendered) return rendered;
  }
  return fallback;
}

function numberValue(value: any): number | null {
  if (Array.isArray(value)) return value.length ? numberValue(value[0]) : null;
  if (value === undefined || value === null || value === "") return null;
  const n = Number(String(value).replace("%", "").trim());
  if (Number.isNaN(n)) return null;
  return n > 1 && n <= 100 ? n / 100 : n;
}

function pct(value: any) {
  const n = numberValue(value);
  return n === null ? "—" : `${Math.round(n * 100)}%`;
}

function color(value: any) {
  const n = numberValue(value);
  if (n === null) return "#94a3b8";
  if (n >= 0.8) return "#07923b";
  if (n >= 0.6) return "#2563eb";
  if (n >= 0.4) return "#f97316";
  return "#dc2626";
}

function status(value: any) {
  const n = numberValue(value);
  if (n === null) return "Placeholder";
  if (n >= 0.8) return "Stable";
  if (n >= 0.6) return "Partial";
  if (n >= 0.4) return "Fragile";
  return "Critical";
}

function bar(label: string, value: any, note: string) {
  const n = Math.round((numberValue(value) ?? 0) * 100);
  return `<div class="bar"><div><b>${esc(label)}</b><span>${esc(note)}</span></div><div class="track"><i style="width:${n}%;background:${color(value)}"></i></div><strong>${pct(value)}</strong></div>`;
}

async function airtableFetch(url: string, token: string) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  const text = await response.text();
  if (!response.ok) throw new Error(`Airtable ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function loadProgram(recordId: string) {
  const token = process.env.AIRTABLE || process.env.AIRTABLE_API_KEY || "";
  if (!token) throw new Error("Missing AIRTABLE environment variable.");
  const baseId = process.env.AIRTABLE_BASE_ID || "app1ulAFNbDuizG4n";
  const table = process.env.AIRTABLE_PROGRAMS_TABLE || "tblb080LKdZLFit2x";
  const formula = `OR(RECORD_ID()="${recordId}",{Program ID}="${recordId}")`;
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;
  const data = await airtableFetch(url, token);
  if (!data.records?.length) throw new Error(`No Program found for ${recordId}`);
  return data.records[0];
}

function buildData(program: any, runtimeMessage = "") {
  const f = program?.fields || {};
  return {
    programId: pick(f, ["Program ID"], program?.id || "PLACEHOLDER"),
    programName: pick(f, ["Program Name"], "Programme Execution Dashboard"),
    leadAuthority: pick(f, ["Lead Authority Name", "Lead Authority Names", "Lead Authority Display", "Lead Authority Lookup", "Lead Authority (Name)", "Lead Authority"], "Not specified"),
    supportingAuthorities: pick(f, ["Supporting Authorities Names", "Supporting Authority Names", "Supporting Authorities Display", "Supporting Authorities Lookup", "Supporting Authorities (Name)", "Supporting Authorities"], "Not specified"),
    coordinationOwner: pick(f, ["Coordination Owner Name", "Coordination Owner Display", "Coordination Owner Lookup", "Coordination Owner (Name)", "Coordination Owner"], "Not specified"),
    escalationAuthority: pick(f, ["Escalation Authority Name", "Escalation Authority Names", "Escalation Authority Display", "Escalation Authority Lookup", "Escalation Authority (Name)", "Escalation Authority"], "Not specified"),
    validationAuthority: pick(f, ["Validation Authority Name", "Validation Authority Names", "Validation Authority Display", "Validation Authority Lookup", "Validation Authority (Name)", "Validation Authority"], "Not specified"),
    statusText: pick(f, ["Status"], "Draft / Placeholder"),
    reviewStatus: pick(f, ["Program Review Status"], "Pending review"),
    reviewPriority: pick(f, ["Reviewer Priority"], "Medium"),
    governanceScore: f["Program Governance Score"] ?? f["Program Coherence Score"],
    continuityScore: f["Program Continuity Score"] ?? f["Programme Stability Index"],
    coordinationScore: f["Cross-Action Coherence"] ?? f["Program Governance Score"],
    resourceScore: f["C3 Score"] ?? f["C3 Continuity Score"],
    monitoringScore: f["C4 Score"] ?? f["C4 Continuity Score"],
    escalationScore: f["C5 Score"] ?? f["C5 Continuity Score"],
    auditScore: f["C6 Score"] ?? f["C6 Continuity Score"],
    criticalActions: pick(f, ["Critical Actions Count"], "0"),
    weakestLayer: pick(f, ["Weakest Governance Layer"], "Not assessed"),
    weakestAction: pick(f, ["Weakest Action"], "Not assessed"),
    resourceDiagnosis: pick(f, ["Resources Diagnosis"], "Resource diagnosis placeholder."),
    monitoringDiagnosis: pick(f, ["Monitoring Diagnosis"], "Monitoring diagnosis placeholder."),
    escalationDiagnosis: pick(f, ["Escalation Diagnosis"], "Escalation diagnosis placeholder."),
    auditDiagnosis: pick(f, ["Audit Trail Diagnosis"], "Audit trail diagnosis placeholder."),
    summary: runtimeMessage || pick(f, ["Program Governance Summary (AI)", "Program Governance Summary"], "Placeholder dashboard rendered successfully. Add programme fields and linked actions to populate the full execution view.")
  };
}

function renderDashboard(d: any) {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(d.programName)}</title><style>
*{box-sizing:border-box}body{margin:0;background:#f6f8fc;color:#07164a;font-family:Arial,sans-serif;padding:18px}.page{max-width:1500px;margin:0 auto}.header,.card{background:#fff;border:1px solid #e8edf5;border-radius:16px;padding:18px;box-shadow:0 8px 24px rgba(15,23,42,.05)}.header{margin-bottom:14px}.kicker{font-size:12px;font-weight:900;text-transform:uppercase;color:#2563eb;margin-bottom:8px}.top{display:flex;justify-content:space-between;gap:18px}.title{font-size:30px;font-weight:900}.meta{display:flex;flex-wrap:wrap;gap:18px;margin-top:10px;font-size:13px}.badge{background:#eef4ff;color:#2563eb;border-radius:10px;padding:8px 12px;font-weight:900}.grid6{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:14px}.grid3{display:grid;grid-template-columns:1fr 1.15fr 1fr;gap:14px;margin-bottom:14px}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}.kpi{text-align:center}.kpi b{display:block;font-size:31px;margin:8px 0}.sub{font-size:12px;font-weight:800;color:#64748b}.section{font-size:18px;font-weight:900;margin-bottom:12px}.row{display:grid;grid-template-columns:150px 1fr;gap:10px;margin:10px 0;font-size:13px}.bar{display:grid;grid-template-columns:190px 1fr 48px;gap:12px;align-items:center;margin:13px 0}.bar span{display:block;color:#64748b;font-size:11px;margin-top:2px}.track{height:9px;background:#e5e7eb;border-radius:99px;overflow:hidden}.track i{display:block;height:9px;border-radius:99px}.warn{background:#fff7ed;border-color:#fed7aa}.ai{background:#f4f0ff;border-radius:14px;padding:14px;font-size:13px;line-height:1.55}.small{font-size:13px;line-height:1.55}.pill{display:inline-block;padding:5px 9px;border-radius:8px;font-size:11px;font-weight:900;background:#eef4ff;color:#2563eb}@media(max-width:1100px){.grid6,.grid3,.grid2{grid-template-columns:1fr}.bar{grid-template-columns:1fr}}
</style></head><body><div class="page"><div class="header"><div class="kicker">Programme Execution & Institutional Coordination Interface</div><div class="top"><div><div class="title">${esc(d.programName)}</div><div class="meta"><div><b>Program ID:</b> ${esc(d.programId)}</div><div><b>Lead Authority:</b> ${esc(d.leadAuthority)}</div><div><b>Status:</b> ${esc(d.statusText)}</div><div><b>Validation:</b> ${esc(d.reviewStatus)}</div></div></div><div class="badge">${esc(d.reviewPriority)} Review Priority</div></div></div>
<div class="grid6"><div class="card kpi"><div>Execution Condition</div><b style="color:${color(d.governanceScore)}">${pct(d.governanceScore)}</b><div class="sub">${status(d.governanceScore)}</div></div><div class="card kpi"><div>Continuity Posture</div><b style="color:${color(d.continuityScore)}">${pct(d.continuityScore)}</b><div class="sub">Programme continuity</div></div><div class="card kpi"><div>Coordination Health</div><b style="color:${color(d.coordinationScore)}">${pct(d.coordinationScore)}</b><div class="sub">Cross-action coherence</div></div><div class="card kpi"><div>Monitoring Reliability</div><b style="color:${color(d.monitoringScore)}">${pct(d.monitoringScore)}</b><div class="sub">C4 visibility</div></div><div class="card kpi"><div>Escalation Readiness</div><b style="color:${color(d.escalationScore)}">${pct(d.escalationScore)}</b><div class="sub">C5 response chain</div></div><div class="card kpi"><div>Critical Actions</div><b style="color:#f97316">${esc(d.criticalActions)}</b><div class="sub">Below threshold</div></div></div>
<div class="grid3"><div class="card"><div class="section">Institutional Coordination Map</div><div class="row"><b>Lead Authority</b><div>${esc(d.leadAuthority)}</div></div><div class="row"><b>Supporting Authorities</b><div>${esc(d.supportingAuthorities)}</div></div><div class="row"><b>Coordination Owner</b><div>${esc(d.coordinationOwner)}</div></div><div class="row"><b>Escalation Authority</b><div>${esc(d.escalationAuthority)}</div></div><div class="row"><b>Validation Authority</b><div>${esc(d.validationAuthority)}</div></div></div><div class="card"><div class="section">Operational Dependency Matrix</div>${bar("Resource continuity", d.resourceScore, "C3 funding and resource feasibility")}${bar("Monitoring reliability", d.monitoringScore, "C4 data continuity")}${bar("Escalation readiness", d.escalationScore, "C5 trigger and response integrity")}${bar("Auditability integrity", d.auditScore, "C6 traceability chain")}${bar("Coordination health", d.coordinationScore, "Cross-action institutional coherence")}</div><div class="card warn"><div class="section">Programme Trigger Monitor</div><div class="small"><b>Weakest Layer:</b> ${esc(d.weakestLayer)}</div><br/><div class="small"><b>Weakest Action:</b> ${esc(d.weakestAction)}</div><br/><span class="pill">Renderer active</span></div></div>
<div class="grid2"><div class="card"><div class="section">Execution Diagnostics</div><div class="small"><b>Resource:</b> ${esc(d.resourceDiagnosis)}</div><br/><div class="small"><b>Monitoring:</b> ${esc(d.monitoringDiagnosis)}</div><br/><div class="small"><b>Escalation:</b> ${esc(d.escalationDiagnosis)}</div><br/><div class="small"><b>Audit:</b> ${esc(d.auditDiagnosis)}</div></div><div class="card"><div class="section">Programme Operational Narrative</div><div class="ai">${esc(d.summary)}</div></div></div></div></body></html>`;
}

export default async function handler(req: any, res: any) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  try {
    const recordId = getRecordId(req);
    const program = recordId ? await loadProgram(recordId) : null;
    res.statusCode = 200;
    res.end(renderDashboard(buildData(program)));
  } catch (error: any) {
    res.statusCode = 200;
    res.end(renderDashboard(buildData(null, `Runtime error captured without crashing: ${error?.message || String(error)}`)));
  }
}
