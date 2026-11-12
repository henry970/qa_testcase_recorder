// content.js
// Runs in every page. Captures user actions while recording is active and
// forwards them to the background service worker.

(function () {
  // Guard against double injection (manifest + scripting.executeScript). A copy
  // left over from before an extension reload is orphaned (no runtime id), so
  // a fresh copy is allowed to take over in that case.
  try {
    if (window.__qaRecAlive && window.__qaRecAlive()) return;
  } catch (e) { /* orphaned copy threw — take over */ }
  window.__qaRecAlive = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; } };

  // In an iframe we tag every event with the frame so steps and generated code
  // can target it. Navigation is only tracked by the top frame.
  const IS_TOP = window === window.top;
  function frameInfo() {
    if (IS_TOP) return null;
    let src = "";
    try { src = (window.frameElement && window.frameElement.getAttribute("src")) || ""; } catch (e) { /* cross-origin */ }
    let title = "";
    try { title = (window.frameElement && (window.frameElement.getAttribute("title") || window.frameElement.id)) || ""; } catch (e) { /* cross-origin */ }
    return { url: location.href, name: window.name || "", src, title };
  }
  const FRAME = frameInfo();

  let recording = false;
  let paused = false;

  // ---- helpers -----------------------------------------------------------

  const SENSITIVE = /pass|pwd|cvv|card|secret|otp|pin|ssn|token/i;

  function isSensitive(el) {
    if (!el) return false;
    if (el.type === "password") return true;
    const hay = `${el.name || ""} ${el.id || ""} ${el.autocomplete || ""}`;
    return SENSITIVE.test(hay);
  }

  // Selector metadata for code generation (Playwright/Cypress).
  function selFor(el) {
    if (!el || !el.getAttribute) return null;
    const t = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
    return {
      testid: el.getAttribute("data-testid") || el.getAttribute("data-test") || el.getAttribute("data-cy") || null,
      id: el.id || null,
      name: el.name || null,
      role: el.getAttribute("role") || null,
      ariaLabel: el.getAttribute("aria-label") || null,
      placeholder: el.getAttribute("placeholder") || null,
      type: el.type || null,
      tag: (el.tagName || "").toLowerCase(),
      text: t && t.length <= 60 ? t : null,
      rules: rulesFor(el),
    };
  }

  // The field's own validation rules, so cases can test real boundaries.
  function rulesFor(el) {
    const tag = (el.tagName || "").toLowerCase();
    if (tag !== "input" && tag !== "textarea" && tag !== "select") return null;
    const r = {};
    if (el.required || el.getAttribute("aria-required") === "true") r.required = true;
    if (el.maxLength > 0 && el.maxLength < 100000) r.maxLength = el.maxLength;
    if (el.minLength > 0) r.minLength = el.minLength;
    const min = el.getAttribute("min"), max = el.getAttribute("max");
    if (min !== null && min !== "") r.min = min;
    if (max !== null && max !== "") r.max = max;
    const pattern = el.getAttribute("pattern");
    if (pattern) r.pattern = pattern;
    const mode = el.getAttribute("inputmode");
    if (mode) r.inputMode = mode;
    return Object.keys(r).length ? r : null;
  }

  // Best-effort human-readable label for an element.
  function labelFor(el) {
    if (!el) return "element";

    // 1. aria-label
    const aria = el.getAttribute && el.getAttribute("aria-label");
    if (aria && aria.trim()) return aria.trim();

    // 2. aria-labelledby
    const labelledby = el.getAttribute && el.getAttribute("aria-labelledby");
    if (labelledby) {
      const ref = document.getElementById(labelledby);
      if (ref && ref.textContent.trim()) return ref.textContent.trim();
    }

    // 3. associated <label> (for form fields)
    if (el.labels && el.labels.length && el.labels[0].textContent.trim()) {
      return el.labels[0].textContent.trim();
    }

    // 4. visible text (buttons, links)
    const text = (el.innerText || el.textContent || "").trim();
    if (text && text.length <= 60) return text;

    // 5. value on buttons
    if (el.value && (el.tagName === "BUTTON" || el.type === "submit" || el.type === "button")) {
      return String(el.value).trim();
    }

    // 6. placeholder / title / name / id
    const fallback =
      el.getAttribute?.("placeholder") ||
      el.getAttribute?.("title") ||
      el.name ||
      el.id;
    if (fallback && String(fallback).trim()) return String(fallback).trim();

    return el.tagName ? el.tagName.toLowerCase() : "element";
  }

  // Find the meaningful clickable ancestor of the raw event target.
  function actionable(target) {
    if (!target || !target.closest) return target;
    const hit = target.closest(
      'button, a, [role="button"], [role="link"], [role="tab"], [role="menuitem"], input[type="submit"], input[type="button"], input[type="checkbox"], input[type="radio"], label, [onclick], .btn'
    );
    return hit || target;
  }

  function kindOf(el) {
    const tag = (el.tagName || "").toLowerCase();
    const role = el.getAttribute?.("role");
    if (tag === "a" || role === "link") return "link";
    if (tag === "button" || role === "button" || el.type === "submit" || el.type === "button") return "button";
    if (el.type === "checkbox") return "checkbox";
    if (el.type === "radio") return "radio";
    if (tag === "select") return "select";
    if (tag === "textarea") return "textarea";
    if (tag === "input") return "input";
    return role || tag || "element";
  }

  function send(event) {
    if (!recording || paused) return;
    if (!IS_TOP && event.type === "navigate") return; // frames don't navigate the test
    event.ts = Date.now();
    event.url = IS_TOP ? location.href : "";
    event.page = IS_TOP ? (document.title || location.pathname) : "";
    if (FRAME) event.frame = FRAME;
    try {
      chrome.runtime.sendMessage({ type: "RECORD_EVENT", event });
    } catch (e) {
      /* extension context invalidated on reload — ignore */
    }
  }

  // Lets the popup detect whether a live recorder is present in this tab.
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
      if (msg && msg.type === "PING") { respond({ alive: true }); return true; }
    });
  } catch (e) { /* orphaned context */ }

  // ---- login-feature presence scan ---------------------------------------
  // Only report a feature case when the element is actually on the page.
  const sentFeatures = new Set();
  const scannedUrls = new Set();

  function textOf(el) {
    return ((el.textContent || "") + " " + (el.getAttribute?.("aria-label") || "") + " " +
      (el.getAttribute?.("title") || "") + " " + (el.className && el.className.toString ? el.className.toString() : "")).trim();
  }
  function reportFeature(feature, label) {
    if (sentFeatures.has(feature)) return;
    sentFeatures.add(feature);
    send({ type: "feature", feature, label: label || "" });
  }
  function scanLoginFeatures() {
    if (!recording || paused) return;
    if (!document.querySelector('input[type="password"]')) return; // not a login form
    if (scannedUrls.has(location.href)) return;
    scannedUrls.add(location.href);

    // Remember Me — a checkbox labelled "remember"
    const remember = [...document.querySelectorAll('input[type="checkbox"]')].find((cb) => {
      const lbl = (cb.labels && cb.labels[0] && cb.labels[0].textContent) || cb.getAttribute("aria-label") || cb.name || cb.id || "";
      return /remember/i.test(lbl);
    });
    if (remember) reportFeature("remember");

    // Forgot Password — a link/button
    const forgot = [...document.querySelectorAll('a, button, [role="link"], [role="button"]')].find((a) =>
      /forgot\s*password|reset\s*password|forgot\s*your\s*password/i.test((a.textContent || "").trim())
    );
    if (forgot) reportFeature("forgot");

    // Show/Hide password — a toggle/eye control
    const toggle = [...document.querySelectorAll('button, [role="button"], span, i, svg, a, [class*="eye"], [class*="password-toggle"], [class*="show-password"]')].find((el) =>
      /show\s*password|hide\s*password|toggle\s*password|reveal\s*password|password-toggle|show-password|(^|[\s-])eye([\s-]|$)/i.test(textOf(el))
    );
    if (toggle) reportFeature("showhide");
  }

  // ---- listeners ---------------------------------------------------------

  document.addEventListener(
    "click",
    (e) => {
      if (!recording) return;
      const el = actionable(e.target);
      const kind = kindOf(el);
      // checkboxes/radios are captured on 'change' to know their state
      if (kind === "checkbox" || kind === "radio") return;
      // clicking into a text field / dropdown is captured by the input/select
      // event — don't also log it as a click (it isn't a button).
      const tag = (el.tagName || "").toLowerCase();
      const typ = (el.type || "").toLowerCase();
      const textField = tag === "textarea" || tag === "select" ||
        (tag === "input" && !["button", "submit", "reset", "image"].includes(typ));
      if (textField || el.isContentEditable) return;
      send({ type: "click", kind, label: labelFor(el), sel: selFor(el) });
    },
    true
  );

  document.addEventListener(
    "change",
    (e) => {
      if (!recording) return;
      const el = e.target;
      if (!el || !el.tagName) return;
      const kind = kindOf(el);

      if (kind === "checkbox" || kind === "radio") {
        send({ type: "toggle", kind, label: labelFor(el), checked: !!el.checked, sel: selFor(el) });
        return;
      }
      if (kind === "select") {
        const opt = el.options?.[el.selectedIndex];
        send({ type: "select", label: labelFor(el), value: opt ? opt.text.trim() : el.value, sel: selFor(el) });
        return;
      }
      if (kind === "input" || kind === "textarea") {
        if (isSensitive(el)) {
          send({ type: "input", label: labelFor(el), value: null, sensitive: true, sel: selFor(el) });
          scanLoginFeatures();
        } else {
          send({ type: "input", label: labelFor(el), value: el.value, sel: selFor(el) });
        }
      }
    },
    true
  );

  // Enter-to-submit inside a text field
  document.addEventListener(
    "keydown",
    (e) => {
      if (!recording) return;
      if (e.key !== "Enter") return;
      const el = e.target;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) {
        send({ type: "key", label: labelFor(el), value: "Enter", sel: selFor(el) });
      }
    },
    true
  );

  // ---- navigation (incl. SPA route changes, e.g. Next.js) ----------------

  let lastUrl = location.href;
  function noteNav(reason) {
    if (!recording) return;
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    send({ type: "navigate", url: location.href, page: document.title || location.pathname, reason });
  }

  // Content scripts run in an isolated world, so patching history.pushState here
  // would never see the page's own calls. Use the Navigation API where present,
  // plus a light URL poll as a fallback for SPA route changes.
  if (IS_TOP) {
    try {
      if (window.navigation && window.navigation.addEventListener) {
        window.navigation.addEventListener("navigatesuccess", () => setTimeout(() => noteNav("spa"), 0));
      }
    } catch (e) { /* not supported */ }
    window.addEventListener("popstate", () => setTimeout(() => noteNav("popstate"), 0));
    window.addEventListener("hashchange", () => setTimeout(() => noteNav("hashchange"), 0));
    setInterval(() => { if (recording && !paused) noteNav("poll"); }, 700);
  }

  // ---- error / success message capture -----------------------------------

  const MSG_SEL = [
    '[role="alert"]', '[role="status"]', "[aria-live]",
    ".toast", ".alert", ".notification", ".snackbar", ".message", ".flash",
    ".invalid-feedback", ".error-message", ".success-message", ".help-block", ".field-error",
    '[class*="toast"]', '[class*="alert"]', '[class*="snackbar"]', '[class*="notification"]',
    '[class*="error"]', '[class*="success"]', '[class*="danger"]', '[class*="invalid"]',
  ].join(",");

  const seenMsgs = new Map();

  function classify(el, text) {
    const cls = (el.className && el.className.toString ? el.className.toString() : "") + " " + (el.getAttribute?.("role") || "");
    if (/success|approved|complete|created|updated|saved|confirm/i.test(cls)) return "success";
    if (/error|danger|invalid|fail|denied|warn/i.test(cls)) return "error";
    if (/success|successfully|approved|completed|created|updated|saved|logged in|welcome/i.test(text)) return "success";
    if (/error|invalid|failed|denied|required|incorrect|wrong|unable|cannot|not found|try again/i.test(text)) return "error";
    return "info";
  }

  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  }

  let msgsOn = true;

  function consider(el) {
    if (!recording || !msgsOn || !el || el.nodeType !== 1) return;
    const text = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
    if (!text || text.length > 200) return;
    if (!visible(el)) return;
    const now = Date.now();
    const last = seenMsgs.get(text);
    if (last && now - last < 4000) return;
    seenMsgs.set(text, now);
    send({ type: "message", level: classify(el, text), text });
  }

  let msgObserver = null;
  function startMessages() {
    if (msgObserver) return;
    msgObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          if (n.matches && n.matches(MSG_SEL)) consider(n);
          if (n.querySelectorAll) n.querySelectorAll(MSG_SEL).forEach(consider);
        });
        if (m.type === "characterData" || m.type === "childList") {
          const host = m.target.nodeType === 1 ? m.target : m.target.parentElement;
          if (host && host.closest) { const hit = host.closest(MSG_SEL); if (hit) consider(hit); }
        }
      }
    });
    msgObserver.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true });
    document.querySelectorAll(MSG_SEL).forEach(consider);
  }
  function stopMessages() {
    if (msgObserver) { msgObserver.disconnect(); msgObserver = null; }
    seenMsgs.clear();
  }

  // ---- recording state sync ---------------------------------------------

  chrome.storage.local.get(["recording", "captureMsgs", "paused"], ({ recording: r, captureMsgs, paused: p }) => {
    recording = !!r;
    paused = !!p;
    msgsOn = captureMsgs !== false;
    if (recording) {
      lastUrl = location.href;
      send({ type: "navigate", url: location.href, page: document.title || location.pathname, reason: "load" });
      startMessages();
      setTimeout(scanLoginFeatures, 800);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.captureMsgs) msgsOn = changes.captureMsgs.newValue !== false;
    if (changes.paused) paused = !!changes.paused.newValue;
    if (changes.recording) {
      const started = !recording && changes.recording.newValue;
      const stopped = recording && !changes.recording.newValue;
      recording = !!changes.recording.newValue;
      if (started) {
        lastUrl = location.href;
        send({ type: "navigate", url: location.href, page: document.title || location.pathname, reason: "start" });
        startMessages();
        setTimeout(scanLoginFeatures, 800);
      }
      if (stopped) stopMessages();
    }
  });
})();
