// popup.js — column-driven test-case builder
const $ = (id) => document.getElementById(id);
const els = {
  settingsToggle: $("settingsToggle"), settings: $("settings"),
  prefix: $("prefix"), startNumber: $("startNumber"),
  colList: $("colList"), addCol: $("addCol"), resetCols: $("resetCols"),
  optField: $("optField"), optFlow: $("optFlow"), optNeg: $("optNeg"), optElements: $("optElements"), optMsgs: $("optMsgs"), optShots: $("optShots"), optAutoPass: $("optAutoPass"), statusOpts: $("statusOpts"),
  aiBtn: $("aiBtn"), apiKey: $("apiKey"), showKey: $("showKey"), keyStatus: $("keyStatus"), aiModel: $("aiModel"), appContext: $("appContext"), aiUseShots: $("aiUseShots"),
  recordBtn: $("recordBtn"), recordLabel: document.querySelector(".record-label"), pauseBtn: $("pauseBtn"), statusLine: $("statusLine"),
  batch: $("batch"), batchInfo: $("batchInfo"), batchShots: $("batchShots"), recordedFlow: $("recordedFlow"), batchList: $("batchList"),
  codeBar: $("codeBar"), pwBtn: $("pwBtn"), cyBtn: $("cyBtn"),
  replayPanel: $("replayPanel"), replayTitle: $("replayTitle"), replayStopBtn: $("replayStopBtn"), replayProgress: $("replayProgress"), replayLog: $("replayLog"),
  discardBtn: $("discardBtn"), addBtn: $("addBtn"),
  savedCount: $("savedCount"), savedList: $("savedList"), emptyState: $("emptyState"), clearBtn: $("clearBtn"), screensBtn: $("screensBtn"),
  summaryToggle: $("summaryToggle"), summary: $("summary"), pie: $("pie"), summaryStats: $("summaryStats"), reportBtn: $("reportBtn"), resetStatusBtn: $("resetStatusBtn"),
  copyBtn: $("copyBtn"), exportBtn: $("exportBtn"), xlsxBtn: $("xlsxBtn"),
  importCsv: $("importCsv"), csvFile: $("csvFile"),
};

const DEFAULT_STATUS = ["Pass", "Fail", "Not Tested", "Pending"];
const ROLES = [
  ["id", "Auto ID"], ["module", "Module / Feature"], ["scenario", "Scenario"], ["steps", "Test Steps"],
  ["expected", "Expected Result"], ["actual", "Actual Result"], ["status", "Status / Priority"], ["blank", "Blank (manual)"],
];
const DEFAULT_COLUMNS = () => [
  { id: "c_id", name: "TC ID", role: "id" },
  { id: "c_mod", name: "Test Module", role: "module" },
  { id: "c_scn", name: "Test Scenario", role: "scenario" },
  { id: "c_stp", name: "Test Steps", role: "steps" },
  { id: "c_exp", name: "Expected Result", role: "expected" },
  { id: "c_act", name: "Actual Result", role: "actual" },
  { id: "c_sts", name: "Status", role: "status" },
  { id: "c_col1", name: "Column 1", role: "blank" },
];

let state = {
  recording: false, paused: false, events: [], testcases: [],
  prefix: "SMK", startNumber: 1, optField: true, optFlow: true, optNeg: true, captureMsgs: true, captureShots: true,
  optElements: true, autoPass: true, aiUseShots: true, apiKey: "", aiModel: "claude-opus-5-5", appContext: "", statusOptions: DEFAULT_STATUS.slice(), columns: DEFAULT_COLUMNS(),
};
let counterTimer = null;

async function load() {
  Object.assign(state, await chrome.storage.local.get(
    ["recording", "paused", "events", "testcases", "prefix", "startNumber", "optField", "optFlow", "optNeg", "optElements", "captureMsgs", "captureShots", "autoPass", "statusOptions", "columns", "apiKey", "aiModel", "appContext", "aiUseShots"]
  ));
  state.events ??= []; state.testcases ??= [];
  state.prefix ??= "SMK"; state.startNumber ??= 1;
  state.optField ??= true; state.optFlow ??= true; state.optNeg ??= true;
  state.captureMsgs ??= true; state.captureShots ??= true; state.autoPass ??= true; state.optElements ??= true;
  if (!Array.isArray(state.statusOptions) || !state.statusOptions.length) state.statusOptions = DEFAULT_STATUS.slice();
  if (!Array.isArray(state.columns) || !state.columns.length) state.columns = DEFAULT_COLUMNS();
}
const save = (o) => chrome.storage.local.set(o);
const newColId = () => "col_" + Math.random().toString(36).slice(2, 8);

// ---- screenshots ---------------------------------------------------------
async function getShot(id) {
  const r = await chrome.storage.local.get("shot:" + id);
  return r["shot:" + id] || null;
}
function referencedShotIds() {
  const set = new Set();
  state.testcases.forEach((tc) => (tc.shots || []).forEach((id) => set.add(id)));
  return set;
}
// Drop the current session's page shots; delete images not owned by a saved case.
async function resetSessionShots() {
  const { shots = [] } = await chrome.storage.local.get("shots");
  const ref = referencedShotIds();
  const orphans = shots.filter((s) => !ref.has(s.id)).map((s) => "shot:" + s.id);
  if (orphans.length) await chrome.storage.local.remove(orphans);
  await save({ shots: [] });
}
async function deleteShotImages(ids, keepReferenced = true) {
  if (!ids || !ids.length) return;
  const ref = keepReferenced ? referencedShotIds() : new Set();
  const del = ids.filter((id) => !ref.has(id)).map((id) => "shot:" + id);
  if (del.length) await chrome.storage.local.remove(del);
}
function openFull(dataUrl) {
  fetch(dataUrl).then((r) => r.blob()).then((b) => window.open(URL.createObjectURL(b), "_blank"));
}
function thumb(dataUrl, filename) {
  const wrap = document.createElement("div"); wrap.className = "thumb";
  const img = document.createElement("img"); img.src = dataUrl; img.title = "Open full size";
  img.addEventListener("click", () => openFull(dataUrl));
  const dl = document.createElement("a"); dl.className = "dl"; dl.textContent = "⤓"; dl.title = "Download";
  dl.href = dataUrl; dl.download = filename || "screenshot.jpg";
  wrap.append(img, dl);
  return wrap;
}
async function fillShotStrip(container, shotIds, namePrefix) {
  container.innerHTML = "";
  if (!shotIds || !shotIds.length) { container.hidden = true; return; }
  container.hidden = false;
  const got = await chrome.storage.local.get(shotIds.map((id) => "shot:" + id));
  shotIds.forEach((id, i) => {
    const d = got["shot:" + id];
    if (d) container.append(thumb(d, `${namePrefix || "shot"}_${i + 1}.jpg`));
  });
}

// ---- column helpers ------------------------------------------------------
const idColumn = () => state.columns.find((c) => c.role === "id");
const statusColumn = () => state.columns.find((c) => c.role === "status");
const stepsColumn = () => state.columns.find((c) => c.role === "steps");
const expectedColumn = () => state.columns.find((c) => c.role === "expected");
const actualColumn = () => state.columns.find((c) => c.role === "actual");
const primaryColumn = () =>
  state.columns.find((c) => c.role === "scenario") ||
  state.columns.find((c) => !["id", "steps", "status"].includes(c.role)) ||
  state.columns.find((c) => c.role !== "id");

const idFor = (i) => `${state.prefix || "SMK"}_${String(Number(state.startNumber || 1) + i).padStart(3, "0")}`;
const numberSteps = (v) => {
  const lines = String(v || "").split("\n").map((s) => s.replace(/^\s*\d+[.)]\s*/, "").trim()).filter(Boolean);
  return lines.map((l, i) => `${i + 1}. ${l}`).join("\n");
};
const csvEscape = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

function cellFor(tc, col, rowIndex) {
  if (col.role === "id") return idFor(rowIndex);
  const v = (tc.cells && tc.cells[col.id]) ?? "";
  return col.role === "steps" ? numberSteps(v) : v;
}
function buildCSV() {
  const rows = [state.columns.map((c) => csvEscape(c.name)).join(",")];
  state.testcases.forEach((tc, i) => {
    rows.push(state.columns.map((c) => csvEscape(cellFor(tc, c, i))).join(","));
  });
  return rows.join("\n");
}

// content a generated case supplies for a given role
function contentForRole(role, c) {
  switch (role) {
    case "module": return c.module || "";
    case "scenario": return c.scenario;
    case "steps": return c.steps.join("\n");
    case "expected": return c.expected;
    case "status": return (c.pass && state.autoPass) ? passStatus() : defaultStatus();
    default: return "";
  }
}

function defaultStatus() {
  const opts = state.statusOptions;
  return opts.find((o) => /not.?test|untested|not.?run|pending|new|todo|open/i.test(o)) || opts[0] || "Not Tested";
}
function passStatus() {
  return state.statusOptions.find((o) => /^pass$/i.test(o)) || state.statusOptions.find((o) => /pass/i.test(o)) || defaultStatus();
}
function statusSelect(selected) {
  const sel = document.createElement("select");
  const base = state.statusOptions.slice();
  const opts = (selected && !base.includes(selected)) ? [selected, ...base] : base;
  opts.forEach((s) => {
    const o = document.createElement("option"); o.textContent = s;
    if (s === selected) o.selected = true; sel.appendChild(o);
  });
  return sel;
}

// ---- column editor -------------------------------------------------------
function renderColumns() {
  els.colList.innerHTML = "";
  state.columns.forEach((col, i) => {
    const li = document.createElement("li"); li.className = "col-row";

    const name = document.createElement("input"); name.className = "cname"; name.value = col.name;
    name.addEventListener("input", () => { state.columns[i].name = name.value; save({ columns: state.columns }); });

    const role = document.createElement("select"); role.className = "crole";
    ROLES.forEach(([val, label]) => {
      const o = document.createElement("option"); o.value = val; o.textContent = label;
      if (val === col.role) o.selected = true; role.appendChild(o);
    });
    role.addEventListener("change", () => { state.columns[i].role = role.value; save({ columns: state.columns }); renderColumns(); });

    const up = document.createElement("button"); up.className = "move"; up.textContent = "↑"; up.title = "Move up";
    up.addEventListener("click", () => { if (i > 0) { swap(i, i - 1); } });
    const down = document.createElement("button"); down.className = "move"; down.textContent = "↓"; down.title = "Move down";
    down.addEventListener("click", () => { if (i < state.columns.length - 1) { swap(i, i + 1); } });

    const del = document.createElement("button"); del.className = "del"; del.textContent = "✕"; del.title = "Delete column";
    del.addEventListener("click", () => {
      if (state.columns.length <= 1) return;
      state.columns.splice(i, 1); save({ columns: state.columns }); renderColumns(); renderSaved();
    });

    li.append(name, role, up, down, del);
    els.colList.appendChild(li);

    // preset dropdown options for a Blank column (e.g. Module = Login, Dashboard…)
    if (col.role === "blank") {
      const optLi = document.createElement("li"); optLi.className = "col-opts";
      const oi = document.createElement("input");
      oi.placeholder = "dropdown options (comma-separated, optional)";
      oi.value = (col.options || []).join(", ");
      oi.addEventListener("change", () => {
        const list = [...new Set(oi.value.split(",").map((x) => x.trim()).filter(Boolean))];
        if (list.length) state.columns[i].options = list; else delete state.columns[i].options;
        save({ columns: state.columns });
      });
      optLi.appendChild(oi);
      els.colList.appendChild(optLi);
    }
  });
}
function swap(a, b) {
  [state.columns[a], state.columns[b]] = [state.columns[b], state.columns[a]];
  save({ columns: state.columns }); renderColumns(); renderSaved();
}

// ---- saved list ----------------------------------------------------------
function renderSaved() {
  els.savedList.innerHTML = "";
  const idCol = idColumn(), primary = primaryColumn(), stsCol = statusColumn();
  const expCol = expectedColumn(), actCol = actualColumn(), stpCol = stepsColumn();

  state.testcases.forEach((tc, i) => {
    const li = document.createElement("li"); li.className = "case-wrap";

    const row = document.createElement("div"); row.className = "case";
    const caret = document.createElement("button"); caret.className = "caret"; caret.textContent = "▸"; caret.title = "Run / details";
    row.append(caret);
    if (idCol) { const id = document.createElement("span"); id.className = "case-id"; id.textContent = idFor(i); row.append(id); }
    const name = document.createElement("span"); name.className = "case-name";
    const nameVal = primary ? (tc.cells[primary.id] || "") : "(row)";
    name.title = nameVal; name.textContent = nameVal; row.append(name);
    if (stsCol) {
      const status = statusSelect(tc.cells[stsCol.id] || defaultStatus());
      status.className = "row-status " + statusClass(tc.cells[stsCol.id]);
      status.addEventListener("change", () => {
        tc.cells[stsCol.id] = status.value; status.className = "row-status " + statusClass(status.value);
        save({ testcases: state.testcases });
        renderSummary();
      });
      row.append(status);
    }
    const del = document.createElement("button"); del.className = "del"; del.textContent = "✕"; del.title = "Delete";
    del.addEventListener("click", async () => {
      const ids = tc.shots || [];
      state.testcases.splice(i, 1);
      await save({ testcases: state.testcases });
      deleteShotImages(ids);
      renderAll();
    });
    row.append(del);
    li.append(row);

    // execution panel
    const panel = document.createElement("div"); panel.className = "run-panel"; panel.hidden = true;
    if (primary) {
      const sc = document.createElement("label"); sc.className = "run-field";
      sc.innerHTML = `<span class="ref-lbl">Test scenario</span>`;
      const ta = document.createElement("textarea"); ta.rows = 2; ta.value = tc.cells[primary.id] || "";
      ta.addEventListener("input", () => { tc.cells[primary.id] = ta.value; name.textContent = ta.value; name.title = ta.value; save({ testcases: state.testcases }); });
      sc.append(ta); panel.append(sc);
    }
    if (stpCol && tc.cells[stpCol.id]) {
      const s = document.createElement("div"); s.className = "ref";
      s.innerHTML = `<span class="ref-lbl">Steps</span><pre>${escapeHtml(numberSteps(tc.cells[stpCol.id]))}</pre>`;
      panel.append(s);
    }
    if (expCol) {
      const wrap = document.createElement("label"); wrap.className = "run-field";
      wrap.innerHTML = `<span class="ref-lbl">Expected result</span>`;
      const ta = document.createElement("textarea"); ta.rows = 2; ta.value = tc.cells[expCol.id] || "";
      ta.addEventListener("input", () => { tc.cells[expCol.id] = ta.value; save({ testcases: state.testcases }); });
      wrap.append(ta); panel.append(wrap);
    }
    if (actCol) {
      const wrap = document.createElement("label"); wrap.className = "run-field";
      wrap.innerHTML = `<span class="ref-lbl">Actual result</span>`;
      const ta = document.createElement("textarea"); ta.rows = 2; ta.placeholder = "What actually happened…";
      ta.value = tc.cells[actCol.id] || "";
      ta.addEventListener("input", () => { tc.cells[actCol.id] = ta.value; save({ testcases: state.testcases }); });
      wrap.append(ta); panel.append(wrap);
    } else {
      const note = document.createElement("p"); note.className = "empty";
      note.textContent = "Add an 'Actual Result' column in settings to log results here.";
      panel.append(note);
    }
    // evidence: screenshots
    const shotWrap = document.createElement("div"); shotWrap.className = "run-shots";
    const lbl = document.createElement("span"); lbl.className = "ref-lbl"; lbl.textContent = "Screenshots";
    const strip = document.createElement("div"); strip.className = "shot-strip";
    fillShotStrip(strip, tc.shots || [], idCol ? idFor(i) : "shot");
    const cap = document.createElement("button"); cap.className = "btn ghost tiny"; cap.textContent = "＋ Capture screen";
    cap.addEventListener("click", async () => {
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab({ format: "jpeg", quality: 60 });
        if (!dataUrl) return;
        const sid = "s_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        await chrome.storage.local.set({ ["shot:" + sid]: dataUrl });
        tc.shots = (tc.shots || []).concat(sid);
        await save({ testcases: state.testcases });
        fillShotStrip(strip, tc.shots, idCol ? idFor(i) : "shot");
      } catch (e) { els.statusLine.textContent = "Couldn't capture this tab (restricted page?)."; }
    });
    shotWrap.append(lbl, strip, cap); panel.append(shotWrap);

    // replay: re-run this case's recorded flow and log Pass/Fail automatically
    if (Array.isArray(tc.events) && tc.events.length) {
      const rr = document.createElement("div"); rr.className = "run-replay";
      const go = document.createElement("button"); go.className = "btn ghost tiny"; go.textContent = "▶ Replay this case";
      let secret = null;
      if (hasSensitive(tc.events)) {
        secret = document.createElement("input"); secret.type = "password"; secret.autocomplete = "off";
        secret.placeholder = "Password for replay (not saved)";
      }
      go.addEventListener("click", () => {
        if (!tc.rid) { tc.rid = newRid(); save({ testcases: state.testcases }); }
        startReplay(tc.events, secret ? secret.value : "", tc.rid, (idCol ? idFor(i) + " " : "") + (primary ? tc.cells[primary.id] || "" : ""));
      });
      rr.append(go);
      if (secret) rr.append(secret);
      if (tc.lastReplay) {
        const last = document.createElement("span"); last.className = "last";
        last.textContent = `Last replay: ${tc.lastReplay.ok ? "passed" : "failed"}, ${new Date(tc.lastReplay.at).toLocaleString()}`;
        rr.append(last);
      }
      panel.append(rr);
    }
    li.append(panel);

    caret.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      caret.textContent = panel.hidden ? "▸" : "▾";
    });

    els.savedList.appendChild(li);
  });
  const has = state.testcases.length > 0;
  const hasShots = state.testcases.some((tc) => (tc.shots || []).length);
  els.savedCount.textContent = state.testcases.length;
  els.emptyState.hidden = has; els.clearBtn.hidden = !has;
  els.screensBtn.hidden = !hasShots;
  els.summaryToggle.hidden = !has;
  if (!has) { els.summary.hidden = true; els.summaryToggle.classList.remove("on"); }
  els.copyBtn.disabled = !has; els.exportBtn.disabled = !has; els.xlsxBtn.disabled = !has;
  renderSummary();
}

function statusClass(v) {
  if (/pass/i.test(v)) return "s-pass";
  if (/fail/i.test(v)) return "s-fail";
  if (/block|pending|progress|hold/i.test(v)) return "s-block";
  return "";
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// ---- batch review --------------------------------------------------------
const normText = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
function renderRecordedFlow(events) {
  const steps = window.TCGen.buildSteps(events || []);
  if (!steps.length) { els.recordedFlow.hidden = true; els.recordedFlow.innerHTML = ""; return; }
  const d = document.createElement("details");
  const sum = document.createElement("summary");
  sum.textContent = `Recorded flow — ${steps.length} step${steps.length === 1 ? "" : "s"} captured (verify the buttons/fields)`;
  const pre = document.createElement("pre");
  pre.textContent = steps.map((x, i) => `${i + 1}. ${x}`).join("\n");
  d.append(sum, pre);
  els.recordedFlow.innerHTML = ""; els.recordedFlow.appendChild(d); els.recordedFlow.hidden = false;
}
function renderBatch(cases) {
  els.recordedFlow.hidden = true; els.recordedFlow.innerHTML = "";
  els.batchList.innerHTML = "";
  els.batchInfo.textContent = `${cases.length} case${cases.length === 1 ? "" : "s"} — untick any you don't want`;
  const idCol = idColumn(), primary = primaryColumn(), stsCol = statusColumn();
  const existing = new Set(primary ? state.testcases.map((tc) => normText(tc.cells[primary.id])) : []);

  cases.forEach((c) => {
    const li = document.createElement("li"); li.className = "bcard";
    const getters = {}; // colId -> () => value

    const isDup = primary ? existing.has(normText(contentForRole(primary.role, c))) : false;

    const top = document.createElement("div"); top.className = "bcard-top";
    const chk = document.createElement("input"); chk.type = "checkbox"; chk.checked = !isDup;
    const kind = document.createElement("span"); kind.className = `kind ${c.kind}`; kind.textContent = c.kind;
    top.append(chk, kind);
    if (isDup) { const d = document.createElement("span"); d.className = "kind dup"; d.textContent = "duplicate"; top.append(d); }

    // status inline in the top row
    if (stsCol) {
      const ss = statusSelect(contentForRole("status", c) || defaultStatus()); ss.className = "prio";
      getters[stsCol.id] = () => ss.value;
      top.append(ss);
    }
    li.append(top);
    // primary (scenario) as a full-width, multi-line field so you can add detail
    if (primary) {
      const pin = document.createElement("textarea"); pin.className = "scenario"; pin.rows = 2;
      pin.value = contentForRole(primary.role, c);
      getters[primary.id] = () => pin.value.trim();
      li.append(pin);
    }

    // remaining editable columns in a disclosure
    const rest = state.columns.filter((col) =>
      col.role !== "id" && col !== primary && col !== stsCol
    );
    if (rest.length) {
      const details = document.createElement("details");
      const summary = document.createElement("summary"); summary.textContent = "more fields";
      details.append(summary);
      rest.forEach((col) => {
        const wrap = document.createElement("label"); wrap.className = "bfield";
        wrap.textContent = col.name;
        let ctrl;
        if (col.options && col.options.length) {
          ctrl = document.createElement("select");
          [""].concat(col.options).forEach((o) => { const op = document.createElement("option"); op.textContent = o; ctrl.appendChild(op); });
        } else if (col.role === "steps" || col.role === "expected") {
          ctrl = document.createElement("textarea");
          ctrl.rows = col.role === "steps" ? Math.min(6, c.steps.length + 1) : 2;
        } else {
          ctrl = document.createElement("input");
        }
        ctrl.value = contentForRole(col.role, c);
        getters[col.id] = () => ctrl.value.trim();
        wrap.append(ctrl);
        details.append(wrap);
      });
      li.append(details);
    }

    li._include = () => chk.checked;
    li._cells = () => {
      const cells = {};
      state.columns.forEach((col) => { if (col.role !== "id") cells[col.id] = getters[col.id] ? getters[col.id]() : ""; });
      return cells;
    };
    li._primaryEmpty = () => primary && getters[primary.id] && !getters[primary.id]();
    li._kind = c.kind;
    els.batchList.appendChild(li);
  });
  (async () => {
    const { shots = [] } = await chrome.storage.local.get("shots");
    await fillShotStrip(els.batchShots, shots.map((x) => x.id), "page");
  })();
  els.batch.hidden = false;
}

function renderAll() { renderSaved(); }

// ---- record flow ---------------------------------------------------------
function renderRecordState() {
  els.recordBtn.setAttribute("aria-pressed", String(state.recording && !state.paused));
  els.recordLabel.textContent = state.recording ? "Stop recording" : "Start recording";
  els.pauseBtn.hidden = !state.recording;
  els.pauseBtn.textContent = state.paused ? "Resume" : "Pause";
  els.pauseBtn.classList.toggle("resume", state.paused);
  if (state.recording && !state.paused) { updateCounter(); counterTimer = setInterval(updateCounter, 600); }
  else {
    if (counterTimer) { clearInterval(counterTimer); counterTimer = null; }
    if (state.recording && state.paused) els.statusLine.innerHTML = 'Paused — press <b>Resume</b> to keep capturing.';
  }
}
async function updateCounter() {
  const { events = [], recordingTabTitle = "" } = await chrome.storage.local.get(["events", "recordingTabTitle"]);
  const on = recordingTabTitle ? ` on <b>${escapeHtml(recordingTabTitle)}</b>` : "";
  els.statusLine.innerHTML = `Recording${on}… <span class="count">${events.length}</span> actions captured. Press stop when done.`;
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// Make sure a live recorder exists in the active tab (fixes already-open tabs
// after the extension is reloaded — their old content script is disconnected).
async function ensureContentScript() {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (e) { return { ok: false, reason: "error" }; }
  if (!tab || !tab.id) return { ok: false, reason: "no-tab" };
  if (!/^https?:|^file:/.test(tab.url || "")) return { ok: false, reason: "restricted" };
  let alive = false;
  try { const res = await chrome.tabs.sendMessage(tab.id, { type: "PING" }); alive = !!(res && res.alive); } catch (e) { alive = false; }
  if (!alive) {
    // all frames, so iframes on an already-open page are recorded too
    // (content.js guards against running twice in the same frame)
    try { await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["content.js"] }); }
    catch (e) { return { ok: false, reason: "inject-failed" }; }
    // verify the freshly injected script answers
    try { const res = await chrome.tabs.sendMessage(tab.id, { type: "PING" }); alive = !!(res && res.alive); } catch (e) { alive = false; }
  }
  return alive ? { ok: true, tabId: tab.id, title: tab.title || "" } : { ok: false, reason: "no-response" };
}

els.recordBtn.addEventListener("click", async () => {
  if (!state.recording) {
    if (replayActive) { els.statusLine.textContent = "A replay is running — stop it before recording."; return; }
    const chk = await ensureContentScript();
    if (!chk.ok) {
      els.statusLine.textContent =
        chk.reason === "restricted"
          ? "Can't record on this page (browser-restricted, e.g. chrome:// or the Web Store). Open a normal website tab and try again."
          : "Couldn't attach the recorder to this tab. Refresh the page (Ctrl/Cmd+R) and press Start again.";
      return;
    }
    state.recording = true; state.paused = false; state.events = []; els.batch.hidden = true;
    await resetSessionShots();
    await save({ recording: true, paused: false, events: [], recordingTabId: chk.tabId ?? null, recordingTabIds: chk.tabId != null ? [chk.tabId] : [], recordingTabTitle: chk.title || "" });
    renderRecordState();
    els.statusLine.innerHTML = 'Recording… <span class="count">0</span> actions captured. Perform your flow, then Stop.';
  } else {
    state.recording = false; state.paused = false; await save({ recording: false, paused: false, recordingTabId: null, recordingTabIds: [] });
    if (counterTimer) { clearInterval(counterTimer); counterTimer = null; }
    const { events = [] } = await chrome.storage.local.get("events");
    if (!events.length) { els.statusLine.textContent = "No actions were captured. Try again on the target tab."; renderRecordState(); return; }
    await save({ lastEvents: events });
    updateCodeBar();
    const cases = window.TCGen.generateSuite(events, { fieldValidation: state.optField, flowValidation: state.optFlow, negatives: state.optNeg, elements: state.optElements });
    renderBatch(cases);
    renderRecordedFlow(events);
    els.statusLine.textContent = `Captured ${events.length} actions → ${cases.length} proposed cases. Review below.`;
    renderRecordState();
  }
});

els.pauseBtn.addEventListener("click", async () => {
  if (!state.recording) return;
  state.paused = !state.paused;
  await save({ paused: state.paused });
  renderRecordState();
  if (!state.paused) els.statusLine.textContent = "Resumed — capturing again.";
});

els.discardBtn.addEventListener("click", async () => {
  els.batch.hidden = true; state.events = [];
  await resetSessionShots();
  await save({ events: [] });
  els.statusLine.textContent = "Batch discarded.";
});

els.addBtn.addEventListener("click", async () => {
  const { shots = [], lastEvents = [] } = await chrome.storage.local.get(["shots", "lastEvents"]);
  const shotIds = shots.map((s) => s.id);
  const attached = new Set();
  const replayable = lastEvents.filter((e) => e && e.type !== "feature");
  const primary = primaryColumn();
  const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const existing = new Set(primary ? state.testcases.map((tc) => norm(tc.cells[primary.id])) : []);
  let added = 0, skipped = 0;
  [...els.batchList.children].forEach((li) => {
    if (li._include() && !li._primaryEmpty()) {
      const c = { cells: li._cells() };
      const key = primary ? norm(c.cells[primary.id]) : "";
      if (key && existing.has(key)) { skipped++; return; } // never add a duplicate scenario
      if (key) existing.add(key);
      if (li._kind === "positive" && shotIds.length) { c.shots = shotIds.slice(); shotIds.forEach((id) => attached.add(id)); }
      // keep the recorded flow on the positive case so it can be replayed later
      if (li._kind === "positive" && replayable.length) { c.events = replayable; c.rid = newRid(); }
      state.testcases.push(c); added++;
    }
  });
  const orphans = shotIds.filter((id) => !attached.has(id)).map((id) => "shot:" + id);
  if (orphans.length) await chrome.storage.local.remove(orphans);
  els.batch.hidden = true; state.events = [];
  await save({ testcases: state.testcases, events: [], shots: [] });
  els.statusLine.textContent = `Added ${added} case${added === 1 ? "" : "s"}${skipped ? `, skipped ${skipped} duplicate${skipped === 1 ? "" : "s"}` : ""}. Record another flow or export your suite.`;
  renderAll();
});

// ---- export --------------------------------------------------------------
function download(csv) {
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = `testcases_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
els.exportBtn.addEventListener("click", () => download(buildCSV()));

// ---- screenshot export (store-only ZIP, no library) ----------------------
const _crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let crc = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ _crcTable[(crc ^ buf[i]) & 0xFF]; return (crc ^ 0xFFFFFFFF) >>> 0; }
function strBytes(s) { const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xFF; return a; }
function dataUrlToBytes(u) { const bin = atob(u.split(",")[1] || ""); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
const u16 = (n) => [n & 0xFF, (n >>> 8) & 0xFF];
const u32 = (n) => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];
function buildZip(files) {
  const parts = [], central = []; let offset = 0;
  files.forEach((f) => {
    const nameB = strBytes(f.name), crc = crc32(f.bytes), size = f.bytes.length;
    const lh = new Uint8Array([].concat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(size), u32(size), u16(nameB.length), u16(0)));
    parts.push(lh, nameB, f.bytes);
    central.push(new Uint8Array([].concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(size), u32(size), u16(nameB.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset))), nameB);
    offset += lh.length + nameB.length + f.bytes.length;
  });
  let cenLen = 0; central.forEach((c) => (cenLen += c.length));
  const end = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cenLen), u32(offset), u16(0)));
  const all = [...parts, ...central, end]; let total = 0; all.forEach((c) => (total += c.length));
  const out = new Uint8Array(total); let p = 0; all.forEach((c) => { out.set(c, p); p += c.length; });
  return out;
}
async function exportScreens() {
  const items = [];
  const idCol = idColumn();
  for (let i = 0; i < state.testcases.length; i++) {
    const ids = state.testcases[i].shots || []; if (!ids.length) continue;
    const base = idCol ? idFor(i) : "case_" + (i + 1);
    const got = await chrome.storage.local.get(ids.map((id) => "shot:" + id));
    ids.forEach((id, n) => { const d = got["shot:" + id]; if (d) items.push({ name: `${base}_${n + 1}.jpg`, bytes: dataUrlToBytes(d) }); });
  }
  if (!items.length) { els.statusLine.textContent = "No screenshots to export yet."; return; }
  const blob = new Blob([buildZip(items)], { type: "application/zip" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = `screenshots_${new Date().toISOString().slice(0, 10)}.zip`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
els.screensBtn.addEventListener("click", exportScreens);

// ---- summary, pie chart & report -----------------------------------------
function statusColor(v) {
  if (/pass/i.test(v)) return "#37d0b6";
  if (/fail/i.test(v)) return "#ff4d4f";
  if (/block|pending|progress|hold/i.test(v)) return "#e0a83b";
  if (/not.?test|untested|not.?run|todo|new|open/i.test(v)) return "#5b6572";
  return "#8b5cf6";
}
function statusCounts() {
  const stsCol = statusColumn();
  const counts = {};
  state.testcases.forEach((tc) => {
    const v = stsCol ? (tc.cells[stsCol.id] || defaultStatus()) : "No status column";
    counts[v] = (counts[v] || 0) + 1;
  });
  const order = [...state.statusOptions, ...Object.keys(counts).filter((k) => !state.statusOptions.includes(k))];
  const slices = order.filter((k) => counts[k]).map((k) => ({ label: k, value: counts[k], color: statusColor(k) }));
  return { total: state.testcases.length, counts, slices };
}
function pieSVG(slices, size, textColor, mutedColor) {
  const r = size / 2, cx = r, cy = r, inner = r * 0.6;
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const nonZero = slices.filter((s) => s.value > 0);
  let inner_paths = "";
  if (nonZero.length === 1) {
    inner_paths = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${nonZero[0].color}"/><circle cx="${cx}" cy="${cy}" r="${inner}" fill="var(--bg,#0f1216)"/>`;
  } else {
    let a0 = -Math.PI / 2;
    nonZero.forEach((s) => {
      const frac = s.value / total, a1 = a0 + frac * 2 * Math.PI, large = frac > 0.5 ? 1 : 0;
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0), x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      const ix1 = cx + inner * Math.cos(a1), iy1 = cy + inner * Math.sin(a1), ix0 = cx + inner * Math.cos(a0), iy0 = cy + inner * Math.sin(a0);
      inner_paths += `<path d="M${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1} L${ix1} ${iy1} A${inner} ${inner} 0 ${large} 0 ${ix0} ${iy0} Z" fill="${s.color}"/>`;
      a0 = a1;
    });
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${inner_paths}` +
    `<text x="${cx}" y="${cy - 1}" text-anchor="middle" font-size="${size * 0.17}" font-weight="700" fill="${textColor}">${total}</text>` +
    `<text x="${cx}" y="${cy + size * 0.12}" text-anchor="middle" font-size="${size * 0.08}" fill="${mutedColor}">total</text></svg>`;
}
function renderSummary() {
  if (!els.summary || els.summary.hidden) return;
  const { total, slices } = statusCounts();
  els.pie.innerHTML = total ? pieSVG(slices, 128, "var(--text)", "var(--muted)") : "<span class='empty'>No cases</span>";
  const pct = (v) => (total ? Math.round((v / total) * 100) : 0);
  els.summaryStats.innerHTML =
    `<div class="sum-total">Total <b>${total}</b></div>` +
    slices.map((s) => `<div class="sum-row"><span class="sw" style="background:${s.color}"></span><span class="sl">${escapeHtml(s.label)}</span><b>${s.value}</b><span class="sp">${pct(s.value)}%</span></div>`).join("");
}
els.summaryToggle.addEventListener("click", () => {
  els.summary.hidden = !els.summary.hidden;
  els.summaryToggle.classList.toggle("on", !els.summary.hidden);
  renderSummary();
});

function buildReportHTML() {
  const { total, slices } = statusCounts();
  const pct = (v) => (total ? Math.round((v / total) * 100) : 0);
  const pie = pieSVG(slices, 190, "#1a1f24", "#6b7280").replace("var(--bg,#0f1216)", "#ffffff");
  const legend = slices.map((s) => `<div class="lg"><span class="dot" style="background:${s.color}"></span>${escapeHtml(s.label)} — <b>${s.value}</b> (${pct(s.value)}%)</div>`).join("");
  const thead = state.columns.map((c) => `<th>${escapeHtml(c.name)}</th>`).join("");
  const rows = state.testcases.map((tc, i) =>
    `<tr>${state.columns.map((c) => {
      const val = escapeHtml(cellFor(tc, c, i)).replace(/\n/g, "<br>");
      const cls = c.role === "status" ? ` class="st ${statusClass(cellFor(tc, c, i))}"` : "";
      return `<td${cls}>${val}</td>`;
    }).join("")}</tr>`).join("");
  const date = new Date().toLocaleString();
  return `<!doctype html><html><head><meta charset="utf-8"><title>QA Test Report</title>
<style>
 body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1f24;margin:32px;}
 h1{margin:0 0 4px;font-size:22px;} .meta{color:#6b7280;font-size:13px;margin-bottom:20px;}
 .top{display:flex;gap:28px;align-items:center;margin-bottom:24px;flex-wrap:wrap;}
 .legend{font-size:14px;} .lg{margin:4px 0;} .dot{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:7px;vertical-align:middle;}
 table{border-collapse:collapse;width:100%;font-size:13px;} th,td{border:1px solid #e2e6ea;padding:7px 9px;text-align:left;vertical-align:top;}
 th{background:#f6f8fa;font-weight:600;} tr:nth-child(even) td{background:#fafbfc;}
 td.st{font-weight:600;text-align:center;white-space:nowrap;}
 .st.s-pass{color:#0f9d84;} .st.s-fail{color:#d92d2f;} .st.s-block{color:#b7791f;}
</style></head><body>
 <h1>QA Test Report</h1>
 <div class="meta">Generated ${date} &middot; ${total} test case${total === 1 ? "" : "s"}</div>
 <div class="top"><div>${pie}</div><div class="legend">${legend || "No status data"}</div></div>
 <table><thead><tr>${thead}</tr></thead><tbody>${rows}</tbody></table>
</body></html>`;
}
els.reportBtn.addEventListener("click", () => {
  const blob = new Blob([buildReportHTML()], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = `test-report_${new Date().toISOString().slice(0, 10)}.html`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// ---- AI suggestions (Anthropic API, user's key) --------------------------
function flowSummary(events) {
  const uniq = (a) => [...new Set(a.filter(Boolean))];
  return {
    pages: uniq(events.filter((e) => e.type === "navigate").map((e) => e.page)),
    fields: uniq(events.filter((e) => e.type === "input").map((e) => e.label)),
    actions: uniq(events.filter((e) => e.type === "click").map((e) => e.label)),
  };
}
function parseCasesJSON(text) {
  let t = (text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const a = t.indexOf("["), b = t.lastIndexOf("]");
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  try { const v = JSON.parse(t); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
async function aiSuggest() {
  const apiKey = (els.apiKey.value || "").trim();
  if (!apiKey) { els.settings.hidden = false; els.statusLine.textContent = "Add your Anthropic API key in ⚙ settings, then press AI suggest."; return; }
  const model = (els.aiModel.value || "claude-opus-5-5").trim();
  const appContext = els.appContext.value || "";
  await save({ apiKey, aiModel: model, appContext });
  const { events = [] } = await chrome.storage.local.get("events");
  const primary = primaryColumn();
  const existing = primary ? state.testcases.map((tc) => tc.cells[primary.id]).filter(Boolean) : [];
  const flow = events.length ? flowSummary(events) : null;

  let images = [];
  if (els.aiUseShots.checked) {
    const { shots = [] } = await chrome.storage.local.get("shots");
    const pick = shots.slice(0, 3);
    if (pick.length) {
      const keys = pick.map((sh) => "shot:" + sh.id);
      const data = await chrome.storage.local.get(keys);
      images = pick.map((sh) => data["shot:" + sh.id]).filter(Boolean)
        .map((durl) => ({ media_type: "image/jpeg", data: (durl.split(",")[1] || "") }))
        .filter((im) => im.data);
    }
  }

  const oldLabel = els.aiBtn.textContent;
  els.aiBtn.disabled = true; els.aiBtn.textContent = "Thinking…";
  els.statusLine.textContent = images.length ? `Asking Claude to read ${images.length} screenshot${images.length === 1 ? "" : "s"} and suggest cases…` : "Asking Claude for more test cases…";
  try {
    const resp = await chrome.runtime.sendMessage({ type: "AI_SUGGEST", apiKey, model, appContext, flow, existing, images });
    if (!resp) throw new Error("no response from background (reload the extension after this update)");
    if (!resp.ok) throw new Error(resp.error || "request failed");
    const arr = parseCasesJSON(resp.text || "");
    const cases = arr.map((c) => ({
      scenario: String(c.scenario || "").trim(),
      steps: Array.isArray(c.steps) ? c.steps.map(String) : String(c.steps || "").split("\n").filter(Boolean),
      expected: String(c.expected || "").trim(),
      kind: "ai",
    })).filter((c) => c.scenario);
    if (!cases.length) { els.statusLine.textContent = "Claude replied, but no usable cases were parsed. Add an app description and try again."; return; }
    renderBatch(cases);
    els.statusLine.textContent = `Claude suggested ${cases.length} cases — review and add below.`;
  } catch (e) {
    els.statusLine.textContent = "AI error: " + ((e && e.message) || "request failed");
  } finally {
    els.aiBtn.disabled = false; els.aiBtn.textContent = oldLabel;
  }
}
els.aiBtn.addEventListener("click", aiSuggest);
function downloadText(text, filename, mime) {
  const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function updateCodeBar() {
  const { lastEvents = [], events = [] } = await chrome.storage.local.get(["lastEvents", "events"]);
  const src = (events && events.length) ? events : lastEvents;
  els.codeBar.hidden = !(src && src.length);
}

// ---- replay --------------------------------------------------------------
let replayActive = false;
const hasSensitive = (evs) => (evs || []).some((e) => e && e.type === "input" && e.sensitive);
const newRid = () => "r_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

async function startReplay(events, secret, caseRid, label) {
  if (state.recording) { els.statusLine.textContent = "Stop recording before replaying."; return; }
  if (hasSensitive(events) && !secret) {
    els.statusLine.textContent = "This flow has a password/secret field — type its value in the replay box first.";
    return;
  }
  let tab;
  try { [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); } catch (e) { tab = null; }
  if (!tab) { els.statusLine.textContent = "No active tab to replay in."; return; }
  const res = await chrome.runtime.sendMessage({ type: "REPLAY_START", events, tabId: tab.id, secret: secret || "", caseRid: caseRid || null, label: label || "" });
  if (!res || !res.ok) { els.statusLine.textContent = `Replay couldn't start: ${(res && res.error) || "unknown error"}`; return; }
  els.statusLine.textContent = `Replaying ${res.total} steps in this tab…`;
}

function renderReplay(rs) {
  if (!rs || (!rs.running && !rs.result)) { els.replayPanel.hidden = true; replayActive = false; return; }
  replayActive = !!rs.running;
  els.replayPanel.hidden = false;
  els.replayStopBtn.textContent = rs.running ? "Stop" : "Close";
  const pct = rs.total ? Math.round((rs.done / rs.total) * 100) : 0;
  els.replayProgress.style.width = (rs.running ? pct : 100) + "%";
  const name = rs.label ? ` — ${rs.label}` : "";
  els.replayTitle.className = "replay-title";
  if (rs.running) {
    els.replayTitle.textContent = `Replaying${name}… ${rs.done}/${rs.total}`;
  } else if (rs.result.ok) {
    els.replayTitle.classList.add("ok");
    els.replayTitle.textContent = `✓ Replay passed${name}` + (rs.result.warnings ? ` (${rs.result.warnings} warning${rs.result.warnings === 1 ? "" : "s"})` : "");
  } else {
    els.replayTitle.classList.add("bad");
    els.replayTitle.textContent = `✗ Replay failed${name}`;
  }
  els.replayLog.innerHTML = "";
  (rs.log || []).forEach((l) => {
    const li = document.createElement("li"); li.className = l.status;
    li.textContent = l.text;
    if (l.note) { const n = document.createElement("span"); n.className = "note"; n.textContent = l.note; li.append(n); }
    els.replayLog.append(li);
  });
  if (!rs.running && rs.result && !rs.result.ok && !(rs.log || []).some((l) => l.status === "fail")) {
    const li = document.createElement("li"); li.className = "fail"; li.textContent = rs.result.error; els.replayLog.append(li);
  }
  els.replayLog.scrollTop = els.replayLog.scrollHeight;
}

els.replayStopBtn.addEventListener("click", async () => {
  if (replayActive) { await chrome.runtime.sendMessage({ type: "REPLAY_STOP" }); return; }
  await save({ replayState: null });
  renderReplay(null);
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  if (changes.replayState) renderReplay(changes.replayState.newValue);
  // the background writes Pass/Fail onto the replayed case — pick it up
  if (changes.testcases) {
    const nv = changes.testcases.newValue;
    if (Array.isArray(nv) && JSON.stringify(nv) !== JSON.stringify(state.testcases)) {
      state.testcases = nv;
      renderSaved();
    }
  }
});
async function exportCode(kind) {
  const { lastEvents = [], events = [] } = await chrome.storage.local.get(["lastEvents", "events"]);
  const src = (events && events.length) ? events : lastEvents;
  if (!src || !src.length) { els.statusLine.textContent = "No recording to export yet — record a flow first."; return; }
  const date = new Date().toISOString().slice(0, 10);
  if (kind === "playwright") downloadText(window.TCGen.buildPlaywright(src), `test_${date}.spec.js`, "text/javascript");
  else downloadText(window.TCGen.buildCypress(src), `test_${date}.cy.js`, "text/javascript");
  els.statusLine.textContent = `${kind === "playwright" ? "Playwright" : "Cypress"} spec exported. Review selectors before running.`;
}
els.pwBtn.addEventListener("click", () => exportCode("playwright"));
els.cyBtn.addEventListener("click", () => exportCode("cypress"));
function updateKeyStatus() { els.keyStatus.textContent = (els.apiKey.value || "").trim() ? "✓ Saved on this device" : ""; }
els.apiKey.addEventListener("input", async () => { state.apiKey = els.apiKey.value.trim(); updateKeyStatus(); await save({ apiKey: state.apiKey }); });
els.showKey.addEventListener("click", () => {
  const showing = els.apiKey.type === "text";
  els.apiKey.type = showing ? "password" : "text";
  els.showKey.textContent = showing ? "Show" : "Hide";
});
els.aiModel.addEventListener("input", async () => { state.aiModel = els.aiModel.value.trim() || "claude-opus-5-5"; await save({ aiModel: state.aiModel }); });
els.appContext.addEventListener("input", async () => { state.appContext = els.appContext.value; await save({ appContext: state.appContext }); });
els.aiUseShots.addEventListener("change", async () => { state.aiUseShots = els.aiUseShots.checked; await save({ aiUseShots: state.aiUseShots }); });
els.copyBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(buildCSV());
  els.copyBtn.textContent = "Copied!"; setTimeout(() => (els.copyBtn.textContent = "Copy"), 1200);
});

// ---- Excel export --------------------------------------------------------
let _xlsxPromise = null;
function ensureXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (_xlsxPromise) return _xlsxPromise;
  _xlsxPromise = new Promise((resolve, reject) => {
    const sc = document.createElement("script");
    sc.src = "xlsx.full.min.js";
    sc.onload = () => resolve(window.XLSX);
    sc.onerror = () => { _xlsxPromise = null; reject(new Error("couldn't load the Excel library")); };
    document.head.appendChild(sc);
  });
  return _xlsxPromise;
}
async function exportXLSX() {
  try { els.xlsxBtn.disabled = true; await ensureXLSX(); } catch (e) { els.statusLine.textContent = "Excel export: " + e.message; els.xlsxBtn.disabled = false; return; }
  els.xlsxBtn.disabled = false;
  const aoa = [state.columns.map((c) => c.name)];
  state.testcases.forEach((tc, i) => aoa.push(state.columns.map((c) => cellFor(tc, c, i))));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const widthFor = (role) => ({ id: 10, scenario: 42, steps: 52, expected: 40, actual: 40, status: 12 }[role] || 20);
  ws["!cols"] = state.columns.map((c) => ({ wch: widthFor(c.role) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Test Cases");
  const { total, slices } = statusCounts();
  const sum = [["Metric", "Count", "Percent"], ["Total", total, "100%"]];
  slices.forEach((sl) => sum.push([sl.label, sl.value, (total ? Math.round((sl.value / total) * 100) : 0) + "%"]));
  const ws2 = XLSX.utils.aoa_to_sheet(sum); ws2["!cols"] = [{ wch: 18 }, { wch: 10 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws2, "Summary");
  XLSX.writeFile(wb, `testcases_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
els.xlsxBtn.addEventListener("click", exportXLSX);

// ---- CSV import ----------------------------------------------------------
function parseCSV(text) {
  text = text.replace(/^\ufeff/, "");
  const rows = []; let row = [], cur = "", inQ = false, i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i += 2; continue; } inQ = false; i++; continue; }
      cur += ch; i++; continue;
    }
    if (ch === '"') { inQ = true; i++; continue; }
    if (ch === ",") { row.push(cur); cur = ""; i++; continue; }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; i++; continue; }
    cur += ch; i++;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}
function guessRole(name) {
  const n = String(name).toLowerCase();
  if (/expected/.test(n)) return "expected";
  if (/actual/.test(n)) return "actual";
  if (/step/.test(n)) return "steps";
  if (/scenario|title|description|test\s*case/.test(n)) return "scenario";
  if (/\btc\s*id\b|test\s*id|case\s*id|^id$|\bid\b/.test(n)) return "id";
  if (/status|priority|severity/.test(n)) return "status";
  if (/module|feature|area|component|epic/.test(n)) return "module";
  return "blank";
}
function importRows(rows) {
  if (!rows.length) return;
  const headers = rows[0];
  const cols = headers.map((h, idx) => ({ id: "imp_" + idx + "_" + Math.random().toString(36).slice(2, 5), name: h.trim() || `Column ${idx + 1}`, role: guessRole(h) }));
  // avoid two 'id' columns etc. — keep first of each generative role, demote extras to blank
  const seen = {};
  cols.forEach((c) => {
    if (["id", "scenario", "steps", "expected", "actual", "status"].includes(c.role)) {
      if (seen[c.role]) c.role = "blank"; else seen[c.role] = true;
    }
  });
  const idColIdx = cols.findIndex((c) => c.role === "id");
  const cases = rows.slice(1).map((r) => {
    const cells = {};
    cols.forEach((c, idx) => { if (c.role !== "id") cells[c.id] = (r[idx] ?? "").trim(); });
    return { cells };
  });
  state.columns = cols;
  state.testcases = state.testcases.concat(cases);
  save({ columns: state.columns, testcases: state.testcases });
  renderColumns(); renderSaved();
  els.statusLine.textContent = `Imported ${cases.length} rows and set ${cols.length} columns from the file.`;
}
els.importCsv.addEventListener("click", () => els.csvFile.click());
els.csvFile.addEventListener("change", () => {
  const file = els.csvFile.files[0]; if (!file) return;
  if (!/\.csv$/i.test(file.name)) {
    els.statusLine.textContent = `"${file.name}" isn't a CSV file. Only .csv files can be imported.`;
    els.csvFile.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const rows = parseCSV(String(reader.result));
    if (rows.length < 1) { els.statusLine.textContent = "That file looked empty."; return; }
    if (!confirm(`Import ${rows.length - 1} rows and set columns from "${file.name}"? This replaces the current column layout.`)) { els.csvFile.value = ""; return; }
    importRows(rows);
    els.csvFile.value = "";
  };
  reader.readAsText(file);
});
els.clearBtn.addEventListener("click", async () => {
  if (!confirm("Delete all saved test cases?")) return;
  const ids = [...referencedShotIds()];
  state.testcases = []; await save({ testcases: [] });
  deleteShotImages(ids, false);
  renderAll();
});

// ---- settings ------------------------------------------------------------
els.settingsToggle.addEventListener("click", () => { els.settings.hidden = !els.settings.hidden; });
els.prefix.addEventListener("input", async () => { state.prefix = els.prefix.value.trim() || "SMK"; await save({ prefix: state.prefix }); renderSaved(); });
els.startNumber.addEventListener("input", async () => { state.startNumber = Math.max(1, Number(els.startNumber.value) || 1); await save({ startNumber: state.startNumber }); renderSaved(); });
els.optField.addEventListener("change", async () => { state.optField = els.optField.checked; await save({ optField: state.optField }); });
els.optFlow.addEventListener("change", async () => { state.optFlow = els.optFlow.checked; await save({ optFlow: state.optFlow }); });
els.optNeg.addEventListener("change", async () => { state.optNeg = els.optNeg.checked; await save({ optNeg: state.optNeg }); });
els.optElements.addEventListener("change", async () => { state.optElements = els.optElements.checked; await save({ optElements: state.optElements }); });
els.optMsgs.addEventListener("change", async () => { state.captureMsgs = els.optMsgs.checked; await save({ captureMsgs: state.captureMsgs }); });
els.optShots.addEventListener("change", async () => { state.captureShots = els.optShots.checked; await save({ captureShots: state.captureShots }); });
els.optAutoPass.addEventListener("change", async () => { state.autoPass = els.optAutoPass.checked; await save({ autoPass: state.autoPass }); });
els.resetStatusBtn.addEventListener("click", async () => {
  const stsCol = statusColumn(); if (!stsCol) return;
  if (!confirm("Set every case's status back to the default (not tested)?")) return;
  const d = defaultStatus();
  state.testcases.forEach((tc) => { tc.cells[stsCol.id] = d; });
  await save({ testcases: state.testcases });
  renderSaved();
});
els.statusOpts.addEventListener("change", async () => {
  const list = [...new Set(els.statusOpts.value.split(",").map((x) => x.trim()).filter(Boolean))];
  state.statusOptions = list.length ? list : DEFAULT_STATUS.slice();
  els.statusOpts.value = state.statusOptions.join(", ");
  els.apiKey.value = state.apiKey || ""; els.aiModel.value = state.aiModel || "claude-opus-5-5"; els.appContext.value = state.appContext || "";
  els.aiUseShots.checked = state.aiUseShots !== false;
  updateKeyStatus();
  await save({ statusOptions: state.statusOptions });
  renderSaved();
});
els.addCol.addEventListener("click", async () => {
  state.columns.push({ id: newColId(), name: "New Column", role: "blank" });
  await save({ columns: state.columns }); renderColumns(); renderSaved();
});
els.resetCols.addEventListener("click", async () => {
  if (!confirm("Reset columns to the default layout?")) return;
  state.columns = DEFAULT_COLUMNS(); await save({ columns: state.columns }); renderColumns(); renderSaved();
});

// ---- init ----------------------------------------------------------------
(async function init() {
  await load();
  els.prefix.value = state.prefix; els.startNumber.value = state.startNumber;
  els.optField.checked = state.optField; els.optFlow.checked = state.optFlow; els.optNeg.checked = state.optNeg; els.optElements.checked = state.optElements;
  els.optMsgs.checked = state.captureMsgs; els.optShots.checked = state.captureShots; els.optAutoPass.checked = state.autoPass;
  els.statusOpts.value = state.statusOptions.join(", ");
  els.apiKey.value = state.apiKey || ""; els.aiModel.value = state.aiModel || "claude-opus-5-5"; els.appContext.value = state.appContext || "";
  els.aiUseShots.checked = state.aiUseShots !== false;
  updateKeyStatus();
  renderColumns(); renderRecordState(); renderSaved();
  updateCodeBar();
  const { replayState } = await chrome.storage.local.get("replayState");
  renderReplay(replayState);
})();
