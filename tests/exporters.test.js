// Unit tests for exporters.js — run with: node --test
const test = require("node:test");
const assert = require("node:assert");
const X = require("../exporters.js");

const cases = [
  {
    id: "SMK_001", module: "Login", title: "Validate login with valid credentials.",
    preconditions: "User has an account.", steps: ["Open Login.", 'Enter "a@b.com" into the "Email" field.', 'Click the "Login" button.'],
    data: "Email: a@b.com\nPassword: <valid Password>", expected: 'A success message "Welcome, back" is displayed.', priority: "Critical", type: "Positive",
  },
  { id: "SMK_002", module: "", title: "Validate the \"Help\" link.", preconditions: "", steps: [], data: "", expected: "Help opens.", priority: "Low", type: "" },
];

// minimal RFC 4180 parser so the tests read the CSV the way an importer would
function parse(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(f); f = ""; }
    else if (ch === "\r") { /* skip */ }
    else if (ch === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
    else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const obj = (rows) => rows.slice(1).map((r) => Object.fromEntries(rows[0].map((h, i) => [h, r[i]])));

test("no BOM, CRLF line endings, every row has the header's width", () => {
  for (const k of Object.keys(X)) {
    const csv = X[k].build(cases, { areaPath: "P\A", assignedTo: "u@x.com" });
    assert.notStrictEqual(csv.charCodeAt(0), 0xfeff, k);
    assert.match(csv, /\r\n$/, k);
    const rows = parse(csv);
    assert.ok(rows.every((r) => r.length === rows[0].length), `${k}: ragged rows`);
  }
});

test("TestRail: one row per case, numbered steps in one cell", () => {
  const rows = obj(parse(X.testrail.build(cases)));
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].Title, "Validate login with valid credentials.");
  assert.strictEqual(rows[0].Section, "Login");
  assert.strictEqual(rows[0].Steps, '1. Open Login.\n2. Enter "a@b.com" into the "Email" field.\n3. Click the "Login" button.');
  assert.strictEqual(rows[0]["Expected Result"], 'A success message "Welcome, back" is displayed.');
});

test("Xray: one row per step grouped by Issue Id; expected on the last step", () => {
  const rows = obj(parse(X.xray.build(cases)));
  const first = rows.filter((r) => r["Issue Id"] === "SMK_001");
  assert.strictEqual(first.length, 3);
  assert.ok(first.every((r) => r.Summary === "Validate login with valid credentials." && r["Test Type"] === "Manual"));
  assert.deepStrictEqual(first.map((r) => r["Expected Result"]), ["", "", 'A success message "Welcome, back" is displayed.']);
  assert.strictEqual(first[0].Data, "Email: a@b.com\nPassword: <valid Password>");
  // a case with no steps still produces one row
  assert.strictEqual(rows.filter((r) => r["Issue Id"] === "SMK_002").length, 1);
});

test("Zephyr Scale: case fields only on the first step row", () => {
  const rows = obj(parse(X.zephyr.build(cases)));
  assert.strictEqual(rows[0].Name, "Validate login with valid credentials.");
  assert.strictEqual(rows[0].Folder, "/Login");
  assert.strictEqual(rows[1].Name, "");
  assert.strictEqual(rows[1]["Test Script (Step-by-Step) - Step"], 'Enter "a@b.com" into the "Email" field.');
  assert.strictEqual(rows[2]["Test Script (Step-by-Step) - Expected Result"], 'A success message "Welcome, back" is displayed.');
});

test("Azure DevOps: Microsoft's header, repeated case fields, numbered steps, numeric priority", () => {
  const csv = X.azure.build(cases, { areaPath: "MyProject\Web", assignedTo: "qa@corp.com" });
  const table = parse(csv);
  assert.deepStrictEqual(table[0], ["ID", "Work Item Type", "Title", "Test Step", "Step Action", "Step Expected", "Area Path", "Assigned To", "State", "Priority"]);
  const rows = obj(table).filter((r) => r.Title === "Validate login with valid credentials.");
  // preconditions + test data are carried as the first two steps
  assert.strictEqual(rows.length, 5);
  assert.deepStrictEqual(rows.map((r) => r["Test Step"]), ["1", "2", "3", "4", "5"]);
  assert.match(rows[0]["Step Action"], /^Preconditions:/);
  assert.match(rows[1]["Step Action"], /^Use this test data:/);
  assert.ok(rows.every((r) => r.ID === "" && r["Work Item Type"] === "Test Case" && r["Area Path"] === "MyProject\Web" &&
    r["Assigned To"] === "qa@corp.com" && r.State === "Design" && r.Priority === "1"));
  assert.strictEqual(rows[4]["Step Expected"], 'A success message "Welcome, back" is displayed.');
});
