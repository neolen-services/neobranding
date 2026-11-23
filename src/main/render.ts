// Turns an animation page into a clip on this computer: the page is opened in a hidden window,
// stepped through one frame at a time, and each frame is handed to FFmpeg. Desktop app only.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrowserWindow } from "electron";
import { CLIP_FPS, STAGE } from "../shared/motion";

/**
 * Renders `page` (made with animationPage in "render" mode) for `seconds` and returns the MP4.
 * `ffmpeg` is the full path to FFmpeg. The window can run no code but the page's own stepping
 * script and can load nothing from anywhere. The temporary folder is removed before returning.
 */
export async function renderAnimation(page: string, seconds: number, ffmpeg: string): Promise<Buffer> {
  const work = await mkdtemp(join(tmpdir(), "render-"));
  const win = new BrowserWindow({
    show: false,
    width: STAGE.width,
    height: STAGE.height,
    useContentSize: true,
    frame: false,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, partition: "render" },
  });
  try {
    // Nothing is fetched: the page is complete in itself.
    win.webContents.session.webRequest.onBeforeRequest((details, done) => done({ cancel: !details.url.startsWith("file:") && !details.url.startsWith("data:") && !details.url.startsWith("devtools:") }));
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    win.setContentSize(STAGE.width, STAGE.height);
    const source = join(work, "scene.html");
    await writeFile(source, page, "utf8");
    await win.loadFile(source);

    const frames = Math.max(Math.round(seconds * CLIP_FPS), 1);
    const first = await frame(win, 0);
    const size = first.getSize();
    // Even sizes are required by the video format.
    const width = size.width - (size.width % 2);
    const height = size.height - (size.height % 2);
    const out = join(work, "clip.mp4");
    const encoder = spawn(
      ffmpeg,
      ["-y", "-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgra", "-s", `${size.width}x${size.height}`, "-r", String(CLIP_FPS), "-i", "-", "-vf", `crop=${width}:${height}:0:0`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out],
      { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] },
    );
    let complaint = "";
    encoder.stderr.on("data", (d) => (complaint += String(d)));
    const finished = new Promise<void>((done, failed) => {
      encoder.on("error", failed);
      encoder.on("close", (code) => (code === 0 ? done() : failed(new Error(complaint.trim().split("\n").pop() || "FFmpeg could not make the clip."))));
    });
    const send = (bitmap: Buffer) => new Promise<void>((done, failed) => encoder.stdin.write(bitmap, (e) => (e ? failed(e) : done())));

    await send(first.toBitmap());
    for (let i = 1; i < frames; i++) await send((await frame(win, i / CLIP_FPS)).toBitmap());
    encoder.stdin.end();
    await finished;
    return await readFile(out);
  } finally {
    win.destroy();
    await rm(work, { recursive: true, force: true });
  }
}

/** Sets the page to a moment, waits until it is drawn, and takes the picture. */
async function frame(win: BrowserWindow, seconds: number) {
  await win.webContents.executeJavaScript(`new Promise((done) => { window.__seek(${seconds}); requestAnimationFrame(() => requestAnimationFrame(() => done(true))); })`, true);
  return win.webContents.capturePage();
}
