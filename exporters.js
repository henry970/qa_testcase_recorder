// exporters.js — CSV layouts for test-management tools.
// Each exporter takes normalized cases:
//   { id, module, title, preconditions, steps: [string], data, expected, priority, type }
// and returns CSV text. Exposed on window.TCExport (and module.exports for tests).
//
// Formats:
//   TestRail      — one row per case (Test Case (Text) template); mapped in the import wizard.
//   Xray (Jira)   — one row per step, grouped by "Issue Id"; mapped in the Test Case Importer.
//   Zephyr Scale  — one row per step; case fields on the first row only; mapped in the wizard.
//   Azure DevOps  — Microsoft's documented header, one row per step, case fields repeated.
//                   Azure DevOps Server imports these headers as-is (no mapping step).

(function () {
  // RFC 4180 quoting; no BOM (some importers read a BOM as part of the first header).
  function cell(v) {
    const s = String(v == null ? "" : v).replace(/\r\n?/g, "\n");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  const toCSV = (rows) => rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

  // Steps with at least one row, so a case without steps still imports.
  const stepsOf = (c) => (c.steps && c.steps.length ? c.steps : [""]);
  // The expected result belongs to the last step (cases carry one overall result).
  const expectedFor = (c, i, n) => (i === n - 1 ? c.expected || "" : "");
  const PRIORITY_NUM = { critical: 1, high: 2, medium: 3, low: 4 };
  const priorityNum = (p) => PRIORITY_NUM[String(p || "").toLowerCase()] || 3;
  const label = (s) => String(s || "").trim().replace(/\s+/g, "_");

  function testrail(cases) {
    const rows = [["ID", "Title", "Section", "Type", "Priority", "Preconditions", "Steps", "Test Data", "Expected Result"]];
    cases.forEach((c) => rows.push([
      c.id, c.title, c.module || "", c.type || "", c.priority || "", c.preconditions || "",
      (c.steps || []).map((s, i) => `${i + 1}. ${s}`).join("\n"), c.data || "", c.expected || "",
    ]));
    return toCSV(rows);
  }

  function xray(cases) {
    const rows = [["Issue Id", "Summary", "Description", "Priority", "Labels", "Component", "Test Type", "Action", "Data", "Expected Result"]];
    cases.forEach((c) => {
      const steps = stepsOf(c);
      const description = c.preconditions ? `Preconditions:\n${c.preconditions}` : "";
      steps.forEach((s, i) => rows.push([
        c.id, c.title, description, c.priority || "", label(c.type), c.module || "", "Manual",
        s, i === 0 ? c.data || "" : "", expectedFor(c, i, steps.length),
      ]));
    });
    return toCSV(rows);
  }

  function zephyr(cases) {
    const rows = [["Name", "Objective", "Precondition", "Folder", "Status", "Priority", "Labels",
      "Test Script (Step-by-Step) - Step", "Test Script (Step-by-Step) - Test Data", "Test Script (Step-by-Step) - Expected Result"]];
    cases.forEach((c) => {
      const steps = stepsOf(c);
      steps.forEach((s, i) => rows.push(i === 0
        ? [c.title, c.id ? `Source ID: ${c.id}` : "", c.preconditions || "", c.module ? `/${c.module}` : "", "Draft", c.priority || "", label(c.type),
          s, c.data || "", expectedFor(c, i, steps.length)]
        : ["", "", "", "", "", "", "", s, "", expectedFor(c, i, steps.length)]));
    });
    return toCSV(rows);
  }

  function azure(cases, opts = {}) {
    const area = opts.areaPath || "";
    const who = opts.assignedTo || "";
    const state = opts.state || "Design";
    const rows = [["ID", "Work Item Type", "Title", "Test Step", "Step Action", "Step Expected", "Area Path", "Assigned To", "State", "Priority"]];
    cases.forEach((c) => {
      const steps = stepsOf(c).slice();
      // Azure has no preconditions/test-data field: carry them in the first steps.
      if (c.data) steps.unshift(`Use this test data:\n${c.data}`);
      if (c.preconditions) steps.unshift(`Preconditions:\n${c.preconditions}`);
      steps.forEach((s, i) => rows.push([
        "", "Test Case", c.title, i + 1, s, expectedFor(c, i, steps.length), area, who, state, priorityNum(c.priority),
      ]));
    });
    return toCSV(rows);
  }

  const TCExport = {
    testrail: { label: "TestRail", file: "testrail", build: testrail },
    xray: { label: "Jira Xray", file: "xray", build: xray },
    zephyr: { label: "Zephyr Scale", file: "zephyr-scale", build: zephyr },
    azure: { label: "Azure DevOps", file: "azure-devops", build: azure },
  };
  if (typeof window !== "undefined") window.TCExport = TCExport;
  if (typeof module !== "undefined" && module.exports) module.exports = TCExport;
})();
