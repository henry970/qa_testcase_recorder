// background.js — serializes recorded events and captures per-page screenshots.

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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "RECORD_EVENT" && msg.event) {
    (async () => {
      const { recordingTabId } = await chrome.storage.local.get("recordingTabId");
      // Only accept events from the tab the recording was started on.
      if (recordingTabId != null && sender.tab && sender.tab.id !== recordingTabId) {
        sendResponse({ ok: false, ignored: true });
        return;
      }
      await appendEvent(msg.event);
      if (msg.event.type === "navigate" && sender.tab && (recordingTabId == null || sender.tab.id === recordingTabId)) {
        capturePage(sender.tab.windowId, { url: msg.event.url, page: msg.event.page });
      }
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (msg && msg.type === "AI_SUGGEST") {
    handleAISuggest(msg).then(sendResponse);
    return true; // async
  }
});

async function handleAISuggest({ apiKey, model, appContext, flow, existing, images }) {
  try {
    const system = "You are a senior QA engineer generating smoke and functional test cases for a web application. Return ONLY a JSON array — no prose, no markdown code fences. Each element must be an object: {\"scenario\": string (concise, starting with 'Validate'), \"steps\": array of short strings, \"expected\": string}. If screenshots of the app are provided, examine them and write test cases feature by feature — one or more cases for every interactive element you can see (buttons, menus, dropdowns, fields, checkboxes, links, tabs) — plus positive, negative, and edge cases. Each scenario must be unique; do NOT repeat any scenario listed in existingScenarios and do NOT produce two cases with the same scenario text.";
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
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model: model || "claude-sonnet-4-6", max_tokens: 4000, system, messages: [{ role: "user", content }] }),
    });
    let data;
    try { data = await res.json(); } catch (e) { return { ok: false, error: `HTTP ${res.status} (non-JSON response)` }; }
    if (!res.ok) return { ok: false, error: (data && data.error && data.error.message) || `HTTP ${res.status}` };
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    return { ok: true, text };
  } catch (e) {
    const m = (e && e.message) || String(e);
    return { ok: false, error: /Failed to fetch|NetworkError|Load failed/i.test(m) ? "network/permission blocked — reload the extension after updating, then retry" : m };
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const cur = await chrome.storage.local.get([
    "prefix", "startNumber", "recording", "events", "testcases", "columns",
    "optField", "optNeg", "optFlow", "optElements", "captureShots", "captureMsgs", "shots", "statusOptions", "paused", "autoPass", "apiKey", "aiModel", "appContext", "aiUseShots", "recordingTabId",
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
    aiModel: cur.aiModel ?? "claude-sonnet-4-6",
    apiKey: cur.apiKey ?? "",
    appContext: cur.appContext ?? "",
    aiUseShots: cur.aiUseShots ?? true,
    recordingTabId: cur.recordingTabId ?? null,
    captureShots: cur.captureShots ?? true,
    captureMsgs: cur.captureMsgs ?? true,
    shots: cur.shots ?? [],
    statusOptions: cur.statusOptions ?? ["Pass", "Fail", "Not Tested", "Pending"],
    columns: cur.columns ?? [
      { id: "c_id", name: "TC ID", role: "id" },
      { id: "c_scn", name: "Test Scenario", role: "scenario" },
      { id: "c_stp", name: "Test Steps", role: "steps" },
      { id: "c_exp", name: "Expected Result", role: "expected" },
      { id: "c_act", name: "Actual Result", role: "actual" },
      { id: "c_sts", name: "Status", role: "status" },
      { id: "c_col1", name: "Column 1", role: "blank" },
    ],
  });
});
