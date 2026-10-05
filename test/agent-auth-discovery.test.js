import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateMachineAccess } from "../src/interface/evaluate.js";

// Publishing prose for agents and publishing a machine path to it are different
// things. A product can do the first and leave the second missing, and only the
// second works for an agent that has not been told where to look.
//
// The first version of this rule answered "no" whenever one host lacked
// resource metadata, which scored Neon and Cloudflare as ignoring a convention
// they helped establish: auth.md belongs on the service root and the metadata on
// the API host, and only one host is ever inspected. A measurement that cannot
// see the other host must say so rather than report an absence.

const obs = (over) => ({ id: "obs_01", role: "homepage", url: "https://example.com/", ok: true, status: 200, ...over });
const x = { llmsTxt: null, agentJson: null, robots: null, mentions: { auth: [] } };
const rule = (observations) => evaluateMachineAccess(x, observations).agentAuthDiscoverable;

describe("agent auth discoverability", () => {
  it("is yes only when a refusal names metadata that is actually served", () => {
    const r = rule([
      obs({ id: "obs_01", status: 401, ok: false, wwwAuthenticate: 'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource"' }),
      obs({ id: "obs_02", role: "prm", url: "https://example.com/.well-known/oauth-protected-resource" }),
    ]);
    assert.equal(r.verdict, "yes");
    assert.deepEqual(r.basedOn, ["obs_01", "obs_02"]);
  });

  it("is partial when metadata exists but nothing fetched was protected", () => {
    const r = rule([obs({ id: "obs_02", role: "prm", url: "https://example.com/.well-known/oauth-protected-resource" })]);
    assert.equal(r.verdict, "partial");
    assert.match(r.reason, /nothing fetched was protected/, "a limit of reading public pages, not a gap in the product");
  });

  it("says so when the resource was asked without a credential and did not name its metadata", () => {
    const r = rule([
      obs({ id: "obs_02", role: "prm", url: "https://example.com/.well-known/oauth-protected-resource" }),
      obs({ id: "obs_07", role: "resource_challenge", url: "https://api.example.com/", status: 200 }),
    ]);
    assert.equal(r.verdict, "partial");
    assert.match(r.reason, /answered 200 without naming its metadata/, "this one is a gap in the product");
    assert.deepEqual(r.basedOn, ["obs_02", "obs_07"]);
  });

  it("is unknown, not no, when auth.md is served and the metadata would be on another host", () => {
    const r = rule([obs({ id: "obs_03", role: "auth", url: "https://example.com/auth.md" })]);
    assert.equal(r.verdict, "unknown", "a product following the convention must not read as ignoring it");
    assert.match(r.reason, /was not inspected/);
  });

  it("is no only when the host documents none of it", () => {
    assert.equal(rule([obs({})]).verdict, "no");
  });

  it("does not mistake an unrelated auth page for an auth.md file", () => {
    // /auth is a sign-in page for people; /auth.md is the agent convention.
    const r = rule([obs({ id: "obs_04", role: "auth", url: "https://example.com/auth" })]);
    assert.equal(r.verdict, "no");
  });
});
