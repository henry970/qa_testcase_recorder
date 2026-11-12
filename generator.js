// generator.js
// Recorded events -> test cases. A single recorded POSITIVE flow can expand into
// field-validation cases (one per field, first) + the positive case + negative cases.
// Exposed on window.TCGen.

(function () {
  function shortPage(page, url) {
    if (page && page.trim()) return page.trim();
    try {
      const u = new URL(url);
      return u.pathname === "/" ? u.hostname : u.pathname;
    } catch {
      return url || "the page";
    }
  }

  const inputsOf = (evs) => evs.filter((e) => e.type === "input");
  const hasPassword = (evs) => evs.some((e) => e.type === "input" && e.sensitive);

  function primaryClick(evs) {
    const clicks = evs.filter((e) => e.type === "click");
    return clicks.length ? clicks[clicks.length - 1] : null;
  }

  // The action that drives the scenario — the real submit/login, not just the
  // last thing clicked (which on a multi-page flow is often a nav link).
  const SUBMIT_RE = /log\s?in|sign\s?in|log\s?on|submit|save|continue|next|create|confirm|apply|update|register|proceed|checkout|pay|send|search|add|approve|reject|delete/i;
  function primaryAction(evs) {
    const clicks = evs.map((e, i) => ({ e, i })).filter((x) => x.e.type === "click");
    if (!clicks.length) return null;
    if (hasPassword(evs)) {
      const pwIdx = evs.map((e, i) => ({ e, i })).filter((x) => x.e.type === "input" && x.e.sensitive).map((x) => x.i).pop();
      const after = clicks.filter((x) => x.i > pwIdx);
      const submit = after.find((x) => SUBMIT_RE.test(x.e.label)) || after[0] || clicks.find((x) => SUBMIT_RE.test(x.e.label));
      if (submit) return submit.e;
    }
    const submitLike = [...clicks].reverse().find((x) => SUBMIT_RE.test(x.e.label));
    return submitLike ? submitLike.e : clicks[clicks.length - 1].e;
  }
  function firstPage(evs) {
    const n = evs.find((e) => e.type === "navigate");
    return n ? shortPage(n.page, n.url) : "the page";
  }
  function landedPage(evs) {
    const navs = evs.filter((e) => e.type === "navigate");
    return navs.length > 1 ? shortPage(navs[navs.length - 1].page, navs[navs.length - 1].url) : null;
  }

  // A readable page name. Many apps reuse one <title> across pages (e.g. SauceDemo
  // is always "Swag Labs"), so prefer a name derived from the URL path.
  function pageLabel(nav) {
    try {
      const u = new URL(nav.url || "");
      let seg = u.pathname.split("/").filter(Boolean).pop() || "";
      seg = seg.replace(/\.(html?|php|aspx?|jsp)$/i, "").replace(/[-_]+/g, " ").trim();
      if (seg && !/^\d+$/.test(seg)) return seg.replace(/\b\w/g, (c) => c.toUpperCase());
    } catch (e) { /* ignore */ }
    return shortPage(nav.page, nav.url);
  }

  // Split the recording into per-page segments (a new segment per navigation to a
  // different URL). Fields/clicks belong to the page they happened on.
  function pageSegments(evs) {
    const segs = [];
    let cur = null;
    for (const ev of evs) {
      if (ev.type === "navigate") {
        if (cur && cur.url === ev.url) continue;
        cur = { page: pageLabel(ev), url: ev.url, inputs: [], clicks: [], messages: [], hasPw: false };
        segs.push(cur);
      } else if (ev.type === "input") {
        if (!cur) { cur = { page: firstPage(evs), url: "", inputs: [], clicks: [], messages: [], hasPw: false }; segs.push(cur); }
        cur.inputs.push(ev); if (ev.sensitive) cur.hasPw = true;
      } else if (ev.type === "click" && cur) {
        cur.clicks.push(ev);
      } else if (ev.type === "message" && cur) {
        cur.messages.push(ev);
      }
    }
    return segs;
  }

  // An error message shown while still on the first page (a real failed-login
  // error), not one captured later in the journey (e.g. a checkout error).
  function errorBeforeNav(evs) {
    let navs = 0;
    for (const ev of evs) {
      if (ev.type === "navigate") { navs++; if (navs >= 2) break; }
      if (ev.type === "message" && ev.level === "error" && navs <= 1) return ev.text;
    }
    return null;
  }

  // Steps for just the login portion (through the first navigation after the
  // login button), so a login positive case doesn't list the whole journey.
  function loginSteps(evs) {
    const submit = primaryAction(evs);
    if (!submit) return buildSteps(evs);
    const si = evs.indexOf(submit);
    if (si < 0) return buildSteps(evs);
    let end = evs.length;
    for (let i = si + 1; i < evs.length; i++) { if (evs[i].type === "navigate") { end = i + 1; break; } }
    return buildSteps(evs.slice(0, end));
  }

  const isEmailField = (ev) => /e-?mail/i.test(ev.label || "") || (ev.value && /@/.test(String(ev.value)));
  const isNumberField = (ev) => /amount|number|phone|qty|quantity|price|balance|account/i.test(ev.label || "");

  // ---- module / feature naming -------------------------------------------
  function moduleFromLabel(s) {
    s = (s || "").toLowerCase();
    if (/log\s?out|sign\s?out/.test(s)) return "Logout";
    if (/log\s?in|sign\s?in/.test(s)) return "Login";
    if (/add to cart|remove|cart|basket|bag/.test(s)) return "Cart";
    if (/checkout|continue|place order|payment|\bpay\b/.test(s)) return "Checkout";
    if (/register|sign\s?up|create account/.test(s)) return "Registration";
    if (/search|filter/.test(s)) return "Search";
    if (/transfer|transaction|deposit|withdraw|send money/.test(s)) return "Transactions";
    if (/profile|account|settings/.test(s)) return "Account";
    return null;
  }
  function moduleFromPage(p) {
    const low = (p || "").toLowerCase();
    if (/checkout/.test(low)) return "Checkout";
    if (/cart|basket/.test(low)) return "Cart";
    if (/inventory|products?|catalog|shop|store/.test(low)) return "Products";
    if (/login|sign\s?in/.test(low)) return "Login";
    if (/dashboard|home/.test(low)) return "Dashboard";
    if (/transaction|transfer|payment/.test(low)) return "Transactions";
    const clean = (p || "").replace(/\bstep\s*(one|two|three|four|\d+)\b/gi, "").replace(/\s+/g, " ").trim();
    return clean || "General";
  }

  // ---- individual step text (for the positive case) ----------------------
  function frameSuffix(ev) {
    if (!ev.frame) return "";
    const f = ev.frame;
    let n = f.title || f.name || "";
    if (!n) { try { n = new URL(f.url).hostname; } catch (e) { n = "embedded"; } }
    return ` (inside the "${n}" frame)`;
  }
  function stepText(ev) {
    const t = stepTextBase(ev);
    const fs = frameSuffix(ev);
    return fs ? t.replace(/\.$/, fs + ".") : t;
  }
  function stepTextBase(ev) {
    switch (ev.type) {
      case "newtab": return "Switch to the new tab that opens.";
      case "navigate": return `Open ${shortPage(ev.page, ev.url)}.`;
      case "click": {
        const noun = ev.kind === "link" ? "link" : ev.kind === "button" ? "button" : ev.kind || "element";
        return `Click the "${ev.label}" ${noun}.`;
      }
      case "input":
        if (ev.sensitive || ev.value == null) return `Enter a valid ${ev.label} in the "${ev.label}" field.`;
        return `Enter "${ev.value}" into the "${ev.label}" field.`;
      case "select": return `Select "${ev.value}" from the "${ev.label}" dropdown.`;
      case "toggle": return `${ev.checked ? "Check" : "Uncheck"} the "${ev.label}" ${ev.kind}.`;
      case "key": return `Press ${ev.value} in the "${ev.label}" field.`;
      default: return `${ev.type} ${ev.label || ""}`.trim();
    }
  }

  function buildSteps(evs) {
    const steps = [];
    let lastNav = null;
    let curTab = null;
    const seenTabs = new Set();
    let lastType = null; // previous real event type (markers ignored)
    for (const ev of evs) {
      if (ev.type === "message" || ev.type === "feature") continue; // markers, not steps
      if (ev.type === "newtab") {
        seenTabs.add(ev.tabId); curTab = ev.tabId; lastNav = null;
        steps.push(stepText(ev));
        lastType = ev.type;
        continue;
      }
      const prevType = lastType;
      lastType = ev.type;
      if (ev.tabId != null) {
        if (curTab == null) { curTab = ev.tabId; seenTabs.add(ev.tabId); }
        else if (ev.tabId !== curTab && seenTabs.has(ev.tabId)) {
          curTab = ev.tabId; lastNav = null;
          steps.push("Switch back to the previous tab.");
        }
      }
      if (ev.type === "navigate") {
        const p = shortPage(ev.page, ev.url);
        if (p === lastNav) continue;
        lastNav = p;
        // a page that opened because of a click is a check, not an action
        if (steps.length && (prevType === "click" || prevType === "key" || prevType === "newtab")) {
          steps.push(`Verify the ${p} page opens.`);
          continue;
        }
      }
      const t = stepText(ev);
      if (steps.length && steps[steps.length - 1] === t) continue;
      steps.push(t);
    }
    return steps;
  }

  const successMsg = (evs) => { const m = evs.filter((e) => e.type === "message" && e.level === "success").pop(); return m ? m.text : null; };
  const errorMsg = (evs) => { const m = evs.filter((e) => e.type === "message" && e.level === "error").pop(); return m ? m.text : null; };

  // The verb the scenarios read around, e.g. "login", "save", "submission".
  function actionNoun(evs) {
    const p = primaryAction(evs);
    if (hasPassword(evs) && p && /log|sign/i.test(p.label || "")) return "login";
    if (p && p.label) return p.label.toLowerCase();
    return "submission";
  }

  // ---- POSITIVE case -----------------------------------------------------
  function positiveCase(evs) {
    const where = firstPage(evs);
    const primary = primaryAction(evs);
    const login = hasPassword(evs) && primary && /log|sign/i.test(primary.label);
    // for login, judge by what happened right after the login click — not by
    // wherever the rest of the recorded journey ended up
    let landed = landedPage(evs);
    let ok = successMsg(evs);
    if (login) {
      const after = evs.slice(evs.indexOf(primary) + 1);
      const nav = after.find((e) => e.type === "navigate");
      landed = nav ? pageLabel(nav) : null;
      const until = nav ? after.slice(0, after.indexOf(nav) + 3) : after; // messages around the redirect
      const m = until.find((e) => e.type === "message" && e.level === "success");
      ok = m ? m.text : null;
    }
    // Avoid "the Login login" when the page itself is named Login/Sign in.
    const place = /login|sign ?in|log ?on/i.test(where) ? "" : `the ${where} `;

    let scenario, expected;
    if (login) {
      scenario = `Validate ${place}login with valid credentials.`;
      expected = landed ? `User is successfully logged in and lands on ${landed}.` : "User is successfully logged in.";
    } else if (primary) {
      scenario = `Validate ${actionNoun(evs)} with valid input.`;
      expected = landed
        ? `The action completes successfully and ${landed} is displayed.`
        : `The action completes successfully with the expected result.`;
    } else {
      scenario = `Validate the flow on ${where}.`;
      expected = "The flow completes successfully with the expected result.";
    }
    if (ok) expected = `A success message "${ok}" is displayed${landed ? ` and ${landed} loads` : ""}.`;
    const mod = login ? "Login" : (moduleFromLabel(primary && primary.label) || moduleFromPage(firstPage(evs)) || "Main Flow");
    return { module: mod, scenario, steps: login ? loginSteps(evs) : buildSteps(evs), expected, priority: login ? "Critical" : "High", kind: "positive", pass: !!ok };
  }

  // ---- field helpers -------------------------------------------------------
  const fieldKey = (f) => (f.label || "field").toLowerCase();
  // one entry per field (the last value typed wins)
  function uniqueInputs(inputs) {
    const m = new Map();
    inputs.forEach((f) => { m.delete(fieldKey(f)); m.set(fieldKey(f), f); });
    return [...m.values()];
  }
  const rulesOf = (f) => (f.sel && f.sel.rules) || {};
  function fieldType(f) {
    const t = ((f.sel && f.sel.type) || "").toLowerCase();
    const mode = (rulesOf(f).inputMode || "").toLowerCase();
    if (f.sensitive || t === "password") return "password";
    if (t === "email" || isEmailField(f)) return "email";
    if (t === "tel" || /phone|mobile|\btel\b/i.test(f.label || "")) return "phone";
    if (t === "url" || /\burl\b|website/i.test(f.label || "")) return "url";
    if (/^(date|datetime-local|month|week|time)$/.test(t)) return "date";
    if (t === "number" || mode === "numeric" || mode === "decimal" || isNumberField(f)) return "number";
    if ((f.sel && f.sel.tag) === "select") return "select";
    return "text";
  }
  const isAmount = (f) => /amount|price|qty|quantity|balance|total|cost|fee/i.test(f.label || "");
  const recordedValue = (f) => (f.sensitive || f.value == null || f.value === "" ? `<valid ${f.label || "value"}>` : f.value);
  const normT = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

  // Steps that re-enter the recorded form, changing only the field under test.
  function formSteps(seg, target, how, submitLabel) {
    const steps = [`Open ${seg.page}.`];
    uniqueInputs(seg.inputs).forEach((f) => {
      if (target && fieldKey(f) === fieldKey(target)) {
        if (how.empty) steps.push(`Leave the "${f.label}" field empty.`);
        else if (how.step) steps.push(how.step);
        else steps.push(`Enter "${how.value}" into the "${f.label}" field.`);
      } else {
        steps.push(stepText(f));
      }
    });
    steps.push(`Click the "${submitLabel}" button.`);
    return steps;
  }
  // Test data block: one "Field: value" line per field.
  function formData(seg, target, override) {
    return uniqueInputs(seg.inputs)
      .map((f) => `${f.label}: ${target && fieldKey(f) === fieldKey(target) ? override : recordedValue(f)}`)
      .join("\n");
  }
  // Expected result for a blocked submit — quote the real error when one was seen.
  // A message counts as this field's own validation text only if it names this
  // field and no other one (so "Invalid email or password" — a login failure —
  // is never quoted as the Email field's validation message).
  const REQUIRED_WORDS = /required|empty|missing|blank|enter|provide|cannot be/i;
  const FORMAT_WORDS = /invalid|format|valid|must|at least|at most|characters|only|digits|numbers/i;
  function blocked(seg, f, fallback, kind) {
    const label = normT(f && f.label);
    const others = uniqueInputs(seg.inputs).map((x) => normT(x.label)).filter((l) => l && l !== label);
    const words = kind === "required" ? REQUIRED_WORDS : FORMAT_WORDS;
    const seen = seg.messages.find((m) => {
      const t = normT(m.text);
      return m.level === "error" && label && t.includes(label) && !others.some((o) => t.includes(o)) && words.test(m.text);
    });
    const stay = ` The form is not submitted and the user stays on ${seg.page}.`;
    return (seen ? `The error "${seen.text}" is displayed.` : fallback) + stay;
  }

  // ---- FIELD-VALIDATION cases (scoped per page/feature) ------------------
  function fieldCases(evs) {
    const cases = [];
    pageSegments(evs).forEach((seg) => {
      if (!seg.inputs.length) return;
      const action = seg.hasPw ? "login" : `the ${seg.page} form`;
      const mod = seg.hasPw ? "Login" : moduleFromPage(seg.page);
      const submit = seg.clicks.find((c) => SUBMIT_RE.test(c.label || "")) || seg.clicks[seg.clicks.length - 1];
      const submitLabel = submit ? submit.label : "Submit";
      const fields = uniqueInputs(seg.inputs);
      const add = (f, scenario, how, data, expected, priority) => cases.push({
        scenario, module: mod, kind: "field", priority: priority || "High",
        steps: formSteps(seg, f, how, submitLabel),
        data: formData(seg, f, data),
        expected,
      });

      fields.forEach((f) => {
        const L = (f.label || "field").toLowerCase();
        const type = fieldType(f);
        const rules = rulesOf(f);

        add(f, `Validate ${action} with an empty ${L} field.`, { empty: true }, "(empty)",
          blocked(seg, f, `A message says the ${f.label} field is required.`, "required"));

        if (type === "text") {
          add(f, `Validate ${action} with only spaces in the ${L} field.`, { value: "   " }, `"   " (3 spaces)`,
            blocked(seg, f, `Spaces alone are not accepted; the ${f.label} field is treated as empty and a required message is shown.`, "required"), "Medium");
        }
        if (type === "email") {
          add(f, `Validate ${action} with an invalid ${L} format.`, { value: "user@@domain" },
            `user@@domain (also try: user.domain.com, user@domain, @domain.com)`,
            blocked(seg, f, `A message says the ${f.label} format is invalid.`));
        } else if (type === "number") {
          add(f, `Validate ${action} with a non-numeric ${L}.`, { value: "abc" }, "abc",
            blocked(seg, f, `The ${f.label} field rejects letters, or a message says only numbers are allowed.`));
          if (isAmount(f) && rules.min == null) {
            add(f, `Validate ${action} with a negative ${L}.`, { value: "-1" }, "-1",
              blocked(seg, f, `A message says the ${f.label} must be greater than zero.`));
          }
        } else if (type === "phone") {
          add(f, `Validate ${action} with letters in the ${L} field.`, { value: "080abc1234" }, "080abc1234",
            blocked(seg, f, `A message says the ${f.label} must contain only digits.`), "Medium");
        } else if (type === "url") {
          add(f, `Validate ${action} with an invalid ${L}.`, { value: "not a url" }, "not a url",
            blocked(seg, f, `A message says the ${f.label} must be a valid URL.`), "Medium");
        }

        // boundary values from the field's own rules
        if (rules.maxLength) {
          const n = rules.maxLength;
          cases.push({
            scenario: `Validate the ${L} field accepts at most ${n} characters.`, module: mod, kind: "field", priority: "Medium",
            steps: [`Open ${seg.page}.`, `Enter exactly ${n} characters into the "${f.label}" field.`, `Try to type one more character (${n + 1} in total).`],
            data: `${n} characters, then ${n + 1} characters`,
            expected: `All ${n} characters are accepted. Character number ${n + 1} is blocked, or a message says the maximum is ${n} characters.`,
          });
        }
        if (rules.minLength) {
          const n = rules.minLength;
          add(f, `Validate ${action} with a ${L} shorter than ${n} characters.`, { value: "a".repeat(Math.max(1, n - 1)) },
            `${Math.max(1, n - 1)} characters`, blocked(seg, f, `A message says the ${f.label} must be at least ${n} characters.`));
        }
        if (rules.min != null && !isNaN(Number(rules.min))) {
          const below = String(Number(rules.min) - 1);
          add(f, `Validate ${action} with a ${L} below the minimum (${rules.min}).`, { value: below }, below,
            blocked(seg, f, `A message says the ${f.label} must be at least ${rules.min}.`));
        }
        if (rules.max != null && !isNaN(Number(rules.max))) {
          const above = String(Number(rules.max) + 1);
          add(f, `Validate ${action} with a ${L} above the maximum (${rules.max}).`, { value: above }, above,
            blocked(seg, f, `A message says the ${f.label} must be at most ${rules.max}.`));
        }
        if (rules.pattern && type !== "email") {
          add(f, `Validate ${action} with a ${L} in the wrong format.`, { value: "!!invalid!!" }, `!!invalid!! (required pattern: ${rules.pattern})`,
            blocked(seg, f, `A message explains the required ${f.label} format.`), "Medium");
        }
      });

      if (fields.length === 2) {
        const a = fieldKey(fields[0]), b = fieldKey(fields[1]);
        cases.push({
          scenario: `Validate ${action} with both ${a} and ${b} empty.`,
          steps: [`Open ${seg.page}.`, `Leave both the "${fields[0].label}" and "${fields[1].label}" fields empty.`, `Click the "${submitLabel}" button.`],
          data: fields.map((f) => `${f.label}: (empty)`).join("\n"),
          module: mod,
          expected: `Required messages are shown for both fields. The form is not submitted and the user stays on ${seg.page}.`,
          priority: "High",
          kind: "field",
        });
      } else if (fields.length > 2) {
        cases.push({
          scenario: `Validate ${action} with all fields empty.`,
          steps: [`Open ${seg.page}.`, `Leave all fields empty.`, `Click the "${submitLabel}" button.`],
          data: "All fields: (empty)",
          module: mod,
          expected: `Required messages are shown for every required field. The form is not submitted and the user stays on ${seg.page}.`,
          priority: "High",
          kind: "field",
        });
      }
    });
    return cases;
  }

  // ---- LOGIN-FEATURE checks (only for elements actually on the page) -----
  function loginFeatureCases(evs) {
    if (!hasPassword(evs)) return [];
    const page = firstPage(evs);
    const feats = new Set(evs.filter((e) => e.type === "feature").map((e) => e.feature));
    const seen = (re) => evs.some((e) => re.test(e.label || "") || re.test(e.text || ""));
    const cases = [];

    // A password field was genuinely recorded, so masking is a real, observable check.
    cases.push({
      scenario: `Validate password masking on the login page.`,
      steps: [`Open ${page}.`, `Type a value into the password field.`],
      expected: `The password characters are masked (shown as dots/asterisks).`,
      module: "Login", priority: "Medium", kind: "feature",
    });

    if (feats.has("showhide") || seen(/show\s*password|hide\s*password|reveal\s*password|toggle\s*password/i)) {
      cases.push({
        scenario: `Validate the Show/Hide Password functionality.`,
        steps: [`Open ${page}.`, `Enter a password.`, `Click the show/hide (eye) icon.`],
        expected: `The password toggles between masked and visible.`,
        module: "Login", priority: "Low", kind: "feature",
      });
    }
    if (feats.has("remember") || seen(/remember\s*me/i)) {
      cases.push({
        scenario: `Validate the "Remember Me" functionality.`,
        steps: [`Open ${page}.`, `Tick "Remember Me" and log in.`, `Close and reopen the browser/app.`],
        expected: `The session/username is remembered as expected.`,
        module: "Login", priority: "Medium", kind: "feature",
      });
    }
    if (feats.has("forgot") || seen(/forgot\s*password|reset\s*password/i)) {
      cases.push({
        scenario: `Validate the "Forgot Password" functionality.`,
        steps: [`Open ${page}.`, `Click "Forgot Password".`, `Follow the reset flow.`],
        expected: `The password reset flow opens and works as expected.`,
        module: "Login", priority: "Medium", kind: "feature",
      });
    }
    return cases;
  }

  // ---- FLOW-validation cases (page loads / end-to-end) -------------------
  function navPages(evs) {
    const out = [];
    evs.filter((e) => e.type === "navigate").forEach((e) => {
      const p = shortPage(e.page, e.url);
      if (!out.length || out[out.length - 1] !== p) out.push(p);
    });
    return out;
  }
  function flowCases(evs) {
    const pages = navPages(evs);
    const ok = !!successMsg(evs);
    const cases = [];
    for (let i = 1; i < pages.length; i++) {
      cases.push({
        scenario: `Validate the ${pages[i]} page loads successfully.`,
        steps: [`Complete the flow up to the ${pages[i]} page.`, `Confirm the ${pages[i]} page has loaded.`],
        expected: `The ${pages[i]} page loads successfully without errors.`,
        priority: i === 1 ? "Critical" : "High",
        module: "End-to-End",
        kind: "flow",
        pass: ok,
      });
    }
    if (pages.length >= 3) {
      const okMsg = successMsg(evs);
      cases.push({
        scenario: `Validate the end-to-end flow from ${pages[0]} to ${pages[pages.length - 1]}.`,
        steps: buildSteps(evs),
        expected: okMsg
          ? `The flow completes, "${okMsg}" is shown, and ${pages[pages.length - 1]} is reached.`
          : `The full flow completes successfully and the ${pages[pages.length - 1]} page is reached.`,
        priority: "Critical",
        module: "End-to-End",
        kind: "flow",
        pass: !!okMsg,
      });
    }
    return cases;
  }

  // ---- NEGATIVE flow case ------------------------------------------------
  const INVALID_SAMPLE = { email: "user@@domain", number: "abc", phone: "080abc1234", url: "not a url", date: "31/02/2020" };

  function negativeCases(evs) {
    const page = firstPage(evs);
    const submit = primaryAction(evs);
    const err = errorBeforeNav(evs); // only an error shown on the login page itself
    if (!submit) return [];
    const seg = pageSegments(evs).find((s) => s.inputs.length) || { page, inputs: [], messages: [] };
    const fields = uniqueInputs(seg.inputs);

    if (hasPassword(evs) && /log|sign/i.test(submit.label)) {
      const user = fields.find((f) => !f.sensitive);
      const pw = fields.find((f) => f.sensitive);
      const uLabel = user ? user.label : "Username";
      const pLabel = pw ? pw.label : "Password";
      const uLow = uLabel.toLowerCase();
      const isMail = user ? fieldType(user) === "email" : false;
      const known = user && user.value ? user.value : `<registered ${uLabel}>`;
      const unknown = isMail ? "not.registered.user@example.com" : "unregistered_user_9431";
      const denied = err
        ? `The error "${err}" is displayed, login is denied, and the user stays on ${page}.`
        : `Login is denied, an error message is shown, and the user stays on ${page}.`;
      const safe = " The message does not reveal which of the two values was wrong.";
      return [
        {
          module: "Login", kind: "negative", priority: "Critical",
          scenario: `Validate login with a valid ${uLow} and an incorrect password.`,
          steps: [`Open ${page}.`, `Enter "${known}" into the "${uLabel}" field.`, `Enter an incorrect password into the "${pLabel}" field.`, `Click the "${submit.label}" button.`],
          data: `${uLabel}: ${known}\n${pLabel}: WrongPass!123`,
          expected: denied + safe,
        },
        {
          module: "Login", kind: "negative", priority: "High",
          scenario: `Validate login with an unregistered ${uLow}.`,
          steps: [`Open ${page}.`, `Enter "${unknown}" into the "${uLabel}" field.`, `Enter any password into the "${pLabel}" field.`, `Click the "${submit.label}" button.`],
          data: `${uLabel}: ${unknown}\n${pLabel}: AnyPass!123`,
          expected: denied + safe,
        },
      ];
    }

    // other forms: put an invalid value into every typed field, keep the rest valid
    const typed = fields.filter((f) => INVALID_SAMPLE[fieldType(f)]);
    const steps = [`Open ${seg.page || page}.`];
    if (typed.length) {
      fields.forEach((f) => {
        const bad = INVALID_SAMPLE[fieldType(f)];
        steps.push(bad ? `Enter "${bad}" into the "${f.label}" field.` : stepText(f));
      });
    } else {
      steps.push(fields.length ? `Leave the "${fields[0].label}" field empty and fill the rest with the recorded values.` : "Enter invalid data in the fields.");
    }
    steps.push(`Click the "${submit.label}" button.`);
    return [{
      module: moduleFromLabel(submit.label) || "General",
      scenario: `Validate "${submit.label}" is rejected with invalid input.`,
      steps,
      data: fields.map((f) => `${f.label}: ${INVALID_SAMPLE[fieldType(f)] || (typed.length || f !== fields[0] ? recordedValue(f) : "(empty)")}`).join("\n"),
      expected: (err ? `The error "${err}" is displayed and the action is blocked.` : `Error messages point to the invalid fields and the action is blocked.`) +
        ` No data is saved and the user stays on ${seg.page || page}.`,
      priority: "High",
      kind: "negative",
    }];
  }

  // ---- suite -------------------------------------------------------------
  // ---- PER-ELEMENT cases (one per button / link / checkbox / menu) -------
  function elementCases(evs) {
    const page = firstPage(evs);
    const submit = primaryAction(evs);
    const submitLabel = submit ? submit.label : null;
    const seen = new Set();
    const login = hasPassword(evs);
    const covered = /remember|forgot\s*password|reset\s*password|show\s*password|hide\s*password/i;
    const out = [];
    let curPage = page;
    // What the recorder saw right after an action: a new page, a new tab, or a message.
    const ACTIONS = ["click", "input", "select", "toggle", "key"];
    const outcomeAfter = (i) => {
      for (let j = i + 1; j < evs.length; j++) {
        const e = evs[j];
        if (ACTIONS.includes(e.type)) break;
        if (e.type === "newtab") return { newtab: true };
        if (e.type === "navigate" && pageLabel(e) !== curPage) return { page: pageLabel(e) };
        if (e.type === "message") return { msg: e.text, level: e.level };
      }
      return null;
    };
    const describe = (o) => (o.newtab ? "a new tab opens" : o.page ? `the ${o.page} page opens` : `the message "${o.msg}" is displayed`);
    evs.forEach((ev, i) => {
      if (ev.type === "navigate") { curPage = pageLabel(ev); return; }
      const label = (ev.label || "").trim();
      if (!label) return;
      if (login && covered.test(label)) return; // richer login-feature case already covers it
      let key, scenario, steps, expected;
      if (ev.type === "click") {
        if (submitLabel && label === submitLabel) return; // covered by the positive case
        const t = (ev.sel && ev.sel.tag) || "";
        const ty = ((ev.sel && ev.sel.type) || "").toLowerCase();
        const textField = t === "textarea" || t === "select" || (t === "input" && !["button", "submit", "reset", "image"].includes(ty));
        if (textField) return;                                   // a text field, not a button
        if (/^\d+$/.test(label) || label.length < 2) return;     // junk label (e.g. a count badge)
        const kind = ev.kind === "link" ? "link" : "button";
        key = `click:${kind}:${label.toLowerCase()}`;
        scenario = `Validate the "${label}" ${kind}.`;
        steps = [`Open ${curPage}.`, `Click the "${label}" ${kind}.`];
        const o = outcomeAfter(i);
        expected = o
          ? `After clicking "${label}", ${describe(o)}.`
          : `The "${label}" ${kind} is visible and enabled, and clicking it performs its action without errors.`;
      } else if (ev.type === "toggle") {
        key = `toggle:${label.toLowerCase()}`;
        scenario = `Validate the "${label}" checkbox.`;
        steps = [`Open ${curPage}.`, `Click the "${label}" checkbox.`, `Click it again.`];
        expected = `The first click ${ev.checked ? "checks" : "unchecks"} "${label}" and the second click reverses it. The setting is applied when the form is used.`;
      } else if (ev.type === "select") {
        key = `select:${label.toLowerCase()}`;
        scenario = `Validate the "${label}" dropdown.`;
        steps = [`Open ${curPage}.`, `Open the "${label}" dropdown.`, `Select "${ev.value}".`];
        const o = outcomeAfter(i);
        expected = `The "${label}" dropdown lists its options and shows "${ev.value}" as selected` + (o ? `; ${describe(o)}.` : ".");
      } else {
        return;
      }
      if (seen.has(key)) return;
      seen.add(key);
      const mod = moduleFromLabel(label) || (login && curPage === page ? "Login" : moduleFromPage(curPage));
      out.push({ module: mod, scenario, steps, expected, priority: "Medium", kind: "element" });
    });
    return out;
  }

  function dedupeCases(cases) {
    const seen = new Set();
    const out = [];
    for (const c of cases) {
      const k = String(c.scenario || "").toLowerCase().replace(/\s+/g, " ").trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
    return out;
  }

  // ---- preconditions / test data / type for every case --------------------
  const TYPE_OF = {
    positive: "Positive", negative: "Negative", field: "Validation", feature: "Functional",
    element: "Functional (UI)", flow: "End-to-end", ai: "AI suggested",
  };
  function enrich(cases, evs) {
    const first = evs.find((e) => e.type === "navigate");
    let origin = "";
    try { origin = first ? new URL(first.url).origin : ""; } catch (e) { origin = ""; }
    const login = hasPassword(evs);
    const segs = pageSegments(evs);
    const loginSeg = segs.find((s) => s.hasPw);
    const reach = origin ? `The application is reachable at ${origin}.` : "The application under test is reachable.";
    const allData = uniqueInputs(evs.filter((e) => e.type === "input"))
      .map((f) => `${f.label}: ${recordedValue(f)}`).join("\n");

    cases.forEach((c) => {
      c.type = c.type || TYPE_OF[c.kind] || "Functional";
      c.priority = c.priority || "Medium";
      if (!c.preconditions) {
        const pre = [reach];
        if (login && c.module === "Login") pre.push(c.kind === "negative" ? "A registered, active user account exists." : "A registered, active user account is available.", "The user is logged out.");
        else if (login) pre.push("The user is logged in with a valid account.");
        if (c.kind === "positive" && !login && allData) pre.push("The test data below is valid for this environment.");
        c.preconditions = pre.join("\n");
      }
      if (c.data == null) {
        if (c.kind === "positive") c.data = login && loginSeg ? formData(loginSeg, null) : allData;
        else c.data = "";
      }
    });
    return cases;
  }

  function generateSuite(events, opts = {}) {
    const evs = (events || []).filter(Boolean);
    const { fieldValidation = true, flowValidation = true, negatives = true, elements = true } = opts;
    const cases = [];
    cases.push(positiveCase(evs));                          // valid
    if (negatives) cases.push(...negativeCases(evs));       // wrong password / unknown user / invalid input
    if (fieldValidation) {
      cases.push(...fieldCases(evs));                       // empty / invalid format / both empty
      cases.push(...loginFeatureCases(evs));                // masking, show-hide, remember me, forgot password
    }
    if (elements) cases.push(...elementCases(evs));          // one case per button / menu / checkbox
    if (flowValidation) cases.push(...flowCases(evs));      // page loads / end-to-end
    return enrich(dedupeCases(cases), evs);                 // never emit duplicate scenarios
  }

  // backward-compatible single positive case
  function generate(events) {
    const c = positiveCase((events || []).filter(Boolean));
    return { scenario: c.scenario, steps: c.steps, expectedResult: c.expected };
  }


  // ---- code generation (Playwright / Cypress) ----------------------------
  function q(v) { return JSON.stringify(String(v == null ? "" : v)); }
  function qcss(v) { return "'" + String(v == null ? "" : v).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'"; }
  function attrSel(attr, val) { return `[${attr}=${JSON.stringify(String(val))}]`; }
  function roleFromSel(sel) {
    if (!sel) return null;
    if (sel.role) return sel.role;
    if (sel.tag === "a") return "link";
    if (sel.tag === "button" || sel.type === "submit" || sel.type === "button") return "button";
    if (sel.type === "checkbox") return "checkbox";
    if (sel.type === "radio") return "radio";
    return null;
  }
  function testTitle(evs) { return (positiveCase(evs).scenario || "recorded flow").replace(/\.$/, ""); }

  // CSS selector for the <iframe> an event happened in.
  function frameSelector(f) {
    if (!f) return "iframe";
    if (f.name) return "iframe" + attrSel("name", f.name);
    if (f.src) return "iframe" + attrSel("src", f.src);
    if (f.title) return "iframe" + attrSel("title", f.title);
    try { const u = new URL(f.url); return `iframe[src*=${JSON.stringify(u.host + u.pathname)}]`; } catch (e) { return "iframe"; }
  }
  // Which recorded click / Enter opened each new tab: action index -> newtab event.
  function tabOpeners(evs) {
    const map = new Map();
    evs.forEach((e, i) => {
      if (e.type !== "newtab") return;
      for (let j = i - 1; j >= 0; j--) {
        const t = evs[j].type;
        if (t === "click" || t === "key") { map.set(j, e); break; }
        if (t !== "message" && t !== "feature" && t !== "navigate") break;
      }
    });
    return map;
  }

  function pwLoc(ev, root) {
    const loc = pwLocBase(ev);
    return root && root !== "page" ? loc.replace(/^page\./, root + ".") : loc;
  }
  function pwLocBase(ev) {
    const sel = ev.sel || {};
    if (sel.testid) return `page.getByTestId(${q(sel.testid)})`;
    const isField = sel.tag === "input" || sel.tag === "textarea" || sel.tag === "select";
    if (isField) {
      if (ev.label) return `page.getByLabel(${q(ev.label)})`;
      if (sel.placeholder) return `page.getByPlaceholder(${q(sel.placeholder)})`;
      if (sel.id) return `page.locator(${qcss("#" + sel.id)})`;
      if (sel.name) return `page.locator(${qcss(attrSel("name", sel.name))})`;
    }
    const role = roleFromSel(sel), name = sel.ariaLabel || sel.text || ev.label;
    if (role && name) return `page.getByRole(${q(role)}, { name: ${q(name)} })`;
    if (sel.id) return `page.locator(${qcss("#" + sel.id)})`;
    if (sel.name) return `page.locator(${qcss(attrSel("name", sel.name))})`;
    if (name) return `page.getByText(${q(name)})`;
    return `page.locator(${qcss(sel.tag || "*")})`;
  }
  function buildPlaywright(events) {
    const evs = (events || []).filter(Boolean);
    const first = evs.find((e) => e.type === "navigate");
    const openers = tabOpeners(evs);
    const L = ["import { test, expect } from '@playwright/test';", "", `test(${q(testTitle(evs))}, async ({ ${openers.size ? "page, context" : "page"} }) => {`];
    if (first) L.push(`  await page.goto(${q(first.url)});`);

    const pageVar = new Map(); // recorded tabId -> variable name
    const firstTab = (evs.find((e) => e.tabId != null) || {}).tabId;
    if (firstTab != null) pageVar.set(firstTab, "page");
    let cur = "page", nextN = 2;
    const rootFor = (ev) => (ev.frame ? `${cur}.frameLocator(${qcss(frameSelector(ev.frame))})` : cur);

    evs.forEach((ev, i) => {
      if (ev.type !== "newtab" && ev.tabId != null && pageVar.has(ev.tabId) && pageVar.get(ev.tabId) !== cur) {
        cur = pageVar.get(ev.tabId);
        L.push(`  await ${cur}.bringToFront();`);
      }
      const opened = openers.get(i);
      let newVar = null;
      if (opened) {
        newVar = "page" + nextN++;
        pageVar.set(opened.tabId, newVar);
        L.push(`  const ${newVar}Promise = context.waitForEvent('page');`);
      }
      const R = rootFor(ev);
      switch (ev.type) {
        case "navigate": if (ev !== first) L.push(`  // \u2192 ${shortPage(ev.page, ev.url)}`); break;
        case "input": L.push(`  await ${pwLoc(ev, R)}.fill(${ev.sensitive ? "process.env.TEST_PASSWORD ?? 'REPLACE_ME'" : q(ev.value)});`); break;
        case "select": L.push(`  await ${pwLoc(ev, R)}.selectOption({ label: ${q(ev.value)} });`); break;
        case "toggle": L.push(`  await ${pwLoc(ev, R)}.${ev.checked ? "check" : "uncheck"}();`); break;
        case "click": L.push(`  await ${pwLoc(ev, R)}.click();`); break;
        case "key": if (ev.value === "Enter") L.push(`  await ${pwLoc(ev, R)}.press('Enter');`); break;
        case "message": L.push(`  await expect(${R}.getByText(${q(ev.text)})).toBeVisible();`); break;
      }
      if (newVar) {
        L.push(`  const ${newVar} = await ${newVar}Promise;`, `  await ${newVar}.waitForLoadState();`);
        cur = newVar;
      }
    });
    L.push("});", "");
    return L.join("\n");
  }

  function cyLoc(ev) {
    const sel = ev.sel || {};
    if (sel.testid) return `cy.get(${qcss(attrSel("data-testid", sel.testid))})`;
    if (sel.id) return `cy.get(${qcss("#" + sel.id)})`;
    if (sel.name) return `cy.get(${qcss(attrSel("name", sel.name))})`;
    const isField = sel.tag === "input" || sel.tag === "textarea" || sel.tag === "select";
    if (isField && sel.placeholder) return `cy.get(${qcss(attrSel("placeholder", sel.placeholder))})`;
    const name = sel.text || sel.ariaLabel || ev.label;
    if (name && (sel.tag === "button" || sel.tag === "a")) return `cy.contains(${q(sel.tag)}, ${q(name)})`;
    if (name) return `cy.contains(${q(name)})`;
    return `cy.get(${qcss(sel.tag || "*")})`;
  }
  // Same-origin iframes only: Cypress reaches into the frame's document body.
  function cyInFrame(ev, loc) {
    if (!ev.frame) return loc;
    const body = `cy.get(${qcss(frameSelector(ev.frame))}).its('0.contentDocument.body').should('not.be.empty').then(cy.wrap)`;
    if (loc.startsWith("cy.get(")) return body + ".find(" + loc.slice(7);
    if (loc.startsWith("cy.contains(")) return body + ".contains(" + loc.slice(12);
    return loc;
  }
  function buildCypress(events) {
    const evs = (events || []).filter(Boolean);
    const first = evs.find((e) => e.type === "navigate");
    const L = [`describe(${q(testTitle(evs))}, () => {`, "  it('runs the recorded flow', () => {"];
    if (first) L.push(`    cy.visit(${q(first.url)});`);
    if (evs.some((e) => e.frame)) L.push("    // NOTE: iframe steps work only for same-origin frames (set chromeWebSecurity: false).");
    const C = (ev) => cyInFrame(ev, cyLoc(ev));
    let pendingTabVisit = false;
    let curTab = (evs.find((e) => e.tabId != null) || {}).tabId;
    const tabUrl = new Map(); // tabId -> last URL seen in it
    evs.forEach((ev) => {
      if (ev.type === "newtab") {
        L.push("    // A new tab opened here. Cypress drives a single tab, so visit its URL directly.");
        pendingTabVisit = true; curTab = ev.tabId;
        return;
      }
      if (ev.tabId != null && curTab != null && ev.tabId !== curTab) {
        curTab = ev.tabId;
        if (tabUrl.has(ev.tabId)) L.push("    // Switched back to the earlier tab.", `    cy.visit(${q(tabUrl.get(ev.tabId))});`);
      }
      if (ev.type === "navigate" && ev.tabId != null) tabUrl.set(ev.tabId, ev.url);
      switch (ev.type) {
        case "navigate":
          if (pendingTabVisit) { L.push(`    cy.visit(${q(ev.url)});`); pendingTabVisit = false; }
          else if (ev !== first) L.push(`    // \u2192 ${shortPage(ev.page, ev.url)}`);
          break;
        case "input":
          if (!ev.sensitive && !ev.value) break;
          L.push(`    ${C(ev)}.type(${ev.sensitive ? "Cypress.env('TEST_PASSWORD') || 'REPLACE_ME'" : q(ev.value)});`); break;
        case "select": L.push(`    ${C(ev)}.select(${q(ev.value)});`); break;
        case "toggle": L.push(`    ${C(ev)}.${ev.checked ? "check" : "uncheck"}();`); break;
        case "click": L.push(`    ${C(ev)}.click();`); break;
        case "key": if (ev.value === "Enter") L.push(`    ${C(ev)}.type('{enter}');`); break;
        case "message": L.push(`    cy.contains(${q(ev.text)}).should('be.visible');`); break;
      }
    });
    L.push("  });", "});", "");
    return L.join("\n");
  }

  window.TCGen = { generate, generateSuite, buildSteps, stepText, buildPlaywright, buildCypress };
})();
