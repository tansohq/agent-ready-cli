// Secret boundary. Credentials enter only from the environment of the harness process, are handed to the executor
// child as its own env, and are never written to disk or logged. Everything that leaves the executor passes through
// the redactor, which knows the actual values as well as the generic key patterns.

const GENERIC = [
  /(sk|rk|rkcs|pk|whsec)_(test|live)_[A-Za-z0-9]+/g,
  /\bam_[A-Za-z0-9]{12,}/g,
  /\bKEY[A-Za-z0-9_-]{12,}\b/g,
  /\bwhisper-[A-Za-z0-9_-]{8,}/g,
  /\bre_[A-Za-z0-9_-]{10,}\b/g,
  /\bmoltbook_(?!claim_)[A-Za-z0-9_-]{8,}/g,
  /\bea_live_[a-f0-9]{16,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /Bearer\s+[A-Za-z0-9._-]{16,}/g,
];

// Secrets a product returned to the agent: values of JSON fields whose names say they are secret. Read from each
// full line of agent output before anything is written, because the agent may never file them in CREDENTIAL.env
// (it stopped, was stopped, or ignored the instruction) and the event log keeps only the start of each result:
// with curl -i the headers fill it and the body holding the key is cut off. Quotes may arrive escaped (\").
const SECRET_FIELD = /\\?"((?:[a-z]+_)*(?:api_?key|key|token|secret|password|claim_?code|claim_?url|verification_code|client_secret)|apiKey|accessToken|refreshToken|claimCode|claimUrl|clientSecret)\\?"\s*:\s*\\?"([^"\\\s]{8,})\\?"/gi;
// The same for links: a one-time sign-in or claim link carries its secret as a URL parameter (Telnyx's emails had
// ?token=…, Cosmic's ?token=agk_…). Values shorter than 12 characters are left alone so page numbers survive.
const SECRET_PARAM = /[?&](token|code|key|claim|claim_token|otp|signature|sig|auth|magic|access_token|portal_redirect_token)=([^&\s"'<>\\]{12,})/gi;
export function secretsInText(text) {
  const t = String(text ?? "");
  return [...new Set([...[...t.matchAll(SECRET_FIELD)].map((m) => m[2]), ...[...t.matchAll(SECRET_PARAM)].map((m) => m[2])])];
}

export function resolveCredentials(task, env = process.env) {
  const injected = {};
  const missing = [];
  const rejected = [];
  for (const c of task.credentials || []) {
    const value = env[c.env];
    if (!value) {
      missing.push(c.env);
      continue;
    }
    if (c.test && !c.test.test(value)) {
      rejected.push({ env: c.env, reason: c.rejectReason || "value does not match the required pattern" });
      continue;
    }
    injected[c.injectAs] = value;
  }
  const values = Object.values(injected);
  // Values learned later (a key the agent obtained itself) join the redactor for every write that follows.
  const learn = (v) => {
    if (v && !values.includes(v)) values.push(v);
  };
  const redact = (text) => {
    let out = String(text ?? "");
    for (const v of values) out = out.split(v).join("<redacted>");
    // Keep only a type marker (sk_test_, rk_live_, KEY, whisper-, …), never a usable segment of the value.
    for (const re of GENERIC) out = out.replace(re, (m) => (m.match(/^(?:sk|rk|pk|whsec)_(?:test|live)_/) || m.match(/^[A-Za-z]{2,8}[_-]/) || [m.slice(0, 3)])[0] + "…redacted");
    return out;
  };
  // Child env: the parent's PATH etc., minus any variable that held a secret under its original name.
  const childEnv = { ...env, ...injected };
  for (const c of task.credentials || []) delete childEnv[c.env];
  delete childEnv.CLAUDECODE;
  return { available: Object.keys(injected), missing, rejected, childEnv, redact, learn, has: (injectAs) => injectAs in injected, value: (injectAs) => injected[injectAs] };
}
