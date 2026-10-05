import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractOpenApi } from "../src/interface/extract.js";
import { evaluateAuthentication, deriveCapabilities } from "../src/interface/evaluate.js";

const apiKey = { type: "apiKey", in: "header", name: "X-Api-Key" };
const keySecurity = [{ apiKey: [] }];

function inspect(spec, { authPage = false } = {}) {
  const observations = [{ id: "obs_spec", role: "openapi", ok: true, url: "https://example.com/openapi.json" }];
  if (authPage) observations.push({ id: "obs_auth", role: "auth", ok: true });
  const bodies = new Map([["obs_spec", { html: false, text: typeof spec === "string" ? spec : JSON.stringify(spec) }]]);
  const x = { openapi: extractOpenApi(observations, bodies), mentions: { auth: [] } };
  return { x, auth: evaluateAuthentication(x, observations), capabilities: deriveCapabilities(x) };
}

function document(fields = {}, operation = {}) {
  return { openapi: "3.1.0", info: { title: "Example", version: "1" }, paths: { "/items": { get: { responses: { 200: {} }, ...operation } } }, ...fields };
}

describe("OpenAPI authentication requirements", () => {
  it("keeps absent requirements unknown even when an authentication page is linked", () => {
    const { auth, x } = inspect(document(), { authPage: true });
    assert.equal(x.openapi.value.globalSecurityDeclared, false);
    assert.equal(auth.requirement.value, "not_declared");
    assert.equal(auth.requirement.operations[0].source, "absent");
    assert.equal(auth.agentCanUnderstandSetup.verdict, "unknown");
    assert.match(auth.agentCanUnderstandSetup.reason, /not been verified live/);
    assert.deepEqual(auth.requirement.basedOn, ["obs_spec"]);
    assert.deepEqual(auth.friction, []);
  });

  it("does not apply unused scheme definitions to operations", () => {
    const { auth } = inspect(document({ components: { securitySchemes: { apiKey } } }), { authPage: true });
    assert.equal(auth.methods[0].type, "apiKey");
    assert.equal(auth.requirement.value, "not_declared");
    assert.equal(auth.agentCanUnderstandSetup.verdict, "unknown");
    assert.deepEqual(auth.requirement.operations[0].schemeNames, []);
  });

  it("inherits global requirements and keeps setup separate from verified access", () => {
    const spec = document({ components: { securitySchemes: { apiKey } }, security: keySecurity });
    const { auth } = inspect(spec, { authPage: true });
    assert.equal(auth.requirement.value, "required");
    assert.equal(auth.requirement.operations[0].source, "global");
    assert.deepEqual(auth.requirement.operations[0].schemeNames, ["apiKey"]);
    assert.equal(auth.agentCanUnderstandSetup.verdict, "yes");
    assert.match(auth.agentCanUnderstandSetup.reason, /not verified live/);
    assert.equal(inspect(spec).auth.agentCanUnderstandSetup.verdict, "partial");
  });

  it("distinguishes an empty global list from an explicit operation override", () => {
    const globalEmpty = inspect(document({ security: [] }));
    assert.equal(globalEmpty.x.openapi.value.globalSecurityDeclared, true);
    assert.deepEqual(globalEmpty.x.openapi.value.globalSecurity, []);
    assert.equal(globalEmpty.auth.requirement.value, "not_declared");
    const overridden = inspect(document({ components: { securitySchemes: { apiKey } }, security: keySecurity }, { security: [] }));
    assert.equal(overridden.auth.requirement.value, "none");
    assert.equal(overridden.auth.requirement.operations[0].source, "operation");
    assert.equal(overridden.auth.agentCanUnderstandSetup.verdict, "yes");
    assert.match(overridden.auth.agentCanUnderstandSetup.reason, /not verified live/);
  });

  it("replaces global requirements with an operation requirement", () => {
    const bearer = { type: "http", scheme: "bearer" };
    const { auth } = inspect(document({ components: { securitySchemes: { bearer } }, security: [{ missingGlobalScheme: [] }] }, { security: [{ bearer: [] }] }));
    assert.equal(auth.requirement.value, "required");
    assert.deepEqual(auth.requirement.operations[0].schemeNames, ["bearer"]);
  });

  it("recognizes explicit anonymous alternatives without requiring a credential", () => {
    for (const security of [[{}], [{}, ...keySecurity]]) {
      const { auth } = inspect(document({ components: { securitySchemes: { apiKey } }, security }));
      assert.equal(auth.requirement.value, "none");
      assert.equal(auth.agentCanUnderstandSetup.verdict, "yes");
      assert.deepEqual(auth.friction, []);
    }
  });

  it("retains mixed public and protected operations", () => {
    const spec = document({ components: { securitySchemes: { apiKey } }, security: keySecurity });
    spec.paths["/public"] = { get: { security: [], responses: { 200: {} } } };
    const { auth } = inspect(spec, { authPage: true });
    assert.equal(auth.requirement.value, "mixed");
    assert.deepEqual(auth.requirement.operations.map((o) => [o.operation, o.value]), [["GET /items", "required"], ["GET /public", "none"]]);
    assert.equal(auth.agentCanUnderstandSetup.verdict, "yes");
  });

  it("does not treat a partly undeclared API as fully understood", () => {
    const spec = document();
    spec.paths["/public"] = { get: { security: [], responses: { 200: {} } } };
    assert.equal(inspect(spec).auth.requirement.value, "unknown");
  });

  it("reports undefined schemes and unresolved scheme references as unknown", () => {
    for (const schemes of [{}, { apiKey: { $ref: "./auth.json#/apiKey" } }, { apiKey: { type: "http" } }]) {
      const { auth } = inspect(document({ components: { securitySchemes: schemes }, security: keySecurity }), { authPage: true });
      assert.equal(auth.requirement.value, "unknown");
      assert.equal(auth.agentCanUnderstandSetup.verdict, "unknown");
      assert.match(auth.requirement.operations[0].reason, /missing, unresolved, or unsupported/);
    }
  });

  it("preserves malformed security instead of converting it to absence", () => {
    for (const security of [null, {}, [null], [{ apiKey: "invalid" }]]) {
      const { auth, x } = inspect(document({ security }));
      assert.equal(x.openapi.value.globalSecurityDeclared, true);
      assert.equal(auth.requirement.value, "unknown");
    }
  });

  it("does not infer public access from unparsed, empty, or referenced paths", () => {
    for (const spec of ["openapi: 3.1.0\npaths: {}", document({ paths: {} }), document({ paths: { "/items": { $ref: "./items.json" } } }), document({ paths: { "/items": { $ref: "./items.json", get: { security: [] } } } })]) {
      const { auth } = inspect(spec);
      assert.equal(auth.requirement.value, "unknown");
      assert.equal(auth.agentCanUnderstandSetup.verdict, "unknown");
    }
  });

  it("keeps truncated operation coverage unknown", () => {
    const paths = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`/items/${i}`, { get: { security: [] } }]));
    paths["/items/200"].get.security = keySecurity;
    const { auth, x } = inspect(document({ paths, components: { securitySchemes: { apiKey } } }));
    assert.equal(x.openapi.value.endpoints.length, 200);
    assert.equal(x.openapi.value.endpointCount, 201);
    assert.equal(auth.requirement.value, "unknown");
    assert.match(auth.requirement.reason, /incomplete/);
  });

  it("includes HEAD, OPTIONS and TRACE when evaluating coverage", () => {
    const { auth } = inspect(document({ components: { securitySchemes: { apiKey } }, paths: { "/items": { get: { security: [] }, head: { security: keySecurity }, options: { security: [] }, trace: { security: [] } } } }));
    assert.equal(auth.requirement.value, "mixed");
    assert.equal(auth.requirement.operations.length, 4);
  });
});

describe("OpenAPI capability names", () => {
  it("uses the two Tanso operation summaries instead of one untagged group", () => {
    const spec = document({ paths: {
      "/api/agent": { get: { operationId: "getTansoInformation", summary: "Read public product information" } },
      "/api/evaluation-request": { post: { operationId: "requestTansoEvaluation", summary: "Request an evaluation with the person’s permission", description: "Not signup or purchase." } },
    } });
    const { capabilities, auth } = inspect(spec);
    assert.deepEqual(capabilities.map((c) => c.name), ["Read public product information", "Request an evaluation with the person’s permission"]);
    assert.deepEqual(capabilities[0].operations, ["GET /api/agent"]);
    assert.equal(capabilities[1].description, "Not signup or purchase.");
    assert.equal(capabilities[0].evidence[0].obs, "obs_spec");
    assert.equal(capabilities[0].operationDetails[0].operationId, "getTansoInformation");
    assert.equal(auth.requirement.value, "not_declared");
  });

  it("falls back to operation ID and then method/path", () => {
    assert.equal(inspect(document({}, { operationId: "listItems" })).capabilities[0].name, "listItems");
    assert.equal(inspect(document()).capabilities[0].name, "GET /items");
  });

  it("keeps tagged groups compatible while preserving summaries and descriptions", () => {
    const { capabilities } = inspect(document({ tags: [{ name: "items", description: "Item management" }] }, { tags: ["items"], summary: "List items", description: "Retrieve all catalog items." }));
    assert.equal(capabilities[0].name, "items");
    assert.equal(capabilities[0].description, "Item management");
    assert.deepEqual(capabilities[0].operations, ["GET /items"]);
    assert.equal(capabilities[0].operationDetails[0].summary, "List items");
    assert.equal(capabilities[0].operationDetails[0].description, "Retrieve all catalog items.");
    assert.equal(inspect(document({}, { tags: ["items"], summary: "List items" })).capabilities[0].description, "List items");
  });
});
