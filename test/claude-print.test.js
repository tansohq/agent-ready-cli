import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/harness/executors/claude-print.js";

describe("claude-print run", () => {
  it("resolves as a failed run with the spawn error when claude is not on PATH", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "ar-claude-print-"));
    const emptyBin = mkdtempSync(join(tmpdir(), "ar-empty-bin-"));
    const events = [];
    const out = await run({ prompt: "hi", workDir, childEnv: { PATH: emptyBin }, tools: ["Read"], network: [], maxTurns: 1, model: null, redact: (s) => s, onEvent: (e) => events.push(e) });
    assert.equal(out.exitCode, null);
    assert.equal(out.stoppedBecause, "spawn failed: ENOENT");
    assert.match(out.stderr, /could not start claude: .*ENOENT/);
    assert.equal(events.length, 0);
    // The trace stream was closed before run() returned, so the file exists and is complete.
    assert.equal(readFileSync(join(workDir, "trace.jsonl"), "utf8"), "");
  });
});
