// Unit tests for generator.js — run with: node --test
// Covers case generation, dedupe, per-element cases, observation-driven
// login features, step building, and Playwright/Cypress codegen.
const test = require("node:test");
const assert = require("node:assert");

// generator.js attaches to window.TCGen and touches window/document/URL.
global.window = {};
global.document = { getElementById: () => null };
global.URL = URL;
require("../generator.js");
const G = global.window.TCGen;

// ---- fixtures -------------------------------------------------------------
function loginFlow(extra = []) {
  return [
    { type: "navigate", url: "https://portal.example.com/login", page: "Control Portal" },
    { type: "input", label: "Email", value: "admin@corp.com", sel: { tag: "input", type: "email", id: "email", name: "email" } },
    { type: "input", label: "Password", value: null, sensitive: true, sel: { tag: "input", type: "password", name: "password" } },
    { type: "click", kind: "button", label: "Login", sel: { tag: "button", text: "Login", testid: "login-btn" } },
    ...extra,
    { type: "message", level: "success", text: "Welcome back" },
    { type: "navigate", url: "https://portal.example.com/dashboard", page: "Dashboard" },
  ];
}
const scenarios = (cases) => cases.map((c) => c.scenario);

// ---- naming / primary action ---------------------------------------------
test("positive case anchors on login, not the last click", () => {
  const evs = loginFlow([{ type: "click", kind: "link", label: "Transactions" }]);
  const suite = G.generateSuite(evs, { flowValidation: false });
  const pos = suite.find((c) => c.kind === "positive");
  assert.match(pos.scenario, /login with valid credentials/i);
  assert.doesNotMatch(pos.scenario, /Transactions/i);
});

test("page named 'Login' does not produce 'Login login'", () => {
  const evs = [
    { type: "navigate", url: "https://x/login", page: "Login" },
    { type: "input", label: "Email", value: "a@b.com", sel: { tag: "input", type: "email" } },
    { type: "input", label: "Password", value: null, sensitive: true, sel: { tag: "input", type: "password" } },
    { type: "click", kind: "button", label: "Login", sel: { tag: "button" } },
  ];
  const pos = G.generateSuite(evs, { flowValidation: false }).find((c) => c.kind === "positive");
  assert.doesNotMatch(pos.scenario, /Login login/i);
});

// ---- field cases phrasing -------------------------------------------------
test("field cases use action-led phrasing without quotes", () => {
  const s = scenarios(G.generateSuite(loginFlow(), { flowValidation: false }));
  assert.ok(s.includes("Validate login with an empty email field."));
  assert.ok(s.includes("Validate login with an invalid email format."));
  assert.ok(s.includes("Validate login with an empty password field."));
  assert.ok(s.includes("Validate login with both email and password empty."));
});

// ---- observation-driven login features ------------------------------------
test("masking is emitted when a password field exists", () => {
  const s = scenarios(G.generateSuite(loginFlow(), { flowValidation: false }));
  assert.ok(s.includes("Validate password masking on the login page."));
});

test("remember-me / forgot-password only when observed", () => {
  const without = scenarios(G.generateSuite(loginFlow(), { flowValidation: false }));
  assert.ok(!without.some((x) => /Remember Me/i.test(x)));
  assert.ok(!without.some((x) => /Forgot Password/i.test(x)));

  const withFeat = scenarios(G.generateSuite(
    loginFlow([{ type: "feature", feature: "remember" }, { type: "feature", feature: "forgot" }]),
    { flowValidation: false }
  ));
  assert.ok(withFeat.some((x) => /Remember Me/i.test(x)));
  assert.ok(withFeat.some((x) => /Forgot Password/i.test(x)));
});

// ---- per-element cases ----------------------------------------------------
test("one case per interacted control, submit excluded", () => {
  const evs = loginFlow([
    { type: "click", kind: "button", label: "Search", sel: { tag: "button" } },
    { type: "select", label: "Filter", value: "Approved", sel: { tag: "select" } },
    { type: "toggle", kind: "checkbox", label: "Active only", checked: true, sel: { tag: "input", type: "checkbox" } },
  ]);
  const s = scenarios(G.generateSuite(evs, { flowValidation: false, elements: true }));
  assert.ok(s.includes('Validate the "Search" button.'));
  assert.ok(s.includes('Validate the "Filter" dropdown.'));
  assert.ok(s.includes('Validate the "Active only" checkbox.'));
  // the submit button (Login) is covered by the positive case, not an element case
  assert.ok(!s.includes('Validate the "Login" button.'));
});

test("elements can be disabled via option", () => {
  const evs = loginFlow([{ type: "click", kind: "button", label: "Search", sel: { tag: "button" } }]);
  const s = scenarios(G.generateSuite(evs, { flowValidation: false, elements: false }));
  assert.ok(!s.includes('Validate the "Search" button.'));
});

// ---- dedupe ---------------------------------------------------------------
test("no duplicate scenarios even with repeated clicks", () => {
  const evs = loginFlow([
    { type: "click", kind: "button", label: "Search", sel: { tag: "button" } },
    { type: "click", kind: "button", label: "Search", sel: { tag: "button" } },
    { type: "click", kind: "button", label: "Search", sel: { tag: "button" } },
  ]);
  const s = scenarios(G.generateSuite(evs, { flowValidation: false }));
  const uniq = new Set(s.map((x) => x.toLowerCase().replace(/\s+/g, " ").trim()));
  assert.strictEqual(uniq.size, s.length, "expected no duplicate scenarios");
});

// ---- steps ----------------------------------------------------------------
test("buildSteps excludes message and feature markers", () => {
  const steps = G.buildSteps(loginFlow([{ type: "feature", feature: "remember" }]));
  assert.ok(!steps.some((x) => /Welcome back/i.test(x)));
  assert.ok(!steps.some((x) => /feature/i.test(x)));
  assert.ok(steps.some((x) => /Login/i.test(x)));
});

// ---- Playwright codegen ---------------------------------------------------
test("Playwright: testid, label, env password, message assertion, goto", () => {
  const code = G.buildPlaywright(loginFlow());
  assert.match(code, /import \{ test, expect \} from '@playwright\/test'/);
  assert.match(code, /await page\.goto\("https:\/\/portal\.example\.com\/login"\)/);
  assert.match(code, /getByLabel\("Email"\)\.fill\("admin@corp\.com"\)/);
  assert.match(code, /process\.env\.TEST_PASSWORD/);
  assert.match(code, /getByTestId\("login-btn"\)\.click\(\)/);
  assert.match(code, /expect\(page\.getByText\("Welcome back"\)\)\.toBeVisible\(\)/);
});

// ---- Cypress codegen ------------------------------------------------------
test("Cypress: visit, selectors, env password, should visible", () => {
  const code = G.buildCypress(loginFlow());
  assert.match(code, /cy\.visit\("https:\/\/portal\.example\.com\/login"\)/);
  assert.match(code, /cy\.get\('#email'\)\.type\("admin@corp\.com"\)/);
  assert.match(code, /Cypress\.env\('TEST_PASSWORD'\)/);
  // Login button has a testid, so Cypress should prefer it over cy.contains
  assert.match(code, /cy\.get\('\[data-testid="login-btn"\]'\)/);
  assert.match(code, /\.click\(\)/);
  assert.match(code, /cy\.contains\("Welcome back"\)\.should\('be\.visible'\)/);
});

test("Cypress falls back to contains for a text-only button", () => {
  const evs = [
    { type: "navigate", url: "https://x/p", page: "Page" },
    { type: "click", kind: "button", label: "Submit", sel: { tag: "button", text: "Submit" } },
  ];
  const code = G.buildCypress(evs);
  assert.match(code, /cy\.contains\("button", "Submit"\)/);
});

// ---- non-login generalization ---------------------------------------------
test("non-login form generalizes phrasing", () => {
  const evs = [
    { type: "navigate", url: "https://x/new", page: "New User" },
    { type: "input", label: "Full Name", value: "Jo", sel: { tag: "input", id: "fullname" } },
    { type: "click", kind: "button", label: "Save", sel: { tag: "button" } },
  ];
  const s = scenarios(G.generateSuite(evs, { flowValidation: false }));
  assert.ok(s.some((x) => /Validate save with valid input/i.test(x)));
  assert.ok(s.some((x) => /empty full name field/i.test(x)));
  assert.ok(!s.some((x) => /password masking/i.test(x)));
});

// ---- multi-page journey (the SauceDemo-style bug) -------------------------
const journey = () => [
  { type: "navigate", url: "https://www.saucedemo.com/", page: "Swag Labs" },
  { type: "input", label: "Username", value: "standard_user", sel: { tag: "input", id: "user-name" } },
  { type: "input", label: "Password", value: null, sensitive: true, sel: { tag: "input", id: "password" } },
  { type: "click", kind: "button", label: "Login", sel: { tag: "input", type: "submit", id: "login-button" } },
  { type: "navigate", url: "https://www.saucedemo.com/inventory.html", page: "Swag Labs" },
  { type: "click", kind: "link", label: "4", sel: { tag: "a" } },
  { type: "navigate", url: "https://www.saucedemo.com/checkout-step-one.html", page: "Swag Labs" },
  { type: "click", kind: "button", label: "Continue", sel: { tag: "input", type: "submit" } },
  { type: "message", level: "error", text: "Error: First Name is required" },
  { type: "input", label: "First Name", value: "henry", sel: { tag: "input", id: "first-name" } },
  { type: "input", label: "Last Name", value: "okolie", sel: { tag: "input", id: "last-name" } },
  { type: "click", kind: "button", label: "Continue", sel: { tag: "input", type: "submit" } },
  { type: "navigate", url: "https://www.saucedemo.com/checkout-step-two.html", page: "Swag Labs" },
  { type: "click", kind: "link", label: "Logout", sel: { tag: "a" } },
];

test("field cases are scoped to their page, not all called 'login'", () => {
  const s = scenarios(G.generateSuite(journey(), { flowValidation: false }));
  assert.ok(s.includes("Validate login with an empty username field."));
  assert.ok(s.some((x) => /Checkout Step One form with an empty first name field/i.test(x)));
  assert.ok(!s.some((x) => /login with an empty first name field/i.test(x)));
});

test("login positive steps stop at login (not the whole journey)", () => {
  const pos = G.generateSuite(journey(), { flowValidation: false }).find((c) => c.kind === "positive");
  assert.ok(pos.steps.some((x) => /Login/i.test(x)));
  assert.ok(!pos.steps.some((x) => /Continue|Logout|Checkout/i.test(x)), "login steps leaked the journey");
});

test("negative login case does not borrow a later checkout error", () => {
  const neg = G.generateSuite(journey(), { flowValidation: false }).find((c) => c.kind === "negative");
  assert.ok(!/First Name is required/i.test(neg.expected));
});

test("field clicks and junk labels are not element cases; submit inputs are", () => {
  const s = scenarios(G.generateSuite(journey(), { flowValidation: false }));
  assert.ok(!s.some((x) => /Validate the "Username" button/i.test(x)));
  assert.ok(!s.some((x) => /Validate the "4" link/i.test(x)));
  assert.ok(s.includes('Validate the "Continue" button.'));
  assert.ok(s.includes('Validate the "Logout" link.'));
});

test("each case is tagged with the feature module", () => {
  const evs = [
    { type: "navigate", url: "https://www.saucedemo.com/", page: "Swag Labs" },
    { type: "input", label: "Username", value: "u", sel: { tag: "input" } },
    { type: "input", label: "Password", value: null, sensitive: true, sel: { tag: "input" } },
    { type: "click", kind: "button", label: "Login", sel: { tag: "input", type: "submit" } },
    { type: "navigate", url: "https://www.saucedemo.com/inventory.html", page: "Swag Labs" },
    { type: "click", kind: "button", label: "Add to cart", sel: { tag: "button" } },
    { type: "navigate", url: "https://www.saucedemo.com/checkout-step-one.html", page: "Swag Labs" },
    { type: "input", label: "First Name", value: "h", sel: { tag: "input" } },
    { type: "click", kind: "button", label: "Continue", sel: { tag: "input", type: "submit" } },
    { type: "click", kind: "link", label: "Logout", sel: { tag: "a" } },
  ];
  const cases = G.generateSuite(evs, { flowValidation: false });
  const modOf = (re) => cases.find((c) => re.test(c.scenario)).module;
  assert.strictEqual(modOf(/login with valid credentials/), "Login");
  assert.strictEqual(modOf(/empty first name/), "Checkout");
  assert.strictEqual(modOf(/"Add to cart"/), "Cart");
  assert.strictEqual(modOf(/"Logout"/), "Logout");
  // every case has a non-empty module
  assert.ok(cases.every((c) => c.module && c.module.length));
});

// ---- multi-tab + iframe recording ------------------------------------------
function multiTabFlow() {
  return [
    { type: "navigate", url: "https://shop.example.com/cart", page: "Cart", tabId: 1 },
    { type: "click", kind: "link", label: "Pay with Provider", sel: { tag: "a", text: "Pay with Provider" }, tabId: 1 },
    { type: "newtab", tabId: 2, openerTabId: 1 },
    { type: "navigate", url: "https://pay.example.net/checkout", page: "Pay", tabId: 2 },
    { type: "input", label: "Card name", value: "Ada", sel: { tag: "input", name: "cardname" }, tabId: 2,
      frame: { url: "https://widget.example.org/form", name: "payframe", src: "", title: "Payment form" } },
    { type: "click", kind: "button", label: "Confirm", sel: { tag: "button", text: "Confirm" }, tabId: 2 },
    { type: "click", kind: "button", label: "Done", sel: { tag: "button", text: "Done" }, tabId: 1 },
  ];
}

test("steps mention the new tab, the frame, and switching back", () => {
  const steps = G.buildSteps(multiTabFlow());
  assert.ok(steps.includes("Switch to the new tab that opens."));
  assert.ok(steps.some((s) => /Card name.*inside the "Payment form" frame\)\.$/.test(s)));
  assert.ok(steps.includes("Switch back to the previous tab."));
});

test("Playwright follows the new tab and targets the iframe", () => {
  const code = G.buildPlaywright(multiTabFlow());
  assert.match(code, /async \(\{ page, context \}\)/);
  assert.match(code, /const page2Promise = context\.waitForEvent\('page'\);\n  await page\.getByRole\("link", \{ name: "Pay with Provider" \}\)\.click\(\);\n  const page2 = await page2Promise;/);
  assert.match(code, /page2\.frameLocator\('iframe\[name="payframe"\]'\)\.getByLabel\("Card name"\)\.fill\("Ada"\)/);
  assert.match(code, /await page2\.getByRole\("button", \{ name: "Confirm" \}\)\.click\(\);/);
  assert.match(code, /await page\.bringToFront\(\);\n  await page\.getByRole\("button", \{ name: "Done" \}\)\.click\(\);/);
});

test("single-tab Playwright output is unchanged (no context fixture)", () => {
  const code = G.buildPlaywright(loginFlow());
  assert.match(code, /async \(\{ page \}\)/);
  assert.doesNotMatch(code, /context|bringToFront|frameLocator/);
});

test("Cypress visits the new tab's URL and reaches into the iframe", () => {
  const code = G.buildCypress(multiTabFlow());
  assert.match(code, /cy\.visit\("https:\/\/pay\.example\.net\/checkout"\);/);
  assert.match(code, /cy\.get\('iframe\[name="payframe"\]'\)\.its\('0\.contentDocument\.body'\)\.should\('not\.be\.empty'\)\.then\(cy\.wrap\)\.find\('\[name="cardname"\]'\)\.type\("Ada"\)/);
  assert.match(code, /Switched back to the earlier tab\.\n    cy\.visit\("https:\/\/shop\.example\.com\/cart"\);/);
});
