import { mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// The agent's mailbox is a directory: work/inbox/<n>-<message_id>.json. Whoever fills it is a provider.
// agentmail-rest: the harness polls AgentMail (key stays in the harness, never in the agent's env).
// relay: someone outside the process drops files in (used when no API key is available; the operator relays).
// The agent only ever sees files, so swapping providers changes nothing on its side.

const API = "https://api.agentmail.to/v0";

export function inboxDir(workDir) {
  return join(workDir, "inbox");
}

export async function createInbox({ runId, provider, key, redact }) {
  if (provider === "relay") return { provider, email: null, inboxId: null, note: "inbox created outside the harness; pass --inbox <address>" };
  const res = await fetch(`${API}/inboxes`, { method: "POST", signal: AbortSignal.timeout(30_000), headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ display_name: "Agent Ready Test", client_id: `agent-ready-${runId}`, metadata: { agent_ready_run: runId } }) });
  const body = await res.json();
  if (!res.ok) throw new Error(`agentmail create inbox ${res.status}: ${redact(JSON.stringify(body)).slice(0, 200)}`);
  return { provider, email: body.email, inboxId: body.inbox_id };
}

function writeMessage(workDir, seen, m) {
  if (seen.has(m.message_id)) return false;
  seen.add(m.message_id);
  const dir = inboxDir(workDir);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${String(seen.size).padStart(3, "0")}-${m.message_id.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
  writeFileSync(file, JSON.stringify({ message_id: m.message_id, from: m.from, to: m.to, subject: m.subject ?? null, timestamp: m.timestamp, text: m.text ?? m.extracted_text ?? null, html: m.html ?? null }, null, 2));
  return true;
}

// Poll until stopped. Returns the list of messages delivered (headers only) for the trace.
export function startPolling({ workDir, inbox, key, intervalMs = 15000, log = () => {} }) {
  const seen = new Set();
  const delivered = [];
  let stopped = false;
  async function tick() {
    if (stopped || inbox.provider !== "agentmail-rest") return;
    try {
      const res = await fetch(`${API}/inboxes/${encodeURIComponent(inbox.inboxId)}/messages?limit=20`, { signal: AbortSignal.timeout(30_000), headers: { authorization: `Bearer ${key}` } });
      const body = await res.json();
      for (const item of (body.messages || []).slice().reverse()) {
        if (seen.has(item.message_id)) continue;
        const full = await (await fetch(`${API}/inboxes/${encodeURIComponent(inbox.inboxId)}/messages/${encodeURIComponent(item.message_id)}`, { signal: AbortSignal.timeout(30_000), headers: { authorization: `Bearer ${key}` } })).json();
        if (writeMessage(workDir, seen, full)) {
          delivered.push({ message_id: full.message_id, from: full.from, subject: full.subject ?? null, timestamp: full.timestamp });
          log({ kind: "mail", from: full.from, subject: full.subject ?? "" });
        }
      }
    } catch (err) {
      log({ kind: "mail_error", text: String(err.message) });
    }
  }
  const timer = setInterval(tick, intervalMs);
  tick();
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
      // Relay mode: whatever was dropped in by hand counts as delivered.
      if (inbox.provider === "relay" && existsSync(inboxDir(workDir))) for (const f of readdirSync(inboxDir(workDir))) delivered.push({ file: f });
      return delivered;
    },
  };
}

export async function deleteInbox({ inbox, key }) {
  if (inbox.provider !== "agentmail-rest" || !inbox.inboxId) return false;
  const res = await fetch(`${API}/inboxes/${encodeURIComponent(inbox.inboxId)}`, { method: "DELETE", signal: AbortSignal.timeout(30_000), headers: { authorization: `Bearer ${key}` } });
  return res.ok;
}
