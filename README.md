# QA TestCase Recorder

![QA TestCase Recorder](logo.png)

**Turn the clicks you already make into proper, structured QA test cases —
complete with real evidence.**

## Why this matters

Writing test cases by hand is slow, repetitive, and easy to get wrong. You click
through a flow, then switch to a spreadsheet and re-type every step from memory,
invent the expected result, and — under time pressure — quietly skip the negative
and field-validation cases that catch the real bugs.

This tool removes that gap. You record a flow **once**, in the actual app, and it
drafts the test cases for you:

- **The positive case** you performed, written as clean numbered steps.
- **The negative cases** derived from it (e.g. "invalid credentials cannot log in").
- **Field-validation cases** for every input — required, invalid format — before
  the page-level case.
- **Real expected results**, taken from the success and error messages that
  actually appeared on screen, instead of guesses.
- **Screenshot evidence** of each page, exportable as a ZIP named by test-case ID.

You stay in control: review the drafts, edit anything, set status, and export to
**Excel or CSV** — or import an existing sheet and keep building on it. The table
itself is yours to shape (columns, their roles, and the status options). What used
to be an afternoon of typing becomes a few minutes of recording and reviewing, and
the cases are more complete and better-evidenced than most people write by hand.

It's a drafting assistant, not an oracle: the scenarios and expected text are
starting points meant to be reviewed, and screenshots capture the visible screen.
Treat its output as a strong first draft you refine — that's where the time saving
comes from.

## Set it up (about 2 minutes)

1. **Extract** the downloaded zip. You should get a single folder,
   `qa-testcase-recorder`, with `manifest.json` directly inside it.
2. Open **`chrome://extensions`** in Chrome (or Edge / Brave — any Chromium browser).
3. Turn on **Developer mode** (toggle, top-right).
4. Click **Load unpacked** and choose that `qa-testcase-recorder` folder.
5. **Pin** the extension so its icon sits in your toolbar.

Then: open the page you want to test, click the icon, press **Start recording**,
run your flow, press **Stop**, review the drafted cases, and **Add** the ones you
want. Export to Excel or CSV when you're done. That's the whole loop.

---

A Chrome extension that records the actions you perform on a page (clicks, form
entries, dropdowns, checkboxes, navigation — including SPA/Next.js route changes)
and turns each recording session into an editable QA test case. Export all cases
to CSV in this exact column layout:

`TC ID | Test Scenario | Test Steps | Expected Result | Status | Column 1`

## Install (load unpacked)

1. Extract the zip — you'll get a `qa-testcase-recorder` folder.
2. Open `chrome://extensions` in Chrome (or any Chromium browser — Edge, Brave).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the extracted `qa-testcase-recorder` folder
   (the folder that contains `manifest.json` directly).
5. Pin the extension so its icon is visible.

## Use it

1. Open the tab/app you want to test.
2. Click the extension icon → **Start recording**. (Use **Pause / Resume** to stop
   capturing temporarily — e.g. while you set something up — without ending the session.)
3. Perform your flow (e.g. log in). The popup shows a live count of captured actions.
4. Click **Stop recording**. A batch of proposed cases appears (field checks,
   the positive flow, and negatives — see below).
5. Untick any you don't want, edit freely, then **Add selected to suite**.
6. Repeat for more scenarios. When done, **Export CSV** (or **Copy CSV**).

IDs auto-increment as `SMK_001`, `SMK_002`… Change the prefix / start number in
the ⚙ settings.

## Set up your own table

The columns aren't fixed. Open ⚙ settings → **Table columns** to add, rename,
reorder (↑ ↓), or delete columns. Each column has a **role** that tells the
generator what belongs there:

- **Auto ID** — filled with `PREFIX_NNN`, incrementing per row
- **Scenario** — the generated test scenario
- **Test Steps** — the numbered steps (auto-numbered on export)
- **Expected Result** — the generated expected result
- **Status** — an editable picker; options default to Pass / Fail / Not Tested / Pending and are configurable in settings
- **Blank (manual)** — an empty column you fill in yourself

Whatever table you define drives everything: the batch review fields, the saved
list, and the exported CSV all follow your columns and their order. "Reset"
restores the default six-column layout.

## Running tests & logging Actual Result

The default table now includes an **Actual Result** column. In the saved list,
click the ▸ caret on any case to open its run panel — it shows the Steps and
Expected Result for reference and gives you an **Actual Result** box to type what
actually happened while testing. The Status picker (Pass/Fail/Blocked…) is right
on the row and colour-codes as you set it. Everything you type is saved as you go.

## Export & import

- **Excel** — writes a real `.xlsx` (via the bundled SheetJS) with sized columns.
- **CSV** — same data as comma-separated values; multi-line steps stay in one cell.
- **Copy** — puts the CSV on your clipboard to paste into Sheets/Excel.
- **Import CSV** (⚙ settings) — pick a `.csv` and it rebuilds the columns from the
  header row (guessing roles by name) and loads the rows into your suite, so you
  can pick up an existing sheet and keep going. Step numbering is normalised on
  import so it never double-numbers.

## Negative + field-validation cases (from one positive recording)

You only record the happy path. On **Stop**, the extension proposes a batch:

1. **Field-validation cases first** — for every input it saw, a "required / empty"
   case, plus a format case for email or numeric fields.
2. **The positive case** — your recorded flow.
3. **Flow-validation cases** — for each page the flow moved through, a "page
   loads successfully" case, plus an end-to-end case for longer journeys.
4. **Negative case(s)** — e.g. a login flow yields "invalid credentials cannot
   log in."

Each proposed case has a tag (field / positive / negative), an editable scenario,
an editable steps + expected block (click "steps & expected"), a Status/priority
picker, and a checkbox. Untick anything you don't want, then **Add selected to
suite**. Toggle the two generators in ⚙ settings.

Boundary: this expands *the flow you recorded*. It can't invent unrelated pages
(e.g. a full dashboard/transactions suite) from a login recording — record those
flows too, or use the Claude enhancement below to draft a broader suite from an
app description.

## Messages & screenshots (evidence)

While recording, the extension also watches for **error and success messages** —
toasts, alerts, inline validation, aria-live regions. A captured message becomes
the real Expected Result: a success toast fills the positive case's expected text,
an error message fills the negative case's. No more guessing what "success" looks
like. Toggle this with "Capture error / success messages".

It also takes a **screenshot of each page** as you navigate (visible area, JPEG).
After you stop, the batch shows the page shots; when you add cases, the shots
attach to the recorded (positive) case. In a saved case's run panel you'll see the
thumbnails, and a **＋ Capture screen** button grabs the current tab on demand —
handy for attaching evidence to a Pass/Fail while testing. Click a thumbnail to
open it full size; the ⤓ downloads one. To export them all at once, use the
**⤓ Screenshots** link in the saved-cases header — it downloads a single ZIP with
every screenshot named by TC ID (e.g. `SMK_004_1.jpg`). Toggle capture with
"Capture a screenshot of each page".

Screenshots live in local extension storage (unlimitedStorage), not in the CSV/
Excel file — spreadsheets can't embed images. Deleting a case or clearing the
suite removes its screenshots too.

## Summary, pie chart & report

Once you have saved cases, a **📊 Summary** button appears in the saved-cases
header. It opens a panel with a live **pie chart** and a breakdown — total cases
and how many are Pass / Fail / Not Tested / Pending (and any custom statuses),
with percentages. It updates the moment you change a status.

From there you can **Export report (HTML)** — a self-contained file with the pie
chart, the pass/fail summary, and the full test-case table including the Actual
Result column. Open it in any browser or share it; it needs no internet or fonts.

The **Excel** export also gains a second **Summary** sheet with the same totals
and percentages (numbers only — spreadsheets from the free engine can't embed a
chart, but the HTML report has the visual).


## Recent additions

- **Auto-Pass toggle** — "Mark cases Pass when a success message is seen" in settings
  (default on). Turn it off to have every case start as Not Tested.
- **Reset all to Not Tested** — a button in the Summary panel to zero out statuses
  before a fresh test cycle.
- **Duplicate detection** — in the batch review, a case whose scenario already exists
  in your suite is tagged "duplicate" and unticked by default, so repeat recordings
  (e.g. the same field checks) don't pile up.
- **Preset column options** — give a Blank column a comma-separated option list in the
  column editor and it becomes a dropdown in the batch review (e.g. Module = Login /
  Dashboard / Transactions).
- **Smarter naming** — the positive/negative case now anchors on the real submit/login
  action, so a multi-page recording no longer mislabels it after the last link clicked.

## AI suggestions (your Anthropic API key)

A recording can only produce cases for pages you actually visited. To draft the
*rest* of a suite — the dashboard, transactions, pool-account, user-management
cases you'd otherwise hand-write — use **✨ AI suggest more cases**.

Setup (⚙ settings → AI suggestions): paste your **Anthropic API key**, optionally
set a **Model** (default `claude-opus-5-5`; type `claude-sonnet-5-5` for a cheaper
option), and write a short **App description**
of what to test. Then press the button: Claude returns a batch of test cases that
land in the normal review list (tagged blue **ai**), where you edit, untick, and
add the ones you want. It's told which scenarios you already have, so it aims for
new ones; duplicate detection catches any overlap.

Privacy: the key is stored locally on your device and sent only to Anthropic when
you press the button. Recording field *labels* may be included as context; field
*values* are never sent. Cost is billed to your own Anthropic account.

## Performance & transparency

- The popup opens fast: the Excel library (~0.9 MB) now loads **only when you click
  Excel**, not on every open.
- After you stop recording, the review panel shows a **"Recorded flow"** disclosure
  listing the exact steps the recorder captured (in order, with the real button and
  field labels) — so you can confirm the cases follow what you actually did before
  adding them. The positive case's steps are built verbatim from this flow.

## Export as automated test (Playwright / Cypress)

Record a flow once. An **"Export last recording as test"** bar then appears under
the record button (and stays available after you add the cases, and on reopen) with
**Playwright** and **Cypress** buttons that download a runnable spec
(`test_<date>.spec.js` or `test_<date>.cy.js`).

The recorder captures a real selector for each action (in priority order:
`data-testid` → ARIA role/label → `getByLabel` → placeholder → `#id` → `[name]`),
so the generated code uses robust locators rather than brittle CSS paths. Captured
success/error messages become assertions (`expect(...).toBeVisible()` /
`.should('be.visible')`), the first navigation becomes `goto`/`visit`, and password
fields are filled from an env var (`process.env.TEST_PASSWORD` / `Cypress.env(...)`)
instead of a hard-coded secret.

Review the selectors before running — the recorder picks the best available
locator, but a page with poor markup may need a human tweak. The export reflects the
**current recording session** (the raw actions), not the saved test-case table.

## Which tabs and frames are recorded

A recording starts on the tab you press Start on. Unrelated tabs you have open
(or click around in) are ignored, so they won't leak steps into your test.

- **New tabs and pop-ups.** If the flow opens a new tab or pop-up window (an
  "open in new tab" link, an OAuth sign-in, a payment pop-up), that tab joins the
  recording automatically. The steps read "Switch to the new tab that opens" and
  "Switch back to the previous tab".
- **iframes.** Actions inside embedded frames (payment widgets, embedded forms)
  are recorded too, and the step notes which frame they happened in.
- **Code export.** Playwright follows new tabs with `context.waitForEvent('page')`
  and targets frames with `frameLocator(...)`. Cypress can drive only one tab, so
  it visits the new tab's URL directly. It can reach into same-origin iframes only.

## Replay a recording

When you add a batch, the positive case keeps its recorded flow. Open that case
(▸) and press **▶ Replay this case** to re-run it in the current tab. The
extension opens the first page, then fills fields, clicks, picks options and
checks for the success messages that appeared while you recorded. It follows new
tabs and iframes the same way the recorder did. A panel shows each step live,
marked passed, warning or failed, and you can **Stop** at any time.

When the replay finishes, the case's
**Status** becomes Pass or Fail, the **Actual Result** column gets a summary
(which step failed and why), and a screenshot of the final screen is attached.

- Password and other secret values are never stored. If the flow has one, type it
  in the replay box. It is used for that run only.
- Replay finds elements the way the code export does: test id, id, name, label,
  then visible text. A page that changed a lot since the recording may need a fresh
  recording.
- A replay can't start while recording, and recording can't start while a replay
  runs.

## Feature-by-feature, no duplicates, screenshots-to-cases

- **No duplicates.** The generator never emits two cases with the same scenario,
  and adding a batch skips any case whose scenario already exists in your suite
  (the status line reports how many were skipped).
- **One case per control.** Every button, link, menu/dropdown, and checkbox you
  interact with becomes its own test case (purple **element** tag) — test coverage
  feature by feature. Toggle it in settings ("One case per button / menu / checkbox").
- **Screenshots → cases (vision).** With "Use page screenshots (vision)" on (AI
  settings), the AI suggest button sends the captured page screenshots to Claude, so
  it can look at the actual UI and write cases for every visible element. Screenshots
  are available right after recording (before you add the batch).

## Unit tests

The core case-generation and code-gen logic in `generator.js` is covered by unit
tests (no dependencies, Node's built-in runner). From the project folder:

    npm test        # or: node --test

Covers scenario naming, action-led field phrasing, observation-driven login
features, one-case-per-control generation, duplicate prevention, step building,
and the Playwright/Cypress selector + assertion output. Run it after any change to
`generator.js` to catch regressions.

## Test Module column

A **Test Module** column (role: Module / Feature) sits between TC ID and Scenario and
is auto-filled with the feature each case exercises — Login, Logout, Cart, Checkout,
Products, Transactions, etc. — derived from the page and the control's label. Add it
via **+ Add column → role "Module / Feature"** (then move it up), or press **Reset** to
get the default layout that now includes it.

## Notes

- Password and other sensitive fields (password, cvv, otp, token, pin…) are never
  recorded as values — they become "Enter a valid …" steps.
- The **Status** picker options are yours to set: edit the comma-separated
  "Status options" field in settings (default Pass / Fail / Not Tested / Pending).
  New cases default to the first "not tested / pending"-style option. Legacy values
  already saved are kept as options so nothing is lost.
- The Scenario and Expected Result are best-effort guesses meant to be reviewed and
  edited before saving. Steps are captured verbatim from your actions.
- Status can be updated per case at any time from the saved list or run panel.
- The CSV opens cleanly in Excel and Google Sheets; multi-line Test Steps are kept
  in a single quoted cell.

## Optional: smarter Scenario/Expected via Claude

The generator is rule-based so it works offline. If you want richer scenario names
and expected results, send the captured `events` array to the Anthropic API from
`popup.js` (you'd add your own API key and a fetch call) and use the returned text
to prefill the draft fields. The current rules live in `generator.js`.
