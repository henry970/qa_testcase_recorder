// background.js — serializes recorded events and captures per-page screenshots.

const DEFAULT_MODEL = "claude-opus-5-5";
const OLD_DEFAULT_MODELS = ["claude-sonnet-4-6"]; // previous built-in defaults, migrated on update
const FALLBACK_MODELS = ["claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"];

let chain = Promise.resolve();
function serialize(fn) { chain = chain.then(fn).catch(() => {}); return chain; }

async function appendEvent(ev) {
  return serialize(async () => {
    const { events = [] } = await chrome.storage.local.get("events");
    events.push(ev);
    await chrome.storage.local.set({ events });
  });
}

let lastShot = { url: "", ts: 0 };
async function capturePage(windowId, meta) {
  const { captureShots = true, recording, paused } = await chrome.storage.local.get(["captureShots", "recording", "paused"]);
  if (!recording || paused || !captureShots || windowId == null) return;
  const now = Date.now();
  if (meta.url === lastShot.url && now - lastShot.ts < 1500) return; // dedupe load+start
  lastShot = { url: meta.url, ts: now };
  try {
    // let the page paint first
    await new Promise((r) => setTimeout(r, 450));
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 55 });
    if (!dataUrl) return;
    const id = "s_" + now.toString(36) + Math.random().toString(36).slice(2, 6);
    await serialize(async () => {
      const st = await chrome.storage.local.get(["shots"]);
      const shots = st.shots || [];
      shots.push({ id, url: meta.url, page: meta.page, ts: now });
      await chrome.storage.local.set({ shots, ["shot:" + id]: dataUrl });
    });
  } catch (e) { /* chrome:// pages, throttling, etc. — skip */ }
}

// ---- multi-tab recording ---------------------------------------------------
// A recording starts on one tab; any tab (or popup window) opened FROM a recorded
// tab joins the recording, so OAuth / "open in new tab" / payment pop-ups work.
async function recordedTabIds() {
  const { recordingTabId, recordingTabIds } = await chrome.storage.local.get(["recordingTabId", "recordingTabIds"]);
  const ids = Array.isArray(recordingTabIds) ? recordingTabIds.slice() : [];
  if (recordingTabId != null && !ids.includes(recordingTabId)) ids.unshift(recordingTabId);
  return ids;
}

chrome.tabs.onCreated.addListener((tab) => {
  serialize(async () => {
    const { recording } = await chrome.storage.local.get("recording");
    if (!recording || tab.openerTabId == null) return;
    const ids = await recordedTabIds();
    if (!ids.includes(tab.openerTabId)) return;
    if (!ids.includes(tab.id)) ids.push(tab.id);
    const { events = [], paused } = await chrome.storage.local.get(["events", "paused"]);
    const update = { recordingTabIds: ids };
    if (!paused) {
      events.push({ type: "newtab", tabId: tab.id, openerTabId: tab.openerTabId, ts: Date.now(), url: tab.pendingUrl || tab.url || "", page: "" });
      update.events = events;
    }
    await chrome.storage.local.set(update);
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "RECORD_EVENT" && msg.event) {
    (async () => {
      const ids = await recordedTabIds();
      const tabId = sender.tab ? sender.tab.id : null;
      // Only accept events from the recorded tab(s).
      if (ids.length && tabId != null && !ids.includes(tabId)) {
        sendResponse({ ok: false, ignored: true });
        return;
      }
      const ev = msg.event;
      if (tabId != null) ev.tabId = tabId;
      await appendEvent(ev);
      if (ev.type === "navigate" && sender.tab && sender.frameId === 0) {
        capturePage(sender.tab.windowId, { url: ev.url, page: ev.page });
      }
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (msg && msg.type === "REPLAY_START") {
    startReplay(msg).then(sendResponse);
    return true;
  }
  if (msg && msg.type === "REPLAY_STOP") {
    replayAbort = true;
    sendResponse({ ok: true });
    return false;
  }
  if (msg && msg.type === "AI_SUGGEST") {
    handleAISuggest(msg).then(sendResponse);
    return true; // async
  }
});

async function handleAISuggest({ apiKey, model, appContext, flow, existing, images }) {
  try {
    const system = [
      "You are a senior QA engineer writing manual test cases for a web application. A tester will execute your cases step by step, so each one has to be specific enough to run without guessing and to give a clear pass/fail verdict.",
      "Return only a JSON array, with no prose and no markdown code fences. Each element is an object: {\"module\": string (feature area, e.g. Login, Transactions), \"scenario\": string (one concise sentence starting with 'Validate'), \"preconditions\": array of strings (state needed before step 1, e.g. 'User is logged in as an admin'), \"steps\": array of short imperative strings, \"testData\": array of 'Field: value' strings (empty array if none), \"expected\": string, \"priority\": one of Critical | High | Medium | Low, \"type\": one of Positive | Negative | Validation | Boundary | Functional | UI | Security}.",
      "Quality bar: steps name the exact control and the exact value to use (write 'Enter \"-500\" into the \"Amount\" field', not 'enter invalid data'). The expected result is observable and checkable: the message text, the page that opens, the value shown, or what must not happen. Avoid vague outcomes like 'works as expected' or 'performs its intended action'. Test one behaviour per case. Use the recorded flow's real field labels, button names and values where they apply.",
      "Coverage: mix positive, negative, boundary-value (min/max length, zero, negative, very large numbers), required-field, and permission or security cases where relevant. If screenshots are provided, cover the interactive elements you can see on them, feature by feature.",
      "Each scenario must be unique: do not repeat anything listed in existingScenarios, and do not produce two cases with the same scenario text.",
    ].join("\n\n");
    const user = JSON.stringify({
      app: appContext || "(no description provided — infer from the recorded flow)",
      recordedFlow: flow || null,
      existingScenarios: existing || [],
      howMany: 12,
    });
    const content = [];
    (images || []).forEach((im) => {
      if (im && im.data) content.push({ type: "image", source: { type: "base64", media_type: im.media_type || "image/jpeg", data: im.data } });
    });
    content.push({ type: "text", text: user });
    const useModel = (model || DEFAULT_MODEL).trim();
    const headers = {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    };
    const body = { model: useModel, max_tokens: 16000, system, messages: [{ role: "user", content }] };
    // On models that support it, let the API retry a safety decline on a
    // suitable fallback model instead of returning nothing.
    if (FALLBACK_MODELS.includes(useModel)) {
      headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
      body.fallbacks = "default";
    }
    const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify(body) });
    let data;
    try { data = await res.json(); } catch (e) { return { ok: false, error: `HTTP ${res.status} (non-JSON response)` }; }
    if (!res.ok) return { ok: false, error: (data && data.error && data.error.message) || `HTTP ${res.status}` };
    if (data.stop_reason === "refusal") {
      const why = data.stop_details && data.stop_details.explanation;
      return { ok: false, error: "Claude declined this request" + (why ? `: ${why}` : ".") };
    }
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    if (!text && data.stop_reason === "max_tokens") return { ok: false, error: "response was cut off (max_tokens) — try again with fewer screenshots" };
    return { ok: true, text };
  } catch (e) {
    const m = (e && e.message) || String(e);
    return { ok: false, error: /Failed to fetch|NetworkError|Load failed/i.test(m) ? "network/permission blocked — reload the extension after updating, then retry" : m };
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const cur = await chrome.storage.local.get([
    "prefix", "startNumber", "recording", "events", "testcases", "columns",
    "optField", "optNeg", "optFlow", "optElements", "captureShots", "captureMsgs", "shots", "statusOptions", "paused", "autoPass", "apiKey", "aiModel", "appContext", "aiUseShots", "recordingTabId", "recordingTabIds",
  ]);
  await chrome.storage.local.set({
    prefix: cur.prefix ?? "SMK",
    startNumber: cur.startNumber ?? 1,
    recording: cur.recording ?? false,
    paused: cur.paused ?? false,
    events: cur.events ?? [],
    testcases: cur.testcases ?? [],
    optField: cur.optField ?? true,
    optNeg: cur.optNeg ?? true,
    optFlow: cur.optFlow ?? true,
    optElements: cur.optElements ?? true,
    autoPass: cur.autoPass ?? true,
    aiModel: (!cur.aiModel || OLD_DEFAULT_MODELS.includes(cur.aiModel)) ? DEFAULT_MODEL : cur.aiModel,
    apiKey: cur.apiKey ?? "",
    appContext: cur.appContext ?? "",
    aiUseShots: cur.aiUseShots ?? true,
    recordingTabId: cur.recordingTabId ?? null,
    recordingTabIds: cur.recordingTabIds ?? [],
    captureShots: cur.captureShots ?? true,
    captureMsgs: cur.captureMsgs ?? true,
    shots: cur.shots ?? [],
    statusOptions: cur.statusOptions ?? ["Pass", "Fail", "Not Tested", "Pending"],
    columns: cur.columns ?? [
      // keep in sync with DEFAULT_COLUMNS in popup.js
      { id: "c_id", name: "TC ID", role: "id" },
      { id: "c_mod", name: "Test Module", role: "module" },
      { id: "c_scn", name: "Test Scenario", role: "scenario" },
      { id: "c_pre", name: "Preconditions", role: "preconditions" },
      { id: "c_stp", name: "Test Steps", role: "steps" },
      { id: "c_dat", name: "Test Data", role: "data" },
      { id: "c_exp", name: "Expected Result", role: "expected" },
      { id: "c_act", name: "Actual Result", role: "actual" },
      { id: "c_pri", name: "Priority", role: "priority", options: ["Critical", "High", "Medium", "Low"] },
      { id: "c_sts", name: "Status", role: "status" },
      { id: "c_col1", name: "Column 1", role: "blank" },
    ],
  });
});

importScripts("replay.js");
