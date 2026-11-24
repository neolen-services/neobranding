// Draws a project's captions and text over the picture, for one moment of the video. The preview draws with it
// many times a second, and the export draws every change once and sends those pictures to FFmpeg, so the
// finished video shows exactly what the preview showed.
import { projectLength, type CaptionStyle, type EditCaption, type EditProject, type EditText, type OverlayFrame } from "@shared/edit";

const SANS = '"Inter Variable", system-ui, sans-serif';
const DISPLAY = '"Space Grotesk Variable", system-ui, sans-serif';

/** Splits text into lines no wider than `max` pixels. */
function wrap(ctx: CanvasRenderingContext2D, words: string[], max: number): string[][] {
  const lines: string[][] = [];
  let line: string[] = [];
  for (const w of words) {
    const next = [...line, w];
    if (line.length && ctx.measureText(next.join(" ")).width > max) {
      lines.push(line);
      line = [w];
    } else line = next;
  }
  if (line.length) lines.push(line);
  return lines;
}

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

export function drawCaption(ctx: CanvasRenderingContext2D, caption: EditCaption, style: CaptionStyle, t: number, W: number, H: number) {
  const words = caption.words.map((w) => (style.upper ? w.text.toUpperCase() : w.text));
  if (!words.length) return;
  const clean = style.name === "clean";
  const px = Math.round((clean ? 58 : style.name === "boxed" ? 66 : 78) * style.size * (W / 1080));
  ctx.font = `${clean ? 600 : 800} ${px}px ${SANS}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const lines = wrap(ctx, words, W * 0.82);
  const lineHeight = px * 1.18;
  const top = style.y * H - ((lines.length - 1) * lineHeight) / 2;
  // Which word is being said now, for the highlight.
  let spoken = -1;
  caption.words.forEach((w, i) => t >= w.start && (spoken = i));
  let index = 0;
  const space = ctx.measureText(" ").width;
  for (const [li, line] of lines.entries()) {
    const y = top + li * lineHeight;
    const width = ctx.measureText(line.join(" ")).width;
    let x = (W - width) / 2;
    if (style.name === "boxed") {
      ctx.fillStyle = style.accent;
      roundRect(ctx, x - px * 0.3, y - lineHeight / 2, width + px * 0.6, lineHeight, px * 0.22);
    }
    for (const word of line) {
      const w = ctx.measureText(word).width;
      const lit = style.name === "karaoke" && index === spoken;
      ctx.lineJoin = "round";
      if (style.name === "bold" || style.name === "karaoke") {
        ctx.lineWidth = px * 0.16;
        ctx.strokeStyle = "rgba(0,0,0,0.92)";
        ctx.strokeText(word, x, y);
        ctx.fillStyle = lit ? style.accent : style.color;
        ctx.fillText(word, x, y);
      } else if (clean) {
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.75)";
        ctx.shadowBlur = px * 0.25;
        ctx.shadowOffsetY = px * 0.04;
        ctx.fillStyle = style.color;
        ctx.fillText(word, x, y);
        ctx.restore();
      } else {
        // On the band the text takes whichever of black and white reads better.
        ctx.fillStyle = luminance(style.accent) > 0.55 ? "#111111" : "#FFFFFF";
        ctx.fillText(word, x, y);
      }
      x += w + space;
      index++;
    }
  }
}

const TEXT_Y: Record<EditText["position"], number> = { top: 0.15, middle: 0.45, bottom: 0.74 };

/** How big text that pops in is, `into` seconds after it appears: from small, past full size, then settling. */
const popScale = (into: number) => (into >= 0.36 ? 1 : into < 0.25 ? 0.3 + (1.12 - 0.3) * (into / 0.25) : 1.12 - 0.12 * ((into - 0.25) / 0.11));

function drawText(ctx: CanvasRenderingContext2D, item: EditText, W: number, H: number, t = Infinity) {
  const scale = W / 1080;
  if (item.pop && t - item.start < 0.36) {
    // Grows from the text's own centre.
    const k = popScale(Math.max(t - item.start, 0));
    const cy = TEXT_Y[item.position] * H;
    ctx.save();
    ctx.translate(W / 2, cy);
    ctx.scale(k, k);
    ctx.translate(-W / 2, -cy);
    ctx.globalAlpha = Math.min(1, (t - item.start) / 0.15 + 0.2);
    drawText(ctx, { ...item, pop: false }, W, H);
    ctx.restore();
    return;
  }
  const px = Math.round((item.style === "title" ? 84 : item.style === "label" ? 50 : 56) * scale);
  ctx.font = `${item.style === "title" ? 700 : 600} ${px}px ${item.style === "title" ? DISPLAY : SANS}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = wrap(ctx, item.text.split(/\s+/).filter(Boolean), W * 0.84).map((l) => l.join(" "));
  const lineHeight = px * 1.2;
  const top = TEXT_Y[item.position] * H - ((lines.length - 1) * lineHeight) / 2;
  if (item.style === "label") {
    const width = Math.max(...lines.map((l) => ctx.measureText(l).width));
    ctx.fillStyle = "rgba(0,0,0,0.62)";
    roundRect(ctx, (W - width) / 2 - px * 0.6, top - lineHeight / 2 - px * 0.3, width + px * 1.2, lineHeight * lines.length + px * 0.6, px * 0.4);
  }
  for (const [i, line] of lines.entries()) {
    const y = top + i * lineHeight;
    if (item.style === "title") {
      ctx.lineJoin = "round";
      ctx.lineWidth = px * 0.14;
      ctx.strokeStyle = "rgba(0,0,0,0.9)";
      ctx.strokeText(line, W / 2, y);
    } else if (item.style === "plain") {
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.75)";
      ctx.shadowBlur = px * 0.3;
    }
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(line, W / 2, y);
    if (item.style === "plain") ctx.restore();
  }
}

/** Draws everything over the picture at time `t` onto a canvas the size of the video. */
export function drawOverlay(ctx: CanvasRenderingContext2D, project: EditProject, t: number) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.clearRect(0, 0, W, H);
  for (const item of project.texts) if (t >= item.start && t < item.end) drawText(ctx, item, W, H, t);
  if (project.showCaptions) {
    const caption = project.captions.find((c) => t >= c.start && t < c.end);
    if (caption) drawCaption(ctx, caption, project.captionStyle, t, W, H);
  }
}

/** Draws a sample caption in a style onto a small canvas, for choosing styles by eye. The second word is shown highlighted. */
export function drawCaptionSample(canvas: HTMLCanvasElement, style: CaptionStyle, text: string) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const parts = text.split(/\s+/).filter(Boolean);
  const words = parts.map((w, i) => ({ text: w, start: i, end: i + 1 }));
  drawCaption(ctx, { id: "sample", start: 0, end: parts.length, words }, { ...style, y: 0.5 }, 1.5, canvas.width, canvas.height);
}

/** Waits for the fonts the captions use, so the first picture drawn is not in a fallback font. */
export async function fontsReady() {
  await Promise.all([document.fonts.load(`800 40px ${SANS}`), document.fonts.load(`600 40px ${SANS}`), document.fonts.load(`700 40px ${DISPLAY}`)]).catch(() => undefined);
}

/**
 * Every change in what is drawn over the picture, from the start to the end of the video, each as a full-size
 * picture with the time it stays on screen. Stretches where nothing changes share one picture.
 */
export async function overlayFrames(project: EditProject): Promise<OverlayFrame[]> {
  await fontsReady();
  const total = projectLength(project);
  const times = new Set<number>([0, total]);
  for (const t of project.texts) {
    times.add(t.start).add(t.end);
    // A text that pops in gets a picture for each moment of its growing.
    if (t.pop) for (let k = 1; k <= 6; k++) times.add(Math.min(t.start + k * 0.06, t.end));
  }
  if (project.showCaptions) {
    for (const c of project.captions) {
      times.add(c.start).add(c.end);
      if (project.captionStyle.name === "karaoke") for (const w of c.words) times.add(w.start);
    }
  }
  const cuts = [...times].filter((t) => t >= 0 && t <= total).sort((a, b) => a - b);
  const canvas = document.createElement("canvas");
  canvas.width = project.width;
  canvas.height = project.height;
  const ctx = canvas.getContext("2d")!;
  const frames: OverlayFrame[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const start = cuts[i];
    const end = cuts[i + 1];
    if (end - start < 0.001) continue;
    // Drawn just after the change, so what starts at `start` is in and what ends there is out.
    drawOverlay(ctx, project, start + Math.min(0.001, (end - start) / 2));
    const png = canvas.toDataURL("image/png");
    const last = frames[frames.length - 1];
    if (last && last.png === png) last.end = end;
    else frames.push({ start, end, png });
  }
  return frames;
}
