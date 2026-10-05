// Data layer: talks to the local bridge server (src/server.mjs), which serves this page.
(() => {
const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const DAYS = ["mon","tue","wed","thu","fri","sat","sun"];

async function call(method, path, body) {
  const r = await fetch("/api" + path, {
    method, headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(180000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

window.API = {
  DAYS, iso,
  sessions: (from, to) => call("GET", `/sessions?from=${iso(from)}&to=${iso(to)}`),
  saveSession: s => s.id ? call("PUT", `/sessions/${s.id}`, s) : call("POST", "/sessions", s),
  deleteSession: id => call("DELETE", `/sessions/${id}`),
  progress: () => call("GET", "/progress"),
  refreshGarmin: () => call("POST", "/garmin/refresh"),
  status: () => call("GET", "/status"),
  getSelection: () => call("GET", "/class-selection"),
  saveSelection: sel => call("POST", "/class-selection", sel),
  sync: () => call("POST", "/sync"),
  apply: withFree => call("POST", "/apply", { withFree }),
};
})();
