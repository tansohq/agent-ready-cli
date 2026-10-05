// WebVTT captions for the recorded cuts, derived from the same timings the pages play with, so the
// burned-in text and the <track> agree. Also a plain transcript for the page's markdown twin.

function ts(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const f = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(f).padStart(3, "0")}`;
}

function vtt(cues) {
  return `WEBVTT\n\n${cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join("\n")}`;
}

// Hero: scenes carry their own hold; the page starts 500 ms after load. Quote and fail scenes have no
// caption on screen, so the VTT carries the agent's line and the response code there instead.
export function heroCaptions(scenes, { lead = 500, quote = "", failText = "", speed = 1 } = {}) {
  const cues = [];
  let t = lead;
  for (const s of scenes) {
    const hold = s.hold / speed;
    const text = s.cap || (s.id === "quote" ? `“${quote}”` : s.id === "fail" ? failText : "");
    const last = cues[cues.length - 1];
    if (text && last && last.text === text && last.end === t - 100) last.end = t + hold - 100;
    else if (text) cues.push({ start: t, end: t + hold - 100, text });
    t += hold;
  }
  return { vtt: vtt(cues), transcript: cues.map((c) => c.text).join("\n"), durationMs: t };
}

// Replay: each frame types its request (28 ms/char by default), waits 350 ms, shows the response, waits 450 ms,
// shows the quote, then holds. The page starts 700 ms after load.
export function replayCaptions(frames, { lead = 700, typeMs = 28, holdMs = 2600 } = {}) {
  const cues = [];
  let t = lead;
  for (const f of frames) {
    const typed = f.request ? f.request.length * typeMs : 0;
    const shown = t + typed + 350;
    const quoteAt = shown + 450;
    const end = quoteAt + holdMs;
    const head = `${f.label}${f.status != null ? ` · ${f.status}` : ""}`;
    if (f.quote) {
      cues.push({ start: t, end: quoteAt - 50, text: head });
      cues.push({ start: quoteAt, end: end - 100, text: f.quote });
    } else {
      cues.push({ start: t, end: end - 100, text: head });
    }
    t = end;
  }
  return { vtt: vtt(cues), transcript: cues.map((c) => c.text).join("\n"), durationMs: t };
}
