# Privacy Policy — QA TestCase Recorder

_Last updated: 13 November 2026_

QA TestCase Recorder is a browser extension that records the actions you take on a
web page and turns them into editable QA test cases. This policy explains what data
it handles and where that data goes.

## What the extension records

Only while you have recording switched on, in the tab you chose to record:

- **Your actions on the page**: clicks, values you type into fields, selections,
  and navigation between pages.
- **Page details**: the page's URL and title, plus the labels, names and messages
  shown on screen (for example, success and error messages).
- **Screenshots** of the visible part of the page, if screenshot capture is turned on.

Values typed into password fields, and into fields whose name suggests sensitive data
(card numbers, CVV, PINs, one-time codes, tokens and similar), are masked and never
stored.

## Where the data is kept

Everything above is stored **locally in your browser** (`chrome.storage.local`) on
your own device. The developer has no server and does not receive, collect or see any
of it. You can delete recordings, screenshots and test cases at any time from the
extension, and uninstalling the extension removes all of its stored data.

## Data shared with third parties

The extension sends nothing anywhere by default. There is one optional feature:

- **AI test-case suggestions.** If you enter your own Anthropic API key and click the
  button to generate suggestions, the extension sends the recorded steps, any
  description you typed, and any screenshots you chose to include directly from your
  browser to Anthropic's API (`api.anthropic.com`) so it can draft test cases. This
  request goes straight from your browser to Anthropic, not through the developer, and
  is covered by [Anthropic's privacy policy](https://www.anthropic.com/legal/privacy).
  Your API key is stored only in your browser's local storage.

Files you export (Excel, CSV, ZIP, or the TestRail, Jira Xray, Zephyr Scale or Azure
DevOps import formats) are saved to your computer. The extension does not upload them.

## What we don't do

- We do not sell or transfer your data to third parties, except the optional Anthropic
  request above, which you start yourself.
- We do not use your data for advertising, analytics, profiling, or for any purpose
  unrelated to creating test cases.
- We do not use your data to determine creditworthiness or for lending purposes.

## Contact

Questions or concerns: open an issue at
https://github.com/henry970/qa_testcase_recorder/issues
