import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildInterface } from "../src/interface/index.js";
import { validateInterface } from "../src/interface/schema.js";
import { runJourney } from "../src/interface/journey.js";

import { FULL, BARE, PUBLIC_SITE, serve } from "./interface-fixtures.js";

let full;
let bare;
let publicSite;
before(async () => {
  full = await serve(FULL);
  bare = await serve(BARE);
  publicSite = await serve(PUBLIC_SITE);
});
after(() => {
  full.server.close();
  bare.server.close();
  publicSite.server.close();
});

describe("interface: full product", () => {
  it("extracts facts with evidence that points at real observations", async () => {
    const doc = await buildInterface({ url: full.base, version: "test" });
    validateInterface(doc);
    assert.equal(doc.product.name.value, "Acme API");
    assert.equal(doc.product.category.value, "widgets");
    const ids = new Set(doc.observations.map((o) => o.id));
    assert.ok(doc.product.name.evidence.every((e) => ids.has(e.obs)));
    assert.equal(doc.interfaces.api.exists.verdict, "yes");
    assert.equal(doc.interfaces.api.discoverableFromDocs.verdict, "yes");
    assert.equal(doc.interfaces.mcp.exists.verdict, "yes");
    assert.equal(doc.interfaces.cli.exists.verdict, "yes");
    assert.match(doc.interfaces.cli.installCommands[0].command, /npm install -g acme-cli/);
    assert.equal(doc.authentication.methods[0].type, "apiKey");
    assert.equal(doc.authentication.agentCanUnderstandSetup.verdict, "yes");
    assert.equal(doc.pricing.agentCanDetermineCost.verdict, "yes");
    assert.equal(doc.pricing.plans[0].amount, 20);
    assert.ok(doc.pricing.ambiguities.some((a) => /contact sales/.test(a.text)));
    assert.equal(doc.capabilities[0].name, "widgets");
    assert.deepEqual(doc.capabilities[0].operations, ["GET /v1/widgets", "POST /v1/widgets"]);
    assert.equal(doc.machineAccess.aiCrawlersAllowed.verdict, "yes");
    // agentJourneys was a placeholder that always returned [], which reads as a
    // measurement of zero rather than an absent one. Task stages are measured by
    // POST /v1/evaluate; the interface document must not imply it tested them.
    assert.equal("agentJourneys" in doc, false);
  });

  it("records how each page was found", async () => {
    const doc = await buildInterface({ url: full.base, version: "test" });
    // /auth.md is probed as a well-known path, so select the page that was
    // reached by following a link: provenance is the subject here, not the role.
    const auth = doc.observations.find((o) => o.role === "auth" && o.discoveredVia.kind === "link");
    assert.ok(auth, "a linked auth page should still be discovered by link");
    assert.equal(auth.discoveredVia.kind, "link");
    assert.equal(doc.observations.find((o) => o.id === auth.discoveredVia.from).role, "homepage");
    assert.equal(doc.observations.find((o) => o.role === "robots").discoveredVia.kind, "well_known");
  });
});

describe("interface: bare site", () => {
  it("returns unknown instead of guessing", async () => {
    const doc = await buildInterface({ url: bare.base, version: "test" });
    validateInterface(doc);
    assert.equal(doc.product.name.value, "Bare");
    assert.equal(doc.product.description, null);
    assert.equal(doc.product.category, null);
    assert.equal(doc.interfaces.api.exists.verdict, "unknown");
    assert.equal(doc.interfaces.mcp.exists.verdict, "unknown");
    assert.equal(doc.pricing.agentCanDetermineCost.verdict, "unknown");
    assert.equal(doc.authentication.agentCanUnderstandSetup.verdict, "unknown");
    assert.equal(doc.machineAccess.aiCrawlersAllowed.verdict, "partial");
    assert.ok(doc.unknowns.some((u) => u.field === "product.category"));
    assert.ok(doc.unknowns.some((u) => u.field === "interfaces.api.exists"));
  });
});

describe("journey", () => {
  it("asks for a specific task rather than failing a generic integration request", async () => {
    const doc = await buildInterface({ url: full.base, version: "test" });
    const j = runJourney(doc, "Integrate this product into an application");
    assert.equal(j.failure, null);
    assert.equal(j.stages.find((s) => s.stage === "understand").status, "needs_input");
    assert.deepEqual(j.unresolved[0].suggestions, ["widgets"]);
    assert.equal(j.reached.stoppedAt, null);
  });

  it("shows meaningful public-site actions and keeps undeclared auth unresolved", async () => {
    const doc = await buildInterface({ url: publicSite.base, version: "test" });
    assert.deepEqual(doc.capabilities.map((c) => c.name), ["Read public product information", "Request an evaluation with the person's permission"]);
    assert.equal(doc.authentication.requirement.value, "not_declared");
    const j = runJourney(doc, "Read public product information");
    assert.equal(j.stages.find((s) => s.stage === "understand").status, "success");
    assert.equal(j.stages.find((s) => s.stage === "authenticate").status, "unknown");
    assert.equal(j.failure, null);
    assert.equal(j.unresolved[0].stage, "authenticate");
    assert.deepEqual(j.notRun, ["acquire_credential", "execute", "recover"]);
  });

  it("does not apply API authentication evidence to an MCP task", async () => {
    const doc = await buildInterface({ url: full.base, version: "test" });
    const j = runJourney(doc, "Use MCP to list widgets");
    assert.equal(j.stages.find((s) => s.stage === "choose_interface").chosen, "mcp");
    assert.equal(j.stages.find((s) => s.stage === "authenticate").status, "unknown");
  });

  it("stops at authenticate when no method is established, and never runs execute", async () => {
    const doc = await buildInterface({ url: bare.base, version: "test" });
    const j = runJourney(doc, "Integrate this product into an application");
    assert.equal(j.stages[0].status, "failed");
    assert.equal(j.failure.stage, "discover");
    assert.ok(j.failure.basedOn.length);
    assert.deepEqual(j.notRun, ["acquire_credential", "execute", "recover"]);
    const full1 = await buildInterface({ url: full.base, version: "test" });
    const j2 = runJourney(full1, "Use the MCP server to list widgets");
    assert.equal(j2.stages.find((s) => s.stage === "choose_interface").chosen, "mcp");
    const j3 = runJourney(full1, "Send invoices");
    assert.equal(j3.failure, null);
    assert.equal(j3.stages.find((s) => s.stage === "understand").status, "unknown");
    assert.equal(j3.unresolved[0].stage, "understand");
  });
});
