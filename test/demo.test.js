import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildReport } from "../src/report/index.js";
import { historyLine } from "../src/report/delta.js";
import { renderDemo } from "../src/report/demo.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run1 = join(root, "fixtures", "acme.dev", "run1");
const run2 = join(root, "fixtures", "acme.dev", "run2");

describe("demo walkthrough", () => {
  it("renders Before from the previous run's own evidence and After from the current run", () => {
    const previousReport = buildReport({ dir: run1, version: "test" });
    const report = buildReport({ dir: run2, previous: [historyLine(previousReport)], version: "test" });
    const html = renderDemo(report, { assetDir: run2, previousReport });
    assert.match(html, /Inside a customer task/);
    assert.match(html, /id="view-before"/);
    assert.match(html, /id="view-after" hidden/);
    // Before: signup was blocked by reCAPTCHA in run1, and that run's own quote is what shows.
    assert.match(html, /The signup form has a reCAPTCHA/);
    assert.match(html, /WHERE THE TASK STOPS/);
    // After: pay stalls on checkout_url, quoted from run2.
    assert.match(html, /checkout_url that needs a browser/);
    assert.match(html, /Proposed flow \+ retest/);
    // Step states carry the site's vocabulary.
    assert.match(html, /class="blocked" data-stage="signup"/);
    assert.match(html, /class="done" data-stage="signup"/);
  });

  it("renders a single view when there is no previous run", () => {
    const report = buildReport({ dir: run1, version: "test" });
    const html = renderDemo(report, { assetDir: run1 });
    assert.doesNotMatch(html, /id="view-before"/);
    assert.match(html, /Where the task stands/);
    assert.match(html, /play/); // recording hook present
  });
});

describe("replay", () => {
  it("plays every attempted stage with its request and the agent's words", async () => {
    const { renderReplay } = await import("../src/report/replay.js");
    const report = buildReport({ dir: run2, version: "test" });
    const html = renderReplay(report, { assetDir: run2 });
    assert.match(html, /step 1 of 6/); // manage was SKIP in run2
    assert.match(html, /POST \/v1\/accounts/);
    assert.match(html, /checkout_url that needs a browser/);
    assert.match(html, /data-status="blocked"/);
    assert.match(html, /id="replay"/);
  });
});
