import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { eventAccepted } from "../src/harness/tasks/tanso-oss.js";

// The task text names the events endpoint, and so does the runbook the agent reads. Only the call the agent
// actually made, and the 201 it got back, count as usage recorded — usage the upgrade hides from the summary.
describe("tanso-oss: usage recorded", () => {
  const line = (obj) => JSON.stringify(obj) + "\n";

  it("accepts a POST to the events endpoint that answered 201", () => {
    const trace =
      line({ message: { content: [{ type: "tool_use", id: "t1", input: { command: "curl -s -X POST http://localhost:8094/api/v1/client/events -H 'X-API-Key: ck_x'" } }] } }) +
      line({ message: { content: [{ type: "tool_result", tool_use_id: "t1", content: '201\n{"data":{"eventId":"e1"},"success":true}' }] } });
    assert.equal(eventAccepted(trace), true);
  });

  it("ignores the endpoint being named in the task text or the runbook", () => {
    const trace =
      line({ message: { content: [{ type: "tool_result", tool_use_id: "t0", content: "Record what you used: POST /api/v1/client/events returns 201" }] } });
    assert.equal(eventAccepted(trace), false);
  });

  it("does not count a POST that failed", () => {
    const trace =
      line({ message: { content: [{ type: "tool_use", id: "t2", input: { command: "curl -X POST http://localhost:8094/api/v1/client/events" } }] } }) +
      line({ message: { content: [{ type: "tool_result", tool_use_id: "t2", content: '400\n{"error":{"code":"validation_failed"}}' }] } });
    assert.equal(eventAccepted(trace), false);
  });

  it("survives a malformed trace line", () => {
    assert.equal(eventAccepted("not json\n"), false);
  });
});
