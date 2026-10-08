import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { merge } from "../src/report/merge.js";
import { historyLine } from "../src/report/delta.js";
import { validateScan, validateAudit, validateCrash, validateReport } from "../src/schema/validate.js";
import { scanFixture, auditFixture, crashFixture } from "./helpers.js";

const base = { runId: "r1", target: { url: "https://example.dev" } };
const byId = (report, id) => report.stages.find((s) => s.id === id);

describe("fixtures validate", () => {
  it("scan/audit/crash pass their validators", () => {
    validateScan(scanFixture());
    validateAudit(auditFixture());
    validateCrash(crashFixture());
  });
  it("audit rejects out-of-range score", () => {
    const bad = auditFixture();
    bad.areas.onboarding.score = 11;
    assert.throws(() => validateAudit(bad), /score must be integer 0-10/);
  });
});

describe("scan-only run", () => {
  const report = merge({ ...base, scan: scanFixture() });
  it("validates as a report", () => validateReport(report));
  it("never exceeds AGENT_CAPABLE", () => {
    for (const s of report.stages) assert.notEqual(s.state, "AGENT_VERIFIED");
  });
  it("captcha caps signup at HUMAN_REQUIRED and marks it BLOCKED via probe fail", () => {
    assert.equal(byId(report, "signup").state, "BLOCKED");
  });
  it("stages with no votes are NOT_TESTED", () => {
    assert.equal(byId(report, "use").state, "NOT_TESTED");
    assert.equal(byId(report, "manage").state, "NOT_TESTED");
  });
  it("headline counts cleared stages up to the first non-clear", () => {
    assert.equal(byId(report, "discover").state, "AGENT_CAPABLE");
    assert.equal(byId(report, "understand").state, "HUMAN_REQUIRED"); // median of llms pass, cloudflare fail, agentgrade warn, seo 80
    assert.equal(report.headline.cleared, 1);
    assert.equal(report.headline.stalledAt, "web");
  });
});

describe("audit thresholds", () => {
  const report = merge({ ...base, audit: auditFixture() });
  it("maps 0-3 / 4-7 / 8-10 to BLOCKED / HUMAN_REQUIRED / AGENT_CAPABLE", () => {
    assert.equal(byId(report, "signup").state, "AGENT_CAPABLE");
    assert.equal(byId(report, "pay").state, "BLOCKED");
    assert.equal(byId(report, "use").state, "HUMAN_REQUIRED");
    assert.equal(byId(report, "manage").state, "BLOCKED");
  });
  it("dev_readiness becomes a band, not a stage", () => {
    assert.equal(report.devReadiness.band, "mid");
    assert.equal(report.devReadiness.score, 7);
  });
  it("hard blockers become high findings, quick wins low findings with fix", () => {
    const hb = report.findings.find((f) => f.text === "Plan change returns checkout_url" && f.provider === "audit");
    assert.equal(hb.severity, "high");
    const qw = report.findings.find((f) => f.text === "Add X-RateLimit-* headers");
    assert.equal(qw.severity, "low");
    assert.ok(qw.fix);
  });
});

describe("dedupe", () => {
  it("collapses the same wall described by two providers in one stage", () => {
    const audit = auditFixture();
    audit.hard_blockers = [{ area: "purchasing", text: "Plan change returns a checkout_url that requires a browser" }];
    audit.areas.purchasing.blocks = ["Plan change returns checkout_url that needs a browser"];
    const report = merge({ ...base, audit, crash: crashFixture() });
    const pay = report.findings.filter((f) => f.stage === "pay" && /checkout/i.test(f.text));
    assert.equal(pay.length, 1);
    assert.deepEqual([...pay[0].providers].sort(), ["audit", "crash"]);
    assert.equal(pay[0].provider, "crash"); // the one that acted supplies the wording
  });
  it("keeps distinct problems in the same stage apart", () => {
    const audit = auditFixture();
    audit.areas.usage_monitoring.blocks = ["no rate limit headers", "no usage endpoint with current-period data"];
    const report = merge({ ...base, audit });
    assert.equal(report.findings.filter((f) => f.stage === "use").length, 3); // two blocks plus the quick win
  });
});

describe("precedence", () => {
  it("crash (acted) overrides audit (judged)", () => {
    const audit = auditFixture();
    audit.areas.purchasing.score = 9; // audit says capable
    const report = merge({ ...base, audit, crash: crashFixture() });
    assert.equal(byId(report, "pay").state, "BLOCKED");
    assert.equal(byId(report, "signup").state, "AGENT_VERIFIED");
  });
  it("audit (judged) overrides scan (observed) except hard caps", () => {
    const report = merge({ ...base, scan: scanFixture(), audit: auditFixture() });
    assert.equal(byId(report, "signup").state, "HUMAN_REQUIRED"); // audit 8 → CAPABLE, capped by captcha
    assert.equal(byId(report, "pay").state, "BLOCKED");
  });
  it("unconfirmed browser block downgrades to HUMAN_REQUIRED with a note", () => {
    const crash = crashFixture();
    const pay = crash.flows.find((f) => f.id === "pay");
    delete pay.http;
    const report = merge({ ...base, crash });
    assert.equal(byId(report, "pay").state, "HUMAN_REQUIRED");
    assert.ok(byId(report, "pay").evidence.some((e) => e.note === "unconfirmed_browser_block"));
  });
  it("prior failing run confirms an otherwise unconfirmed block", () => {
    const crash = crashFixture();
    delete crash.flows.find((f) => f.id === "pay").http;
    const prev = historyLine(merge({ ...base, crash: crashFixture() }));
    const report = merge({ ...base, runId: "r2", crash, previous: [prev] });
    assert.equal(byId(report, "pay").state, "BLOCKED");
  });
});

describe("claims", () => {
  it("unclaimed pillar → NOT_APPLICABLE, excluded from headline, evidence suppressed", () => {
    const report = merge({ ...base, audit: auditFixture(), claims: { monetization: false } });
    for (const id of ["pay", "use", "manage"]) {
      assert.equal(byId(report, id).state, "NOT_APPLICABLE");
      assert.ok(byId(report, id).evidence.every((e) => e.suppressed));
    }
    assert.equal(report.headline.of, 4);
  });
});

describe("maturity", () => {
  it("caps at L1 when only web is claimed, even if verified", () => {
    const crash = crashFixture();
    crash.flows = crash.flows.map((f) => ({ ...f, result: "PASS", human_interventions: 0 }));
    crash.findings = [];
    assert.equal(merge({ ...base, crash, claims: { onboarding: false, monetization: false } }).maturity.level, 1);
  });
  it("L2 when signup+access capable but pay not", () => {
    assert.equal(merge({ ...base, audit: auditFixture() }).maturity.level, 2);
  });
  it("L4 when everything verified", () => {
    const crash = crashFixture();
    crash.flows = crash.flows.map((f) => ({ ...f, result: "PASS", human_interventions: 0 }));
    crash.findings = [];
    assert.equal(merge({ ...base, crash }).maturity.level, 4);
  });
  it("flags disagreement of ≥2 with audit", () => {
    const audit = auditFixture({ maturity: 4 });
    const report = merge({ ...base, audit });
    assert.ok(report.findings.some((f) => f.ref === "merge:maturity_disagreement"));
  });
});

describe("delta", () => {
  it("reports stage transitions and fixed/new findings by id", () => {
    const r1 = merge({ ...base, audit: auditFixture(), crash: crashFixture() });
    const audit2 = auditFixture();
    audit2.areas.purchasing = { score: 9, today: "POST /subscriptions with saved PM", blocks: [], build: "none", effort: "S" };
    audit2.hard_blockers = [];
    const crash2 = crashFixture();
    crash2.flows.find((f) => f.id === "pay").result = "PASS";
    crash2.findings = [];
    const r2 = merge({ ...base, runId: "r2", audit: audit2, crash: crash2, previous: [historyLine(r1)] });
    const pay = r2.delta.stages.find((s) => s.id === "pay");
    assert.equal(pay.from, "BLOCKED");
    assert.equal(pay.to, "AGENT_VERIFIED");
    assert.equal(pay.direction, "up");
    assert.ok(r2.delta.findings.fixed.length >= 2);
    assert.equal(r2.delta.findings.new.length, 0);
    assert.equal(r2.delta.headline.from.cleared, 4);
    // Use comes before Pay, and Use was not tested, so clearing Pay does not move the stall point.
    assert.equal(r2.delta.headline.to.cleared, 4);
    assert.equal(r2.headline.stalledStage, "use");
  });
  it("scan-only follow-up never marks audit findings fixed", () => {
    const r1 = merge({ ...base, scan: scanFixture(), audit: auditFixture() });
    const r2 = merge({ ...base, runId: "r2", scan: scanFixture(), previous: [historyLine(r1)] });
    const fixedProviders = r2.delta.findings.fixed.map((id) => r1.findings.find((f) => f.id === id).provider);
    assert.ok(fixedProviders.every((p) => p === "scan"));
  });
});

describe("what a probe failure is allowed to decide", () => {
  const scanWith = (probes) => scanFixture({ probes, aeo: null });

  it("a missing agent.json is a finding, not a wall across discover", () => {
    const report = merge({ ...base, scan: scanWith([
      { id: "robots_ai", status: "pass", detail: "AI bots allowed" },
      { id: "agent_json", status: "fail", detail: "no agent manifest at /.well-known/agent.json" },
    ]) });
    assert.equal(byId(report, "discover").state, "AGENT_CAPABLE", "crawlability decides discover");
    assert.ok(report.findings.some((f) => f.ref === "scan:probe:agent_json"), "the gap is still reported");
  });

  it("an undeclared robots.txt does not mean a person is needed", () => {
    const report = merge({ ...base, scan: scanWith([
      { id: "robots_ai", status: "warn", detail: "robots.txt has no explicit rules for AI bots (allowed by default, undeclared)", data: { allowed: true } },
    ]) });
    assert.equal(byId(report, "discover").state, "AGENT_CAPABLE");
  });

  it("robots.txt that blocks AI agents still blocks discover", () => {
    const report = merge({ ...base, scan: scanWith([
      { id: "robots_ai", status: "fail", detail: "robots.txt blocks AI agents: GPTBot, ClaudeBot, CCBot" },
    ]) });
    assert.equal(byId(report, "discover").state, "BLOCKED");
  });
});

describe("a history line written in the old step order", () => {
  it("compares with the earlier run's stages counted in the current order, so an unchanged run is not a regression", () => {
    const audit = auditFixture();
    audit.areas.purchasing = { score: 9, today: "POST /subscriptions with saved PM", blocks: [], build: "none", effort: "S" };
    audit.hard_blockers = [];
    const crash = crashFixture();
    crash.flows.find((f) => f.id === "pay").result = "PASS";
    crash.findings = [];
    const before = merge({ ...base, audit, crash });
    // 0.4.2 counted Pay before Use, so the same states gave 5 cleared, not 4.
    const oldLine = { ...historyLine(before), headline: { cleared: 5, of: 7, stalledAt: "pay" } };
    const after = merge({ ...base, runId: "r2", audit, crash, previous: [oldLine] });
    assert.equal(after.delta.stages.filter((s) => s.direction !== "same").length, 0);
    assert.deepEqual(after.delta.headline.from, { cleared: after.headline.cleared, of: after.headline.of, stalledAt: after.headline.stalledAt });
  });
  it("still validates a saved report that lists pay before use", () => {
    const report = merge({ ...base, audit: auditFixture(), crash: crashFixture() });
    const old = { ...report, stages: [...report.stages].sort((a, b) => (a.id === "pay" && b.id === "use" ? -1 : a.id === "use" && b.id === "pay" ? 1 : 0)) };
    assert.equal(old.stages.findIndex((s) => s.id === "pay") < old.stages.findIndex((s) => s.id === "use"), true);
    assert.doesNotThrow(() => validateReport(old));
    assert.throws(() => validateReport({ ...report, stages: [...report.stages.slice(0, 6), report.stages[0]] }), /each of/);
  });
});
