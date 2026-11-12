// replay.js — re-runs a recorded flow in a real tab and reports pass / fail.
// Loaded into the background service worker with importScripts().
//
// The background drives the run (so it survives the popup closing); each step
// is executed inside the page with chrome.scripting.executeScript, in the right
// tab and, for iframe events, the right frame.

let replayAbort = false;
let replayRunning = false;

const REPLAY_TYPES = ["navigate", "newtab", "input", "select", "toggle", "click", "key", "message"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Tabs opened while a replay runs — used to follow "opens in a new tab" steps.
let replayCreatedTabs = [];
function noteCreatedTab(id, openerTabId) {
  if (!replayCreatedTabs.some((t) => t.id === id)) replayCreatedTabs.push({ id, openerTabId, claimed: false });
}
chrome.tabs.onCreated.addListener((tab) => {
  if (replayRunning) noteCreatedTab(tab.id, tab.openerTabId);
});

function replayStepLabel(ev) {
  const where = ev.frame ? ` (in frame ${ev.frame.title || ev.frame.name || shortUrl(ev.frame.url)})` : "";
  switch (ev.type) {
    case "navigate": return `Open ${ev.page || shortUrl(ev.url)}`;
    case "newtab": return "Switch to the new tab";
    case "click": return `Click "${ev.label}"${where}`;
    case "input": return `Enter ${ev.sensitive ? "the secret value" : `"${ev.value ?? ""}"`} into "${ev.label}"${where}`;
    case "select": return `Select "${ev.value}" in "${ev.label}"${where}`;
    case "toggle": return `${ev.checked ? "Check" : "Uncheck"} "${ev.label}"${where}`;
    case "key": return `Press ${ev.value} in "${ev.label}"${where}`;
    case "message": return `See message "${ev.text}"${where}`;
    default: return ev.type;
  }
}
function shortUrl(u) {
  try { const x = new URL(u); return x.hostname + (x.pathname === "/" ? "" : x.pathname); } catch (e) { return u || "page"; }
}
function sameUrl(a, b) {
  try {
    const x = new URL(a), y = new URL(b);
    return x.origin === y.origin && x.pathname.replace(/\/$/, "") === y.pathname.replace(/\/$/, "");
  } catch (e) { return a === b; }
}

async function waitForLoad(tabId, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    let t;
    try { t = await chrome.tabs.get(tabId); } catch (e) { throw new Error("The tab was closed."); }
    if (t.status === "complete") return t;
    await sleep(150);
  }
  return chrome.tabs.get(tabId);
}
async function navigateTo(tabId, url) {
  await chrome.tabs.update(tabId, { url });
  await sleep(400);
  await waitForLoad(tabId, 20000);
}
async function waitForNewTab(openerTabId, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const hit = replayCreatedTabs.find((t) => !t.claimed && t.openerTabId === openerTabId)
      || replayCreatedTabs.find((t) => !t.claimed);
    if (hit) { hit.claimed = true; return hit.id; }
    await sleep(150);
  }
  return null;
}

async function setReplayState(patch) {
  const { replayState = {} } = await chrome.storage.local.get("replayState");
  await chrome.storage.local.set({ replayState: Object.assign({}, replayState, patch) });
}

async function startReplay({ events, tabId, secret, caseRid, label }) {
  if (replayRunning) return { ok: false, error: "A replay is already running." };
  const { recording } = await chrome.storage.local.get("recording");
  if (recording) return { ok: false, error: "Stop recording before replaying." };
  const evs = (events || []).filter((e) => e && REPLAY_TYPES.includes(e.type));
  if (!evs.length) return { ok: false, error: "This recording has no replayable steps." };
  if (tabId == null) return { ok: false, error: "No tab to replay in." };
  replayRunning = true; replayAbort = false; replayCreatedTabs = [];
  runReplay(evs, tabId, secret || null, caseRid || null, label || "recording")
    .catch((e) => setReplayState({ running: false, result: { ok: false, error: String((e && e.message) || e) } }))
    .finally(() => { replayRunning = false; });
  return { ok: true, total: evs.length };
}

async function runReplay(evs, startTabId, secret, caseRid, label) {
  const log = [];
  await chrome.storage.local.set({
    replayState: { running: true, label, caseRid, total: evs.length, done: 0, log, result: null, startedAt: Date.now() },
  });

  const tabMap = new Map(); // recorded tabId -> live tabId
  const firstRecorded = (evs.find((e) => e.tabId != null) || {}).tabId;
  if (firstRecorded != null) tabMap.set(firstRecorded, startTabId);
  let cur = startTabId;
  let firstNav = true;
  let lastActionType = null;
  let failure = null;
  let warnings = 0;

  for (let i = 0; i < evs.length; i++) {
    const ev = evs[i];
    const text = replayStepLabel(ev);
    if (replayAbort) { failure = { step: i + 1, text, error: "Stopped by user." }; break; }

    // follow the event to the tab it was recorded in
    if (ev.type !== "newtab" && ev.tabId != null && tabMap.has(ev.tabId) && tabMap.get(ev.tabId) !== cur) {
      cur = tabMap.get(ev.tabId);
      try { await chrome.tabs.update(cur, { active: true }); } catch (e) { /* closed */ }
    }

    let status = "pass", note = "";
    try {
      if (ev.type === "navigate") {
        if (firstNav) {
          firstNav = false;
          await navigateTo(cur, ev.url);
        } else {
          await waitForLoad(cur);
          let t = await chrome.tabs.get(cur);
          if (!sameUrl(t.url, ev.url)) {
            if (lastActionType === "click" || lastActionType === "key") {
              const end = Date.now() + 5000;
              while (Date.now() < end && !sameUrl(t.url, ev.url)) { await sleep(250); t = await chrome.tabs.get(cur); }
              if (!sameUrl(t.url, ev.url)) { status = "warn"; note = `Expected ${shortUrl(ev.url)}, landed on ${shortUrl(t.url)}`; }
            } else {
              await navigateTo(cur, ev.url); // the user typed / opened this URL directly
            }
          }
        }
      } else if (ev.type === "newtab") {
        const live = await waitForNewTab(cur);
        if (live == null) throw new Error("Expected a new tab to open, but none did.");
        tabMap.set(ev.tabId, live);
        cur = live;
        await waitForLoad(cur, 20000);
      } else {
        const res = await runStepInTab(cur, ev, secret);
        if (res.openUrl) {
          // a target=_blank link — open it ourselves so pop-up blocking can't stop it
          const t = await chrome.tabs.create({ url: res.openUrl, openerTabId: cur, active: true });
          noteCreatedTab(t.id, cur);
        }
        if (res.warn) { status = "warn"; note = res.warn; }
        if (ev.type === "click" || ev.type === "key") await sleep(500); // let navigation / XHR start
      }
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (ev.type === "message" && ev.level !== "success") { status = "warn"; note = msg; }
      else { status = "fail"; note = msg; }
    }

    if (ev.type !== "message") lastActionType = ev.type;
    if (status === "warn") warnings++;
    log.push({ step: i + 1, text, status, note });
    await setReplayState({ done: i + 1, log });
    if (status === "fail") { failure = { step: i + 1, text, error: note }; break; }
  }

  // evidence: screenshot of the final (or failing) screen
  let shotId = null;
  try {
    const t = await chrome.tabs.get(cur);
    const dataUrl = await chrome.tabs.captureVisibleTab(t.windowId, { format: "jpeg", quality: 60 });
    if (dataUrl) {
      shotId = "s_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      await chrome.storage.local.set({ ["shot:" + shotId]: dataUrl });
    }
  } catch (e) { /* restricted page or window not visible */ }

  const result = failure
    ? { ok: false, failedStep: failure.step, error: `Step ${failure.step} failed: ${failure.text} — ${failure.error}`, warnings }
    : { ok: true, warnings, steps: evs.length };

  let attached = false;
  if (caseRid) attached = await recordReplayOnCase(caseRid, result, log, shotId);
  if (shotId && !attached) await chrome.storage.local.remove("shot:" + shotId);
  await setReplayState({ running: false, result, finishedAt: Date.now() });
}

// Write Pass/Fail + Actual Result onto the saved test case that was replayed.
async function recordReplayOnCase(rid, result, log, shotId) {
  return serialize(async () => {
    const { testcases = [], columns = [], statusOptions = [] } = await chrome.storage.local.get(["testcases", "columns", "statusOptions"]);
    const tc = testcases.find((t) => t.rid === rid);
    if (!tc) return false;
    tc.cells = tc.cells || {};
    const stsCol = columns.find((c) => c.role === "status");
    const actCol = columns.find((c) => c.role === "actual");
    const pick = (re1, re2, fallback) => statusOptions.find((o) => re1.test(o)) || statusOptions.find((o) => re2.test(o)) || fallback;
    if (stsCol) tc.cells[stsCol.id] = result.ok ? pick(/^pass$/i, /pass/i, "Pass") : pick(/^fail/i, /fail/i, "Fail");
    if (actCol) {
      const when = new Date().toLocaleString();
      const warnLines = log.filter((l) => l.status === "warn").map((l) => `  • ${l.text}: ${l.note}`);
      tc.cells[actCol.id] = result.ok
        ? `Replay passed — all ${result.steps} steps completed (${when}).` + (warnLines.length ? `\nWarnings:\n${warnLines.join("\n")}` : "")
        : `Replay failed (${when}). ${result.error}`;
    }
    if (shotId) tc.shots = (tc.shots || []).concat(shotId);
    tc.lastReplay = { ok: result.ok, at: Date.now() };
    await chrome.storage.local.set({ testcases });
    return true;
  });
}

// Run one step in the tab; for iframe events, in the matching frame.
async function runStepInTab(tabId, ev, secret) {
  await waitForLoad(tabId);
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: !!ev.frame },
      func: replayStepInPage,
      args: [ev, secret],
    });
  } catch (e) {
    const msg = String((e && e.message) || e);
    // a click that navigates can tear the frame down mid-call — that's success
    if ((ev.type === "click" || ev.type === "key") && /navigat|removed|closed|unload|Frame with ID/i.test(msg)) return { ok: true };
    throw new Error(/Cannot access|chrome:\/\//i.test(msg) ? "This page can't be scripted (browser-restricted)." : msg);
  }
  const hits = (results || []).map((r) => r && r.result).filter((r) => r && !r.skip);
  if (!hits.length) throw new Error(ev.frame ? "The iframe for this step wasn't found." : "The page didn't respond.");
  const res = hits.find((r) => r.ok) || hits[0];
  if (!res.ok) throw new Error(res.error || "Step failed.");
  return res;
}

// ---- runs INSIDE the page (must be self-contained) -------------------------
async function replayStepInPage(ev, secret) {
  const IS_TOP = window === window.top;
  if (ev.frame) {
    if (IS_TOP) return { skip: true };
    const f = ev.frame;
    let match = !!(f.name && window.name === f.name);
    if (!match) {
      try { const a = new URL(f.url); match = a.origin === location.origin && a.pathname === location.pathname; } catch (e) { /* bad url */ }
    }
    if (!match) return { skip: true };
  } else if (!IS_TOP) {
    return { skip: true };
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const esc = (v) => String(v).replace(/["\\]/g, "\\$&");
  const visible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };
  const sel = ev.sel || {};
  const isField = ["input", "select", "toggle"].includes(ev.type) || ["input", "textarea", "select"].includes(sel.tag);

  function labelOf(el) {
    const aria = el.getAttribute && el.getAttribute("aria-label");
    if (aria) return aria;
    if (el.labels && el.labels[0]) return el.labels[0].textContent;
    return el.innerText || el.value || el.getAttribute("placeholder") || el.name || el.id || "";
  }
  function q(css) { try { return document.querySelector(css); } catch (e) { return null; } }

  function find() {
    const tries = [];
    if (sel.testid) tries.push(() => q(`[data-testid="${esc(sel.testid)}"],[data-test="${esc(sel.testid)}"],[data-cy="${esc(sel.testid)}"]`));
    if (sel.id) tries.push(() => document.getElementById(sel.id));
    if (sel.name) tries.push(() => {
      const group = [...document.getElementsByName(sel.name)].filter((e) => !sel.tag || e.tagName.toLowerCase() === sel.tag);
      if (group.length <= 1) return group[0] || null;
      return group.find((e) => norm(labelOf(e)) === norm(ev.label)) || null; // radio groups share a name
    });
    if (sel.ariaLabel) tries.push(() => q(`[aria-label="${esc(sel.ariaLabel)}"]`));
    if (isField && sel.placeholder) tries.push(() => q(`[placeholder="${esc(sel.placeholder)}"]`));
    if (isField && ev.label) tries.push(() => {
      for (const lab of document.querySelectorAll("label")) {
        if (norm(lab.textContent) === norm(ev.label)) {
          const c = lab.control || lab.querySelector("input, select, textarea");
          if (c) return c;
        }
      }
      return null;
    });
    if (!isField) tries.push(() => {
      const want = norm(sel.text || sel.ariaLabel || ev.label);
      if (!want) return null;
      const css = 'button, a, [role="button"], [role="link"], [role="tab"], [role="menuitem"], input[type="submit"], input[type="button"], label, [onclick], .btn' + (sel.tag ? ", " + sel.tag : "");
      const cands = [...document.querySelectorAll(css)].filter(visible);
      const txt = (e) => norm(e.innerText || e.value || e.getAttribute("aria-label"));
      return cands.find((e) => txt(e) === want) || cands.find((e) => txt(e).includes(want)) || null;
    });
    let fallback = null;
    for (const t of tries) {
      let el = null;
      try { el = t(); } catch (e) { el = null; }
      if (el) { if (visible(el)) return el; fallback = fallback || el; }
    }
    return fallback;
  }

  // assertion step: the recorded message text appears on the page
  if (ev.type === "message") {
    const want = norm(ev.text);
    const end = Date.now() + 6000;
    while (Date.now() < end) {
      if (norm(document.body && document.body.innerText).includes(want)) return { ok: true };
      await wait(200);
    }
    return { ok: false, error: `Message "${ev.text}" did not appear.` };
  }

  let el = null;
  const end = Date.now() + 7000;
  while (Date.now() < end) {
    el = find();
    if (el && visible(el)) break;
    await wait(200);
  }
  if (!el) return { ok: false, error: `Couldn't find "${ev.label}" on the page.` };

  try { el.scrollIntoView({ block: "center", inline: "nearest" }); } catch (e) { /* ignore */ }
  const prevOutline = el.style.outline;
  el.style.outline = "3px solid #8b5cf6";
  setTimeout(() => { el.style.outline = prevOutline; }, 700);

  const fire = (type) => el.dispatchEvent(new Event(type, { bubbles: true }));
  function setValue(v) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, v); else el.value = v;
    fire("input"); fire("change");
  }

  switch (ev.type) {
    case "click": {
      const a = el.closest && el.closest("a[href]");
      if (a && a.target === "_blank" && /^https?:/i.test(a.href)) return { ok: true, openUrl: a.href };
      el.click();
      return { ok: true };
    }
    case "input": {
      let v = ev.value;
      if (ev.sensitive) {
        if (!secret) return { ok: false, error: `"${ev.label}" is a secret field — enter its value in the replay box first.` };
        v = secret;
      }
      el.focus();
      setValue(v == null ? "" : String(v));
      el.blur();
      return { ok: true };
    }
    case "select": {
      if (el.tagName !== "SELECT") return { ok: false, error: `"${ev.label}" is not a dropdown.` };
      const opt = [...el.options].find((o) => norm(o.text) === norm(ev.value)) || [...el.options].find((o) => norm(o.value) === norm(ev.value));
      if (!opt) return { ok: false, error: `Option "${ev.value}" not found in "${ev.label}".` };
      el.focus();
      setValue(opt.value);
      return { ok: true };
    }
    case "toggle": {
      if (!!el.checked !== !!ev.checked) el.click();
      return !!el.checked === !!ev.checked ? { ok: true } : { ok: true, warn: `"${ev.label}" did not change state.` };
    }
    case "key": {
      el.focus();
      const opts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
      const go = el.dispatchEvent(new KeyboardEvent("keydown", opts));
      el.dispatchEvent(new KeyboardEvent("keypress", opts));
      el.dispatchEvent(new KeyboardEvent("keyup", opts));
      if (go && el.form && el.tagName === "INPUT") {
        if (el.form.requestSubmit) el.form.requestSubmit(); else el.form.submit();
      }
      return { ok: true };
    }
    default:
      return { ok: true };
  }
}
