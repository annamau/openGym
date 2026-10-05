const $ = s => document.querySelector(s);
const { iso, DAYS } = API;
const DOW = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const SEGS = [["Morning", t => t < "12:00"], ["Afternoon", t => t >= "12:00" && t < "18:00"], ["Evening", t => t >= "18:00"]];
const BADGE = { class: "Class", free: "Free workout", run: "Running plan", other: "Other" };
const EDITABLE = { run: "Running plan", other: "Other" };   // Aimharder classes and the suggested free workout are read-only
const state = { view: localStorage.getItem("view") || "week", date: new Date() };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const monday = d => addDays(d, -((d.getDay() + 6) % 7));
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));

function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2400); }

const card = s => `<div class="session ${s.type in BADGE ? s.type : "other"}${s.readOnly ? " ro" : ""}" data-id="${esc(s.id)}" title="${BADGE[s.type] || "Other"}">
  <div class="t">${esc(s.time)}</div><div class="n">${esc(s.title)}</div>${s.detail ? `<div class="d">${esc(s.detail)}</div>` : ""}
  ${(s.tags || []).length ? `<div class="tags">${s.tags.map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}</div>`;

function range() {
  const d = state.date;
  if (state.view === "day") return [d, d];
  if (state.view === "week") { const m = monday(d); return [m, addDays(m, 6)]; }
  const first = new Date(d.getFullYear(), d.getMonth(), 1), last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return [monday(first), addDays(monday(last), 6)];
}

function renderGrid(days, sessions) {
  const today = iso(new Date());
  let h = `<div class="board" style="--cols:${days.length}"><div class="rail-head"></div>`;
  SEGS.forEach(([name], i) => h += `<div class="railname" style="grid-row:${i + 2}">${name}</div>`);
  for (const d of days) {
    h += `<section class="day ${iso(d) === today ? "today" : ""}"><div class="dhead">${DOW[(d.getDay() + 6) % 7]} ${d.getDate()}</div>`;
    for (const [, test] of SEGS) {
      const list = sessions.filter(s => s.date === iso(d) && test(s.time)).sort((a, b) => a.time.localeCompare(b.time));
      h += `<div class="slot">${list.map(card).join("")}</div>`;
    }
    h += `</section>`;
  }
  return h + "</div>";
}

function renderMonth(sessions) {
  const [from] = range(), month = state.date.getMonth(), today = iso(new Date());
  let h = `<div class="month">${DOW.map(d => `<div class="mh">${d}</div>`).join("")}`;
  for (let i = 0; i < 42; i++) {
    const d = addDays(from, i); if (i >= 35 && d.getMonth() !== month) break;
    const list = sessions.filter(s => s.date === iso(d));
    h += `<div class="mcell ${d.getMonth() !== month ? "out" : ""} ${iso(d) === today ? "today" : ""}" data-date="${iso(d)}"><span class="mn">${d.getDate()}</span>
      <div class="dots">${list.map(s => `<i class="dot ${s.type in BADGE ? s.type : "other"}" title="${esc(s.title)}"></i>`).join("")}</div></div>`;
  }
  return h + "</div>";
}

async function render() {
  const [from, to] = range();
  document.querySelectorAll("#views button").forEach(b => b.classList.toggle("on", b.dataset.view === state.view));
  $("#viewLabel").textContent = state.view[0].toUpperCase() + state.view.slice(1);
  $("#title").textContent = state.date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  let sessions = [];
  try { sessions = await API.sessions(from, to); $("#mode").textContent = "● Connected to bridge"; }
  catch { $("#mode").textContent = "⚠ Bridge unreachable (is npm run ui still running?)"; }
  state.sessions = sessions;
  const days = state.view === "day" ? [state.date] : Array.from({ length: 7 }, (_, i) => addDays(from, i));
  $("#board").innerHTML = state.view === "month" ? renderMonth(sessions) : renderGrid(days, sessions);
}

function step(n) {
  const d = new Date(state.date);
  if (state.view === "month") d.setMonth(d.getMonth() + n); else d.setDate(d.getDate() + n * (state.view === "week" ? 7 : 1));
  state.date = d; render();
}

// events
$("#prev").onclick = () => step(-1); $("#next").onclick = () => step(1);
$("#today").onclick = () => { state.date = new Date(); render(); };
const setView = v => { state.view = v; localStorage.setItem("view", v); render(); };
$("#views").onclick = e => { const v = e.target.dataset.view; if (v) setView(v); };
const vMenu = $("#viewMenu"), vBtn = $("#viewBtn");
vMenu.innerHTML = ["day","week","month"].map(v => `<button class="menu-item" data-view="${v}"><b>${v[0].toUpperCase() + v.slice(1)}</b></button>`).join("");
const setVMenu = open => { vMenu.hidden = !open; vBtn.setAttribute("aria-expanded", open); };
vBtn.onclick = e => { e.stopPropagation(); setMenu(false); setVMenu(vMenu.hidden); };
vMenu.onclick = e => { const v = e.target.closest("[data-view]")?.dataset.view; if (v) { setVMenu(false); setView(v); } };
$("#board").onclick = e => {
  const sc = e.target.closest(".session"); if (sc) return openWorkout(state.sessions.find(x => String(x.id) === sc.dataset.id));
  const c = e.target.closest(".mcell"); if (c) { state.date = new Date(c.dataset.date + "T12:00"); state.view = "day"; render(); } };

const menu = $("#syncMenu"), btn = $("#syncs");
const setMenu = open => { menu.hidden = !open; btn.setAttribute("aria-expanded", open); };
btn.onclick = e => { e.stopPropagation(); setVMenu(false); setMenu(menu.hidden); };
document.addEventListener("click", e => { if (!menu.contains(e.target)) setMenu(false); if (!vMenu.contains(e.target)) setVMenu(false); });
document.addEventListener("keydown", e => { if (e.key === "Escape") { setMenu(false); closeModal(); closeW(); closeP(); closeG(); closeLog(); } });

const logModal = $("#logModal"), closeLog = () => logModal.hidden = true;
$("#closeLog").onclick = $("#okLog").onclick = closeLog;
logModal.onclick = e => { if (e.target === logModal) closeLog(); };
function showLog(title, r) { $("#lt").textContent = title; $("#logText").textContent = (r.ok ? "" : "Failed: " + r.error + "\n\n") + (r.log || ""); logModal.hidden = false; }
const toWeek = async () => { try { const st = await API.status(); state.date = new Date(st.weekOf + "T12:00"); } catch {} };

$("#doSync").onclick = async () => {
  setMenu(false); toast("Sync started… this takes a few seconds");
  try { const r = await API.sync(); await toWeek(); await render(); showLog(r.ok ? "Sync finished — nothing was written to openGym yet" : "Sync failed", r); }
  catch (e) { toast("Sync failed: " + e.message); }
};
$("#doApply").onclick = async () => {
  setMenu(false);
  if (!confirm("Write the planned routines to your openGym now?\n(A backup of your openGym data is made first.)")) return;
  const withFree = confirm("Also create the suggested free workout?");
  try { const r = await API.apply(withFree); showLog(r.ok ? "Written to openGym" : "Could not write to openGym", r); }
  catch (e) { toast("Could not write: " + e.message); }
};

// Select Classes modal
const modal = $("#modal"), closeModal = () => modal.hidden = true;
$("#openClasses").onclick = async () => {
  setMenu(false);
  let st; try { st = await API.getSelection(); } catch (e) { return toast("Could not load classes: " + e.message); }
  const sel = st.selection || {};
  $("#selNote").textContent = `Classes you attend in the week of ${st.weekOf} (${st.overridden ? "changed for this week" : "your defaults"}). Changes apply to this week only.`;
  $("#selTable").innerHTML = `<tr><th>Day</th><th>CrossFit</th><th>Hyrox</th><th>None</th></tr>` +
    DAYS.map((d, i) => `<tr><td>${["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"][i]}</td>` +
      ["crossfit","hyrox","none"].map(v => `<td><input type="radio" name="${d}" value="${v}" ${(sel[d] || "none") === v ? "checked" : ""} aria-label="${d} ${v}"></td>`).join("") + `</tr>`).join("");
  modal.hidden = false;
};
$("#applySel").onclick = async () => {
  const sel = Object.fromEntries(DAYS.map(d => [d, document.querySelector(`input[name=${d}]:checked`)?.value || "none"]));
  try { await API.saveSelection(sel); closeModal(); toast("Class selection saved for this week ✓ — run Sync to apply it"); } catch (e) { toast("Could not save selection: " + e.message); }
};
$("#closeModal").onclick = $("#cancelModal").onclick = closeModal;
modal.onclick = e => { if (e.target === modal) closeModal(); };

// Workout create/edit modal
const wModal = $("#wModal"), wForm = $("#wForm"), closeW = () => wModal.hidden = true;
const w = { type: "run", tags: [], id: null, ro: false };
function paintCats() { $("#cats").innerHTML = Object.entries(w.ro ? BADGE : EDITABLE).map(([k, v]) => `<button type="button" class="cat ${w.type === k ? "on" : ""}" data-c="${k}">${v}</button>`).join(""); }
function paintTags() { const box = $("#tagbox"); box.querySelectorAll(".chip").forEach(c => c.remove());
  w.tags.forEach((t, i) => box.insertBefore(Object.assign(document.createElement("span"), { className: "chip", innerHTML: `${esc(t)}<button type="button" data-rm="${i}">✕</button>` }), $("#tagIn"))); }
function addTag() { const i = $("#tagIn"), v = i.value.trim().replace(/,$/, ""); if (v && !w.tags.includes(v)) w.tags.push(v); i.value = ""; paintTags(); }
function openWorkout(s, date) {
  Object.assign(w, { id: s?.id ?? null, type: s?.type || "run", tags: [...(s?.tags || [])], ro: !!s?.readOnly });
  $("#wTitle").textContent = w.ro ? "Aimharder workout (read-only)" : s ? "Edit workout" : "New workout";
  wForm.title.value = s?.title || ""; wForm.date.value = s?.date || date || iso(state.date);
  wForm.time.value = s?.time || "07:00"; wForm.detail.value = s?.detail || "";
  $("#delBtn").hidden = !s || w.ro; $("#saveBtn").hidden = w.ro; wForm.querySelectorAll("input,textarea").forEach(x => x.disabled = w.ro); $("#tagbox").style.pointerEvents = w.ro ? "none" : ""; $("#tagIn").value = ""; paintCats(); paintTags(); wModal.hidden = false; wForm.title.focus();
}
$("#newBtn").onclick = () => openWorkout(null);
$("#cats").onclick = e => { const c = e.target.dataset.c; if (c) { w.type = c; paintCats(); } };
$("#tagbox").onclick = e => { if (e.target.dataset.rm) { w.tags.splice(+e.target.dataset.rm, 1); paintTags(); } else $("#tagIn").focus(); };
$("#tagIn").onkeydown = e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); } else if (e.key === "Backspace" && !e.target.value) { w.tags.pop(); paintTags(); } };
wForm.onsubmit = async e => {
  e.preventDefault(); if (w.ro) return; addTag();
  const sess = { id: w.id, title: wForm.title.value.trim(), type: w.type, date: wForm.date.value, time: wForm.time.value, detail: wForm.detail.value.trim(), tags: w.tags };
  try { await API.saveSession(sess); closeW(); toast("Workout saved ✓"); state.date = new Date(sess.date + "T12:00"); render(); } catch (e) { toast("Could not save workout: " + e.message); }
};
$("#delBtn").onclick = async () => { if (!confirm("Delete this workout?")) return; try { await API.deleteSession(w.id); closeW(); toast("Workout deleted"); render(); } catch (e) { toast("Could not delete: " + e.message); } };
wModal.onclick = e => { if (e.target === wModal || e.target.hasAttribute("data-close")) closeW(); };

// Race plan view (data: plan.json)
const pModal = $("#pModal"), closeP = () => pModal.hidden = true;
const li = a => `<ul>${a.map(x => `<li>${esc(x)}</li>`).join("")}</ul>`;
const rows = a => `<table>${a.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>`;
const DN = { mon: "Mon", fri: "Fri", sun: "Sun" };
function planHtml(P) {
  const today = iso(new Date()), at = (a, b) => today >= a && today <= b;
  const cur = P.weeks.find(w => at(w.start, iso(addDays(new Date(w.start + "T12:00"), 6))));
  return `<p class="muted">Races: ${P.races.map(r => `${esc(r.name)} ${new Date(r.date + "T12:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`).join(" · ")}. Start: ${esc(P.start)}</p>
  <h3>Weekly structure</h3>${rows(P.structure)}
  <h3>How to run: by effort, not HR</h3>${rows(P.effort)}${li(P.effortNotes)}
  <h3>Phases (21 weeks)</h3>${P.phases.map(p => `<div class="ph ${p.id === 0 ? "rest" : ""} ${p.id === 1 && cur ? "cur" : ""}"><b>Phase ${p.id} · ${esc(p.name)}</b>${p.id === 1 && cur ? `<span class="pill">now: W${cur.w}</span>` : ""}
    <div class="meta">${esc(p.dates)}${p.weeks ? " · " + esc(p.weeks) : ""}${p.long ? " · Sunday long runs (km): " + esc(p.long) : ""}${p.volume ? " · " + esc(p.volume) : ""}</div>${p.notes ? li(p.notes) : ""}</div>`).join("")}
  <h3>Phase 1 in detail</h3>${P.weeks.map(w => `<div class="wk"><b>W${w.w}</b> <span class="meta">${new Date(w.start + "T12:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${w.km} km${w.label ? " · " + esc(w.label) : ""}</span>
    <div class="r">${w.runs.map(([d, t, det]) => `<span>${DN[d]}</span><span><b>${esc(t)}</b>${det ? " — " + esc(det) : ""}</span>`).join("")}</div></div>`).join("")}
  <h3>Session details</h3>${rows(P.sessionNotes)}
  <h3>${esc(P.gate.title)}</h3>${li(P.gate.items)}<p><b>Decision:</b> ${esc(P.gate.decision)}</p>
  <h3>Goals <span class="meta">(${esc(P.goalsNote)})</span></h3>${rows(P.goals)}
  <h3>Still needed</h3>${li(P.todo)}`;
}
$("#planBtn").onclick = async () => {
  setMenu(false); pModal.hidden = false; $("#planBody").textContent = "Loading…";
  try { const P = await (await fetch("plan.json")).json(); $("#pTitle").textContent = P.title; $("#planBody").innerHTML = planHtml(P); }
  catch { $("#planBody").textContent = "Could not load plan.json"; }
};
$("#closePlan").onclick = closeP; pModal.onclick = e => { if (e.target === pModal) closeP(); };

// Progress view: Garmin runs (config/progress.local.json via /api/progress) against plan.json
const gModal = $("#gModal"), closeG = () => gModal.hidden = true;
const pace = (sec, m) => { const p = sec / (m / 1000); return `${Math.floor(p / 60)}:${String(Math.round(p % 60)).padStart(2, "0")}`; };
const ZC = ["#FEF9C3", "#FACC15", "#FDBA74", "#F97316", "#EF4444"];
const zone = (hr, z) => hr >= z.z5 ? 4 : hr >= z.z4 ? 3 : hr >= z.z3 ? 2 : hr >= z.z2 ? 1 : 0;
const hrCell = (hr, z) => { const i = zone(hr, z); return `<span class="hr" style="background:${ZC[i]};color:${i >= 3 ? "#fff" : "#422006"}" title="Zone ${i + 1}">${hr}</span>`; };
const runType = n => /f[áa]cil|easy/i.test(n) ? "Easy" : /interval|repeticiones|variantes|alternos|fartlek/i.test(n) ? "Interval" : /larga|long/i.test(n) ? "Long" : "";
const km1 = m => (m / 1000).toFixed(1);
const tile = (v, l, sub) => `<div class="tile"><b>${v}</b><span>${esc(l)}</span>${sub ? `<small>${esc(sub)}</small>` : ""}</div>`;
function progressHtml(G, P) {
  const today = iso(new Date()), runs = [...G.runs].sort((a, b) => a.date.localeCompare(b.date));
  const end = w => iso(addDays(new Date(w.start + "T12:00"), 6)), N = w => w.nRuns || 3;
  const ph1 = runs.filter(r => r.date >= P.phase0.start && r.date <= end(P.weeks.at(-1)));
  const wk = [P.phase0, ...P.weeks].map(w => { const rs = ph1.filter(r => r.date >= w.start && r.date <= end(w));
    return { ...w, done: rs.reduce((a, r) => a + r.m, 0) / 1000, n: rs.length, state: today > end(w) ? "past" : today >= w.start ? "now" : "next" }; });
  const due = wk.filter(w => w.w > 0 && w.state !== "next").reduce((a, w) => a + (w.state === "past" ? 3 : w.runs.filter(([d]) => iso(addDays(new Date(w.start + "T12:00"), { mon: 0, fri: 4, sun: 6 }[d])) < today).length), 0);
  const cur = wk.find(w => w.state === "now"), nDone = wk.filter(w => w.w > 0).reduce((a, w) => a + Math.min(w.n, 3), 0);
  const rhrs = G.rhr.map(x => x.bpm), rhr = G.rhr.at(-1).bpm, usual = rhrs.slice(0, -1).reduce((a, b) => a + b, 0) / (rhrs.length - 1);
  const v = G.vo2max, long15 = runs.find(r => r.date === "2026-09-26" && r.m > 15000);
  const base15 = long15 ? long15.s / (long15.m / 1000) : null, p0 = runs.filter(r => /P0\./.test(r.name));
  const mon = d => iso(monday(new Date(d + "T12:00"))), vol = {};
  runs.filter(r => r.date < P.phase0.start).forEach(r => vol[mon(r.date)] = (vol[mon(r.date)] || 0) + r.m / 1000);
  const volRows = Object.entries(vol).sort().slice(-8), vmax = Math.max(...volRows.map(x => x[1]), 1);
  const bar = (x, max) => `<span class="track"><i class="fill" style="width:${Math.min(100, x / max * 100)}%"></i></span>`;
  const full = w => w.state === "past" && w.n >= N(w);
  const gate = [
    ["Consistency", `${nDone} of ${due} planned runs done so far · needs 15 of 18`, nDone >= due ? "ok" : "warn"],
    ["Long run (W5, Nov 8)", "14 km easy with ≤5% HR/pace drift between halves. Pending: needs the run's splits.", "wait"],
    ["Aerobic efficiency", "W1 baseline (Oct 9) vs W6 baseline: HR 3-5 bpm lower at the same pace. Pending.", "wait"],
    ["Body check", `Resting HR ${rhr} vs usual ~${usual.toFixed(0)} (${rhr - usual >= 0 ? "+" : ""}${(rhr - usual).toFixed(0)} bpm; a rise above +3 is the flag). Pain flags: report them to me, Garmin can't see them.`, rhr - usual <= 3 ? "ok" : "warn"],
    ["5k time trial (Nov 15)", "Controlled effort, no pass mark. Pending.", "wait"],
  ];
  return `<div class="tiles">${tile(`${nDone}/18`, "Phase 1 runs", `${due} due so far`)}${tile(cur ? `${cur.done.toFixed(1)} / ${cur.km}` : "0 / " + P.weeks[0].km, "km this week", cur ? `W${cur.w}` : "W1 starts Oct 5")}
    ${tile(rhr, "Resting HR", `usual ~${usual.toFixed(0)}`)}${tile(v.latest.v, "VO2max", `${v.latest.v - v.first.v >= 0 ? "+" : ""}${(v.latest.v - v.first.v).toFixed(1)} since ${v.first.date.slice(5)}`)}</div>
  <h3>Phase 0 and Phase 1 · planned vs done</h3><table class="grid"><tr><td>Week</td><td>Planned</td><td>Done</td><td>Runs</td><td></td></tr>
  ${wk.map(w => `<tr><td>${w.w ? "W" + w.w : "W0"}${full(w) ? " ✅" : ""}${w.label ? ` <small>${esc(w.label)}</small>` : ""}</td><td>${w.w ? "" : "~"}${w.km} km</td><td>${w.state === "next" ? "–" : w.done.toFixed(1) + " km"}</td><td>${w.state === "next" ? "–" : w.n + "/" + N(w)}</td><td class="bars">${bar(w.state === "next" ? 0 : full(w) ? w.km : w.done, w.km)}</td></tr>`).join("")}</table>
  <h3>Phase 2 gate · where it stands</h3><ul class="gate">${gate.map(([t, d, c]) => `<li class="${c}"><b>${esc(t)}</b> ${esc(d)}</li>`).join("")}</ul>
  <h3>Reference points</h3><ul>
    ${long15 ? `<li>15k, Sep 26: <b>${km1(long15.m)} km at ${pace(long15.s, long15.m)}/km</b>, avg HR ${long15.hr}, max ${long15.max}. ${long15.max > G.maxHrWatch ? `Max ${long15.max} is above the watch's ${G.maxHrWatch}: another sign the wrist reading or max HR is off, so the chest strap matters.` : ""}</li>` : ""}
    ${base15 ? `<li>Easy-pace target (15k pace +60-90 s/km): <b>${pace(base15 * 1000 + 60000, 1e6)}-${pace(base15 * 1000 + 90000, 1e6)}/km</b>. Phase 0 easy runs: ${p0.map(r => `${pace(r.s, r.m)}/km @ HR ${r.hr}`).join(" and ")}.</li>` : ""}
    <li>Talk-test run (30' flat, pace + avg HR): not logged yet.</li></ul>
  <h3>Weekly km before Phase 0</h3><table class="grid">${volRows.map(([d, km]) => `<tr><td>${d.slice(5)}</td><td>${km.toFixed(1)} km</td><td class="bars">${bar(km, vmax)}</td></tr>`).join("")}</table>
  <h3>Latest runs</h3><table class="grid"><tr><td>Date</td><td>Run</td><td>Type</td><td>km</td><td>Pace</td><td>HR avg / max</td></tr>
  ${[...runs].reverse().slice(0, 14).map(r => `<tr><td>${r.date.slice(5)}</td><td>${esc(r.name)}</td><td>${runType(r.name) || "–"}</td><td>${km1(r.m)}</td><td>${pace(r.s, r.m)}</td><td>${hrCell(r.hr, G.hrZones)} ${hrCell(r.max, G.hrZones)}</td></tr>`).join("")}</table>
  <p class="zlegend">${ZC.map((c, i) => { const z = [0, G.hrZones.z2, G.hrZones.z3, G.hrZones.z4, G.hrZones.z5], r = i === 0 ? `<${z[1]}` : i === 4 ? `${z[4]}+` : `${z[i]}-${z[i + 1] - 1}`; return `<span><i style="background:${c}"></i>Z${i + 1} ${r}</span>`; }).join("")} <small>Your zones (% of heart-rate reserve, max 197).</small></p>
  <p class="muted">Garmin data as of ${new Date(G.updated).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. Use "Refresh from Garmin" (top right) to update. HRV and training status are empty in your Garmin account, so they aren't shown.</p>`;
}
const loadProgress = async () => {
  try { const [G, P] = await Promise.all([API.progress(), fetch("plan.json").then(r => r.json())]); $("#progBody").innerHTML = progressHtml(G, P); }
  catch (e) { $("#progBody").innerHTML = `<p>${esc(e.message || "Could not load progress")}</p>`; }
};
$("#progBtn").onclick = () => { setMenu(false); gModal.hidden = false; $("#progBody").textContent = "Loading…"; loadProgress(); };
$("#garminBtn").onclick = async () => {
  const b = $("#garminBtn"); b.disabled = true; b.textContent = "Refreshing… (~30 s)";
  try { const r = await API.refreshGarmin(); await loadProgress(); toast(r.log || "Garmin data refreshed ✓"); }
  catch (e) {
    $("#progBody").insertAdjacentHTML("afterbegin", e.message === "NOT_CONNECTED"
      ? `<div class="notice">Not connected to Garmin yet (or the session expired). Run this once in a terminal, enter your email, password and MFA code, then press Refresh again:<pre>cd ~/Documents/openGym/bridge && npm run garmin:login</pre></div>`
      : `<div class="notice">Garmin refresh failed: ${esc(e.message)}</div>`);
  }
  b.disabled = false; b.textContent = "↻ Refresh from Garmin";
};
$("#closeProg").onclick = closeG; gModal.onclick = e => { if (e.target === gModal) closeG(); };

render();
