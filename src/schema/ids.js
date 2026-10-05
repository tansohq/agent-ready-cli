import { createHash } from "node:crypto";

// Same defect reported by scan, audit and crash collapses to one id: the id is the stage plus the normalized text.
export function normalizeText(text) {
  return String(text)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^a-z]+/g, "");
}

export function findingId(stage, text) {
  return createHash("sha1").update(`${stage}|${normalizeText(text)}`).digest("hex").slice(0, 10);
}

const STOP = new Set("a an and are as at be but by for from has have in into is it its no not of on or that the there this to with without you your can cannot".split(" "));

// Significant words of a finding, for near-duplicate detection.
export function tokens(text) {
  return new Set(
    String(text)
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[^a-z0-9/_.-]+/g, " ")
      .split(" ")
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

export function similarity(a, b) {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared += 1;
  return shared / Math.min(x.size, y.size);
}

export function runId(date = new Date()) {
  const stamp = date.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const salt = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${salt}`;
}
