import { mkdirSync, renameSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Playwright is not a dependency of the npm package: only the browser and video commands need it.
async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (err) {
    if (err.code !== "ERR_MODULE_NOT_FOUND") throw err;
    throw new Error("This command drives a browser and needs Playwright: npm i -g playwright && npx playwright install chromium");
  }
}

// Records a demo page playing itself. Playwright writes webm; ffmpeg (Homebrew or Playwright's own
// bundled copy) turns it into an mp4 that drops straight into a slide deck or a social post.

function findFfmpeg() {
  const which = spawnSync("which", ["ffmpeg"], { encoding: "utf8" });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  const cache = join(process.env.HOME || "", "Library", "Caches", "ms-playwright");
  if (existsSync(cache)) {
    for (const d of readdirSync(cache).filter((n) => n.startsWith("ffmpeg-")).sort().reverse()) {
      for (const bin of ["ffmpeg-mac", "ffmpeg-mac-arm64", "ffmpeg-linux", "ffmpeg-win64.exe"]) {
        const p = join(cache, d, bin);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

export async function recordDemo({ htmlPath, outDir, width = 1280, height = 820, zoom = 1, stepMs = 700, holdMs = 2200, name = "demo", query = null, doneSelector = "#demo", letterbox = null, ground = "#f5f7f2" }) {
  const { chromium } = await loadPlaywright();
  const videoDir = join(outDir, "video");
  mkdirSync(videoDir, { recursive: true });
  const browser = await chromium.launch();
  // Record at the delivery frame itself. A page laid out for ~1200px is zoomed up to fill it, which keeps
  // text crisp; a device scale factor does not (Playwright draws the page at 1x inside the larger frame).
  const context = await browser.newContext({ viewport: { width, height }, recordVideo: { dir: videoDir, size: { width, height } } });
  const page = await context.newPage();
  await page.goto(`${pathToFileURL(htmlPath).href}?${query || `play=1&step=${stepMs}&hold=${holdMs}`}`, { waitUntil: "load" });
  if (zoom !== 1) await page.evaluate((z) => { document.body.style.zoom = String(z); }, zoom);
  await page.waitForTimeout(300);
  await page.waitForFunction((sel) => document.querySelector(sel)?.dataset.done === "1", doneSelector, { timeout: 300000 });
  await page.waitForTimeout(600);
  const video = page.video();
  await context.close();
  await browser.close();
  const raw = await video.path();
  const webm = join(videoDir, `${name}.webm`);
  renameSync(raw, webm);
  const ffmpeg = findFfmpeg();
  let mp4 = null;
  if (ffmpeg) {
    mp4 = join(videoDir, `${name}.mp4`);
    const vf = letterbox
      ? `scale=${letterbox.width}:${letterbox.height}:force_original_aspect_ratio=decrease,pad=${letterbox.width}:${letterbox.height}:(ow-iw)/2:(oh-ih)/2:color=${ground},setsar=1,fps=30`
      : "fps=30";
    const r = spawnSync(ffmpeg, ["-y", "-loglevel", "error", "-i", webm, "-vf", vf, "-c:v", "libx264", "-crf", "18", "-preset", "slow", "-g", "60", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4], { encoding: "utf8" });
    if (r.status !== 0) {
      rmSync(mp4, { force: true });
      mp4 = null;
    }
  }
  return { webm, mp4 };
}

// Cuts a range out of a clip as a VP9 webm. Playwright's Chromium cannot play h264, so any footage the hero
// page embeds has to go through this first.
export function trimToWebm({ input, outPath, from, to }) {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) throw new Error("ffmpeg not found: install it (brew install ffmpeg) or run `npx playwright install` to get Playwright's copy");
  const r = spawnSync(ffmpeg, ["-y", "-loglevel", "error", "-ss", String(from), "-i", input, "-t", String(to - from), "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "30", "-row-mt", "1", "-pix_fmt", "yuv420p", "-an", outPath], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.trim()}`);
  return outPath;
}

// Cuts the silent lead off a recorded cut so frame one is the title, not the empty ground.
export function trimHead(mp4, seconds) {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) throw new Error("ffmpeg not found");
  const tmp = mp4.replace(/\.mp4$/, ".trim.mp4");
  const r = spawnSync(ffmpeg, ["-y", "-loglevel", "error", "-ss", String(seconds), "-i", mp4, "-c:v", "libx264", "-crf", "18", "-preset", "slow", "-g", "60", "-pix_fmt", "yuv420p", "-movflags", "+faststart", tmp], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg trim failed: ${r.stderr}`);
  renameSync(tmp, mp4);
  return mp4;
}

// Hands a Playwright context option object to the smoke walk so the real browser session is recorded too.
export function recordVideoOptions(outDir, width = 1280, height = 900) {
  const videoDir = join(outDir, "video");
  mkdirSync(videoDir, { recursive: true });
  return { recordVideo: { dir: videoDir, size: { width, height } } };
}

export async function finalizeSmokeVideo(page, outDir, name = "smoke") {
  const video = page.video();
  if (!video) return null;
  const raw = await video.path();
  const webm = join(outDir, "video", `${name}.webm`);
  renameSync(raw, webm);
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) return { webm, mp4: null };
  const mp4 = join(outDir, "video", `${name}.mp4`);
  const r = spawnSync(ffmpeg, ["-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-r", "30", mp4], { encoding: "utf8" });
  return { webm, mp4: r.status === 0 ? mp4 : null };
}

// Joins any number of clips into one reel at a common frame size, padded on the demo's ground colour.
export function stitchReel({ clips, outPath, width = 1280, height = 860, ground = "#f5f7f2" }) {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) throw new Error("ffmpeg not found: install it (brew install ffmpeg) or run `npx playwright install` to get Playwright's copy");
  const existing = clips.filter((c) => existsSync(c));
  if (!existing.length) throw new Error("no clips to stitch");
  const inputs = existing.flatMap((c) => ["-i", c]);
  const chains = existing.map((_, i) => `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${ground},setsar=1,fps=30[v${i}]`);
  const concat = `${existing.map((_, i) => `[v${i}]`).join("")}concat=n=${existing.length}:v=1:a=0[out]`;
  const r = spawnSync(ffmpeg, ["-y", "-loglevel", "error", ...inputs, "-filter_complex", `${chains.join(";")};${concat}`, "-map", "[out]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outPath], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.trim()}`);
  return { outPath, clips: existing };
}

// Turns each mp4 in a folder into a webm (AV1 when the encoder exists, else VP9) and a poster JPEG from its
// first meaningful frame. Sizes stay small because these are screen recordings.
export function webExports(videoDir, { only = null } = {}) {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg || !existsSync(videoDir)) return [];
  const enc = spawnSync(ffmpeg, ["-hide_banner", "-encoders"], { encoding: "utf8" }).stdout || "";
  const codec = /libsvtav1/.test(enc) ? "libsvtav1" : /libvpx-vp9/.test(enc) ? "libvpx-vp9" : null;
  const out = [];
  for (const f of readdirSync(videoDir).filter((n) => n.endsWith(".mp4")).sort()) {
    const name = f.replace(/\.mp4$/, "");
    if (only && !only.includes(name)) continue;
    const mp4 = join(videoDir, f);
    const poster = join(videoDir, `${name}-poster.jpg`);
    spawnSync(ffmpeg, ["-y", "-loglevel", "error", "-ss", "1.2", "-i", mp4, "-frames:v", "1", "-q:v", "3", poster], { encoding: "utf8" });
    let webm = null;
    if (codec) {
      webm = join(videoDir, `${name}.webm`);
      const args = codec === "libsvtav1"
        ? ["-c:v", "libsvtav1", "-preset", "8", "-crf", "35", "-g", "60"]
        : ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "34", "-row-mt", "1", "-g", "60"];
      const r = spawnSync(ffmpeg, ["-y", "-loglevel", "error", "-i", mp4, ...args, "-pix_fmt", "yuv420p", "-an", webm], { encoding: "utf8" });
      if (r.status !== 0) { rmSync(webm, { force: true }); webm = null; }
    }
    out.push({ name, mp4, webm, poster, codec: webm ? codec : null });
  }
  return out;
}
