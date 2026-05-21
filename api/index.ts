function esc(value: any): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getRecordId(req: any): string {
  const q = req.query?.recordId;
  if (typeof q === "string" && q.trim()) return q.trim();
  const url = req.url || "";
  const match = url.match(/[?&]recordId=([^&]+)/);
  return match?.[1] ? decodeURIComponent(match[1]).trim() : "";
}

function render(title: string, body: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<style>
body{margin:0;background:#f6f8fc;color:#07164a;font-family:Arial,sans-serif;padding:24px}.page{max-width:1100px;margin:0 auto}.card{background:#fff;border:1px solid #e8edf5;border-radius:16px;padding:22px;box-shadow:0 8px 24px rgba(15,23,42,.06)}.kicker{font-size:12px;text-transform:uppercase;font-weight:900;color:#2563eb;margin-bottom:10px}.title{font-size:28px;font-weight:900;margin-bottom:12px}.body{font-size:14px;line-height:1.6;white-space:pre-wrap}.ok{color:#07923b;font-weight:900}.err{color:#dc2626;font-weight:900}
</style>
</head>
<body><div class="page"><div class="card"><div class="kicker">PCAP Programme Execution Dashboard</div><div class="title">${esc(title)}</div><div class="body">${body}</div></div></div></body>
</html>`;
}

async function airtableFetch(url: string, token: string) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Airtable ${response.status}: ${text}`);
  return JSON.parse(text);
}

export default async function handler(req: any, res: any) {
  try {
    const recordId = getRecordId(req);
    const token = process.env.AIRTABLE || process.env.AIRTABLE_API_KEY || "";
    const baseId = process.env.AIRTABLE_BASE_ID || "app1ulAFNbDuizG4n";
    const programsTable = process.env.AIRTABLE_PROGRAMS_TABLE || "tblb080LKdZLFit2x";

    if (!recordId) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(render("Renderer is live", `<span class="ok">Serverless function is running.</span>\n\nAdd ?recordId=recXXXX to test Airtable data.`));
      return;
    }

    if (!token) throw new Error("Missing AIRTABLE environment variable.");

    const formula = `OR(RECORD_ID()="${recordId}",{Program ID}="${recordId}")`;
    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(programsTable)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;
    const data = await airtableFetch(url, token);

    if (!data.records?.length) throw new Error(`No Program found for ${recordId}`);

    const program = data.records[0];
    const fields = program.fields || {};
    const programId = fields["Program ID"] || program.id;
    const programName = fields["Program Name"] || "Programme Execution Dashboard";
    const lead = fields["Lead Authority"] || "Not specified";
    const status = fields["Status"] || "Not specified";

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(render(String(programName), `<span class="ok">Airtable connection successful.</span>\n\nProgram ID: ${esc(programId)}\nRecord ID: ${esc(program.id)}\nLead Authority: ${esc(lead)}\nStatus: ${esc(status)}`));
  } catch (error: any) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(render("Renderer diagnostic", `<span class="err">Runtime error captured without crashing.</span>\n\n${esc(error?.message || String(error))}`));
  }
}
