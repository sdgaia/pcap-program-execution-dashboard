
import express from "express";

const app = express();
app.use(express.json({ limit: "2mb" }));

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || "";
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || "";
const AIRTABLE_PROGRAMS_TABLE = process.env.AIRTABLE_PROGRAMS_TABLE || "tblb080LKdZLFit2x";
const AIRTABLE_ACTIONS_TABLE = process.env.AIRTABLE_ACTIONS_TABLE || "tblaMHswXQx4r9ba1";

function getRecordId(req: any): string {
  const q = req.query?.recordId;
  if (typeof q === "string" && q.trim()) return decodeURIComponent(q.trim());
  const match = (req.url || "").match(/[?&]recordId=([^&]+)/);
  return match?.[1] ? decodeURIComponent(match[1].trim()) : "";
}

function esc(v: any): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function raw(fields: any, name: string): any {
  return fields?.[name];
}

function displayValue(value: any, fallback = ""): string {
  if (Array.isArray(value)) {
    const mapped = value.map(v => {
      if (typeof v === "string") return v.startsWith("rec") ? "" : v;
      if (v?.name) return v.name;
      if (v?.filename) return v.filename;
      return "";
    }).filter(Boolean);
    return mapped.length ? mapped.join(", ") : fallback;
  }

  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value?.name || value?.id || fallback;
  return String(value);
}

function field(fields: any, name: string, fallback = ""): string {
  return displayValue(fields?.[name], fallback);
}

function num(value: any): number | null {
  if (Array.isArray(value)) return value.length ? num(value[0]) : null;
  if (value === null || value === undefined || value === "") return null;
  const cleaned = String(value).replace("%", "").trim();
  const n = Number(cleaned);
  if (Number.isNaN(n)) return null;
  if (n > 1 && n <= 100) return n / 100;
  return n;
}

function pct(value: any): string {
  const n = num(value);
  if (n === null) return "—";
  return `${Math.round(n * 100)}%`;
}

function scoreColor(value: any): string {
  const n = num(value);
  if (n === null) return "#94a3b8";
  if (n >= 0.8) return "#07923b";
  if (n >= 0.6) return "#2563eb";
  if (n >= 0.4) return "#f97316";
  return "#dc2626";
}

function statusLabel(value: any): string {
  const n = num(value);
  if (n === null) return "No data";
  if (n >= 0.8) return "Stable";
  if (n >= 0.6) return "Partial";
  if (n >= 0.4) return "Fragile";
  return "Critical";
}

async function airtableFetch(url: string) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      "Content-Type": "application/json"
    }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Airtable fetch failed: ${response.status} ${text}`);
  }

  return JSON.parse(text);
}

async function fetchProgramByRecordId(recordId: string) {
  if (!AIRTABLE_API_KEY) throw new Error("Missing AIRTABLE_API_KEY.");
  if (!AIRTABLE_BASE_ID) throw new Error("Missing AIRTABLE_BASE_ID.");

  const formula = `OR(RECORD_ID()="${recordId}",{Program ID}="${recordId}")`;

  const url =
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_PROGRAMS_TABLE)}` +
    `?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;

  const data = await airtableFetch(url);

  if (!data.records || data.records.length === 0) {
    throw new Error(`No Program found for: ${recordId}`);
  }

  return data.records[0];
}

async function fetchActionById(actionRecordId: string) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(
    AIRTABLE_ACTIONS_TABLE
  )}/${actionRecordId}`;

  return await airtableFetch(url);
}

async function fetchLinkedActions(programRecord: any) {
  const linked = programRecord.fields?.["Linked Actions"] || [];

  if (!Array.isArray(linked) || linked.length === 0) return [];

  const actions = [];

  for (const actionId of linked) {
    try {
      const actionRecord = await fetchActionById(actionId);
      actions.push(actionRecord);
    } catch (e: any) {
      console.log(`Failed to fetch linked action ${actionId}: ${e.message}`);
    }
  }

  return actions;
}

function bar(label: string, value: any, sub = "") {
  const n = Math.round((num(value) ?? 0) * 100);

  return `
  <div class="bar-row">
    <div class="bar-label">
      <b>${esc(label)}</b>
      ${sub ? `<span>${esc(sub)}</span>` : ""}
    </div>
    <div class="bar-track">
      <div class="bar-fill" style="width:${n}%;background:${scoreColor(value)}"></div>
    </div>
    <div class="bar-value">${n}%</div>
  </div>`;
}

function statusPill(label: string, value: any) {
  return `<span class="pill" style="background:${scoreColor(value)}22;color:${scoreColor(value)}">${esc(label)}</span>`;
}

function actionRows(actions: any[]) {
  if (!actions.length) {
    return `<tr><td colspan="6">No linked actions available.</td></tr>`;
  }

  return actions.map(action => {
    const f = action.fields || {};
    const id = field(f, "Action ID", action.id);
    const name = field(f, "Action Name", "Untitled action");
    const coherence = raw(f, "Overall Coherence");
    const ociO = raw(f, "OCI-O");
    const weakest = field(f, "Weakest Component", "Not assessed");
    const workflow = field(f, "Workflow Step", "Not specified");

    return `
    <tr>
      <td><b>${esc(id)}</b><br/><span>${esc(name)}</span></td>
      <td><b style="color:${scoreColor(coherence)}">${pct(coherence)}</b></td>
      <td><b style="color:${scoreColor(ociO)}">${pct(ociO)}</b></td>
      <td>${esc(weakest)}</td>
      <td>${esc(workflow)}</td>
      <td>${statusPill(statusLabel(ociO), ociO)}</td>
    </tr>`;
  }).join("");
}

function bottleneckItems(data: any) {
  const items = [
    {
      title: "Institutional coordination",
      text: data.coordinationRisk || "Coordination structure requires reviewer confirmation.",
      level: data.coordinationScore
    },
    {
      title: "Monitoring reliability",
      text: data.monitoringDiagnosis || "Monitoring reliability requires validation.",
      level: data.monitoringScore
    },
    {
      title: "Escalation readiness",
      text: data.escalationDiagnosis || "Escalation pathway requires validation.",
      level: data.escalationScore
    },
    {
      title: "Resource continuity",
      text: data.resourceDiagnosis || "Resource continuity requires validation.",
      level: data.resourceScore
    }
  ];

  return items.map(item => `
    <div class="bottleneck-item">
      <div class="bottleneck-top">
        <b>${esc(item.title)}</b>
        ${statusPill(statusLabel(item.level), item.level)}
      </div>
      <div class="bottleneck-text">${esc(item.text)}</div>
    </div>
  `).join("");
}

function triggerMonitor(data: any) {
  return `
  <div class="trigger-grid">
    <div class="trigger-box">
      <div class="trigger-num">${esc(data.escalationExposure)}</div>
      <div class="trigger-label">Escalation Exposure</div>
    </div>
    <div class="trigger-box">
      <div class="trigger-num">${esc(data.criticalActions)}</div>
      <div class="trigger-label">Critical Actions</div>
    </div>
    <div class="trigger-box">
      <div class="trigger-num">${esc(data.validationStatus)}</div>
      <div class="trigger-label">Validation Status</div>
    </div>
  </div>`;
}

function buildDashboardData(program: any, actions: any[]) {
  const f = program.fields || {};

  const coordinationScore =
    raw(f, "Cross-Action Coherence") ||
    raw(f, "Program Governance Score");

  const resourceScore =
    raw(f, "C3 Score") ||
    raw(f, "C3 Continuity Score");

  const monitoringScore =
    raw(f, "C4 Score") ||
    raw(f, "C4 Continuity Score");

  const escalationScore =
    raw(f, "C5 Score") ||
    raw(f, "C5 Continuity Score");

  const auditScore =
    raw(f, "C6 Score") ||
    raw(f, "C6 Continuity Score");

  const continuityScore =
    raw(f, "Program Continuity Score") ||
    raw(f, "Programme Stability Index");

  return {
    programId: field(f, "Program ID", program.id),
    programName: field(f, "Program Name", "Programme Execution Dashboard"),
    leadAuthority: field(f, "Lead Authority", "Not specified"),
    supportingAuthorities: field(f, "Supporting Authorities", "Not specified"),
    coordinationOwner: field(f, "Coordination Owner", "Not specified"),
    escalationAuthority: field(f, "Escalation Authority", "Not specified"),
    validationAuthority: field(f, "Validation Authority", "Not specified"),
    status: field(f, "Status", "Not specified"),
    validationStatus: field(f, "Program Review Status", "Pending review"),
    reviewPriority: field(f, "Reviewer Priority", "Medium"),

    governanceScore:
      raw(f, "Program Governance Score") ||
      raw(f, "Program Coherence Score"),

    continuityScore,
    coordinationScore,
    resourceScore,
    monitoringScore,
    escalationScore,
    auditScore,

    escalationExposure:
      field(f, "Program Escalation Exposure") ||
      field(f, "Escalation Exposure") ||
      "0",

    criticalActions: field(f, "Critical Actions Count", "0"),
    weakestLayer: field(f, "Weakest Governance Layer", "Not assessed"),
    weakestAction: field(f, "Weakest Action", "Not assessed"),

    coordinationRisk:
      field(f, "Cross-Action Contradictions") ||
      field(f, "Cross-Action Contradictions (AI)", ""),

    policyDiagnosis: field(f, "Policy Diagnosis", "No policy diagnosis available."),
    operationsDiagnosis: field(f, "Operations Diagnosis", "No operations diagnosis available."),
    resourceDiagnosis: field(f, "Resources Diagnosis", "No resource diagnosis available."),
    monitoringDiagnosis: field(f, "Monitoring Diagnosis", "No monitoring diagnosis available."),
    escalationDiagnosis: field(f, "Escalation Diagnosis", "No escalation diagnosis available."),
    auditDiagnosis: field(f, "Audit Trail Diagnosis", "No audit diagnosis available."),

    synthesis:
      field(f, "Program Governance Summary (AI)") ||
      field(f, "Program Governance Summary") ||
      "No execution synthesis available yet.",

    reviewerAction:
      field(f, "Reviewer Action Required") ||
      field(f, "Recommended Reviewer Focus", "Review programme execution coherence."),

    actions
  };
}

function renderDashboard(data: any): string {
  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>${esc(data.programId)} Execution Dashboard</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#f6f8fc;color:#07164a;font-family:Arial,sans-serif;padding:18px}
.page{max-width:1680px;margin:0 auto}
.header{background:#fff;border:1px solid #e8edf5;border-radius:18px;padding:18px 22px;box-shadow:0 8px 24px rgba(15,23,42,.06);margin-bottom:14px}
.interface{font-size:12px;font-weight:900;color:#2563eb;text-transform:uppercase;margin-bottom:10px}
.topline{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
.title{font-size:28px;font-weight:900;line-height:1.15}
.meta{display:flex;flex-wrap:wrap;gap:22px;margin-top:12px;font-size:13px}
.badge{background:#eef4ff;color:#2563eb;padding:8px 12px;border-radius:10px;font-weight:900}
.grid-kpi{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:14px}
.card{background:#fff;border:1px solid #e8edf5;border-radius:14px;padding:18px;box-shadow:0 8px 24px rgba(15,23,42,.05)}
.kpi-title{font-weight:900;font-size:13px;text-align:center;margin-bottom:10px}
.kpi-score{font-size:31px;font-weight:900;text-align:center;line-height:1}
.kpi-sub{text-align:center;margin-top:8px;font-size:12px;font-weight:800;color:#64748b}
.grid-main{display:grid;grid-template-columns:1fr 1.1fr 1fr;gap:14px;margin-bottom:14px}
.grid-lower{display:grid;grid-template-columns:1.1fr 1fr;gap:14px;margin-bottom:14px}
.section-title{font-size:18px;font-weight:900;margin-bottom:12px}
.bar-row{display:grid;grid-template-columns:190px 1fr 44px;gap:12px;align-items:center;margin:13px 0}
.bar-label{font-size:13px}
.bar-label span{display:block;color:#64748b;font-size:11px;margin-top:2px}
.bar-track{height:9px;background:#e5e7eb;border-radius:99px;overflow:hidden}
.bar-fill{height:9px;border-radius:99px}
.bar-value{text-align:right;font-size:13px;font-weight:900}
.pill{display:inline-block;padding:5px 9px;border-radius:8px;font-size:11px;font-weight:900}
.institution-row{display:grid;grid-template-columns:150px 1fr;gap:10px;margin:10px 0;font-size:13px}
.trigger-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.trigger-box{background:#f8fafc;border:1px solid #e8edf5;border-radius:12px;padding:14px;text-align:center}
.trigger-num{font-size:25px;font-weight:900;color:#f97316}
.trigger-label{font-size:12px;font-weight:800;color:#64748b}
.bottleneck-item{border-bottom:1px solid #e5e7eb;padding:11px 0}
.bottleneck-item:last-child{border-bottom:none}
.bottleneck-top{display:flex;justify-content:space-between;gap:10px;align-items:center}
.bottleneck-text{font-size:13px;line-height:1.45;color:#334155;margin-top:7px}
.table{width:100%;border-collapse:collapse;font-size:12px}
.table th{background:#f8fafc;text-align:left;padding:8px;border-bottom:1px solid #e5e7eb}
.table td{padding:8px;border-bottom:1px solid #e5e7eb;vertical-align:top}
.table span{font-size:11px;color:#64748b}
.ai-box{background:#f4f0ff;border-radius:14px;padding:14px;font-size:13px;line-height:1.55}
.priority{background:#eef4ff}
.warn{background:#fff7ed;border:1px solid #fed7aa}
.small{font-size:13px;line-height:1.55}
@media(max-width:1200px){.grid-kpi,.grid-main,.grid-lower{grid-template-columns:1fr}.bar-row{grid-template-columns:1fr}.bar-value{text-align:left}}
</style>
</head>
<body>
<div class="page">

  <div class="header">
    <div class="interface">Programme Execution & Institutional Coordination Interface</div>
    <div class="topline">
      <div>
        <div class="title">${esc(data.programName)}</div>
        <div class="meta">
          <div><b>Program ID:</b> ${esc(data.programId)}</div>
          <div><b>Lead Authority:</b> ${esc(data.leadAuthority)}</div>
          <div><b>Status:</b> ${esc(data.status)}</div>
          <div><b>Validation:</b> ${esc(data.validationStatus)}</div>
        </div>
      </div>
      <div class="badge">${esc(data.reviewPriority)} Review Priority</div>
    </div>
  </div>

  <div class="grid-kpi">
    <div class="card"><div class="kpi-title">Execution Condition</div><div class="kpi-score" style="color:${scoreColor(data.governanceScore)}">${pct(data.governanceScore)}</div><div class="kpi-sub">${statusLabel(data.governanceScore)}</div></div>
    <div class="card"><div class="kpi-title">Continuity Posture</div><div class="kpi-score" style="color:${scoreColor(data.continuityScore)}">${pct(data.continuityScore)}</div><div class="kpi-sub">Programme continuity</div></div>
    <div class="card"><div class="kpi-title">Coordination Health</div><div class="kpi-score" style="color:${scoreColor(data.coordinationScore)}">${pct(data.coordinationScore)}</div><div class="kpi-sub">Cross-action coherence</div></div>
    <div class="card"><div class="kpi-title">Monitoring Reliability</div><div class="kpi-score" style="color:${scoreColor(data.monitoringScore)}">${pct(data.monitoringScore)}</div><div class="kpi-sub">C4 execution visibility</div></div>
    <div class="card"><div class="kpi-title">Escalation Readiness</div><div class="kpi-score" style="color:${scoreColor(data.escalationScore)}">${pct(data.escalationScore)}</div><div class="kpi-sub">C5 response chain</div></div>
    <div class="card"><div class="kpi-title">Critical Actions</div><div class="kpi-score" style="color:#f97316">${esc(data.criticalActions)}</div><div class="kpi-sub">Below threshold</div></div>
  </div>

  <div class="grid-main">
    <div class="card">
      <div class="section-title">Institutional Coordination Map</div>
      <div class="institution-row"><b>Lead Authority</b><div>${esc(data.leadAuthority)}</div></div>
      <div class="institution-row"><b>Supporting Authorities</b><div>${esc(data.supportingAuthorities)}</div></div>
      <div class="institution-row"><b>Coordination Owner</b><div>${esc(data.coordinationOwner)}</div></div>
      <div class="institution-row"><b>Escalation Authority</b><div>${esc(data.escalationAuthority)}</div></div>
      <div class="institution-row"><b>Validation Authority</b><div>${esc(data.validationAuthority)}</div></div>
    </div>

    <div class="card">
      <div class="section-title">Operational Dependency Matrix</div>
      ${bar("Resource continuity", data.resourceScore, "C3 funding and resource feasibility")}
      ${bar("Monitoring reliability", data.monitoringScore, "C4 data and reporting continuity")}
      ${bar("Escalation readiness", data.escalationScore, "C5 trigger and response integrity")}
      ${bar("Auditability integrity", data.auditScore, "C6 traceability and evidence chain")}
      ${bar("Coordination health", data.coordinationScore, "Cross-action institutional coherence")}
    </div>

    <div class="card warn">
      <div class="section-title">Programme Trigger Monitor</div>
      ${triggerMonitor(data)}
      <br/>
      <div class="small"><b>Weakest Layer:</b> ${esc(data.weakestLayer)}</div>
      <div class="small"><b>Weakest Action:</b> ${esc(data.weakestAction)}</div>
    </div>
  </div>

  <div class="grid-main">
    <div class="card">
      <div class="section-title">Institutional Bottlenecks</div>
      ${bottleneckItems(data)}
    </div>

    <div class="card">
      <div class="section-title">Resource & Funding Integrity</div>
      <div class="small"><b>Resource diagnosis:</b> ${esc(data.resourceDiagnosis)}</div><br/>
      <div class="small"><b>Operations diagnosis:</b> ${esc(data.operationsDiagnosis)}</div><br/>
      <div class="small"><b>Policy dependency:</b> ${esc(data.policyDiagnosis)}</div>
    </div>

    <div class="card">
      <div class="section-title">Escalation Flow Integrity</div>
      <div class="small"><b>Escalation diagnosis:</b> ${esc(data.escalationDiagnosis)}</div><br/>
      <div class="small"><b>Audit trail:</b> ${esc(data.auditDiagnosis)}</div><br/>
      <div class="small"><b>Reviewer action:</b> ${esc(data.reviewerAction)}</div>
    </div>
  </div>

  <div class="grid-lower">
    <div class="card">
      <div class="section-title">Action Continuity Heatmap</div>
      <table class="table">
        <thead>
          <tr>
            <th>Action</th>
            <th>Coherence</th>
            <th>OCI-O</th>
            <th>Weakest Layer</th>
            <th>Workflow</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${actionRows(data.actions)}
        </tbody>
      </table>
    </div>

    <div class="card priority">
      <div class="section-title">Programme Operational Narrative</div>
      <div class="ai-box">${esc(data.synthesis)}</div>
    </div>
  </div>

</div>
</body>
</html>`;
}

app.get("/", (_req, res) => res.redirect("/api"));

app.get("/api", async (req, res) => {
  try {
    const recordId = getRecordId(req);

    if (!recordId) {
      return res.type("html").send(
        renderDashboard({
          programId: "Demo",
          programName: "Missing recordId",
          leadAuthority: "Add ?recordId=recXXXXXXXX to the URL",
          supportingAuthorities: "Demo",
          coordinationOwner: "Demo",
          escalationAuthority: "Demo",
          validationAuthority: "Demo",
          status: "Demo",
          validationStatus: "Demo",
          reviewPriority: "Demo",
          governanceScore: null,
          continuityScore: null,
          coordinationScore: null,
          resourceScore: null,
          monitoringScore: null,
          escalationScore: null,
          auditScore: null,
          escalationExposure: "0",
          criticalActions: "0",
          weakestLayer: "No data",
          weakestAction: "No data",
          coordinationRisk: "No data",
          policyDiagnosis: "No data.",
          operationsDiagnosis: "No data.",
          resourceDiagnosis: "No data.",
          monitoringDiagnosis: "No data.",
          escalationDiagnosis: "No data.",
          auditDiagnosis: "No data.",
          synthesis: "Add a valid Program recordId to render the execution dashboard.",
          reviewerAction: "No data.",
          actions: []
        })
      );
    }

    const program = await fetchProgramByRecordId(recordId);
    const actions = await fetchLinkedActions(program);
    const data = buildDashboardData(program, actions);

    return res.type("html").send(renderDashboard(data));
  } catch (error: any) {
    return res.status(500).json({
      error: error.message || String(error)
    });
  }
});

app.post("/api", (req, res) => {
  res.type("html").send(renderDashboard(req.body || {}));
});

export default app;
