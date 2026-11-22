// Breaks a saved post down: what hooks the viewer, how it is built, why it works.
// Plain Node code with relative imports only (used by the desktop app and the dev server).
//
// Claude is shown a handful of frames (the opening second by second, then a few
// spread through the rest) together with the transcript and caption. The result
// is saved with the post, so each post is paid for once.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { estimateCostUsd, HOOK_TYPES, VIDEO_FORMATS, type PostAnalysis } from "../shared/analysis";
import type { ResearchItem } from "../shared/research";
import { recordClaude } from "./usage";

const exec = promisify(execFile);
const EXE = process.platform === "win32" ? ".exe" : "";

/** Seconds into the video at which the opening is sampled. */
const OPENING_SECONDS = [0, 1, 2, 3];
/** Extra frames spread through the rest of the video. */
const LATER_FRAMES = 4;
const MAX_PICTURES = 6;
const FRAME_HEIGHT = 768;

const AnalysisSchema = z.object({
  summary: z.string(),
  format: z.enum(VIDEO_FORMATS),
  topic: z.string(),
  emotion: z.string(),
  hookType: z.enum(HOOK_TYPES),
  spokenHook: z.string(),
  visualHook: z.string(),
  openingText: z.string(),
  beats: z.array(z.string()),
  cta: z.string(),
  whyItWorks: z.array(z.string()),
  skeleton: z.array(z.string()),
});

const SYSTEM = `You analyse short-form social videos and posts that performed well, so a creator can learn from their structure.

You are given frames from one post (each labelled with its time in the video), plus its transcript, caption and numbers. Describe only what the frames and text actually show. If something is not visible or not said, leave that field empty rather than guessing.

Fill in:
- summary: one or two sentences on what the post is and does.
- format: the closest option.
- topic: the subject, in a few words.
- emotion: the main feeling it plays on.
- hookType: the closest option for how the opening grabs attention.
- spokenHook: the exact first sentence spoken, copied from the transcript. Empty if nothing is said.
- visualHook: what is seen in the first three seconds, concretely (who, doing what, how it is framed).
- openingText: the text shown on screen in the opening frames, copied exactly. Empty if none.
- beats: four to seven short sentences, in order, saying what happens.
- cta: the closing ask, copied or paraphrased. Empty if none.
- whyItWorks: two to four specific reasons this post holds attention or gets shared. Point at things in this post, not general advice.
- skeleton: the reusable structure as four to six steps, with the subject replaced by placeholders in square brackets, for example "Open on [surprising result] with text '[number] in [time]'". Another creator should be able to follow it with a different topic.`;

type Frame = { label: string; base64: string };

async function duration(ffprobe: string, file: string): Promise<number | null> {
  try {
    const { stdout } = await exec(
      ffprobe,
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
      { windowsHide: true },
    );
    const seconds = Number(stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    return null;
  }
}

/** Counts cuts with FFmpeg's scene detection, on a small copy of the picture to keep it quick. */
async function countCuts(ffmpeg: string, file: string): Promise<number | null> {
  try {
    const { stderr } = await exec(
      ffmpeg,
      ["-hide_banner", "-i", file, "-vf", "scale=320:-2,select='gt(scene,0.3)',showinfo", "-an", "-f", "null", "-"],
      { windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
    );
    return (stderr.match(/pts_time:/g) ?? []).length;
  } catch {
    return null;
  }
}

async function grab(ffmpeg: string, args: string[], out: string): Promise<string | null> {
  try {
    await exec(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", ...args, "-vf", `scale=-2:${FRAME_HEIGHT}`, "-q:v", "5", out], {
      windowsHide: true,
    });
    return (await readFile(out)).toString("base64");
  } catch {
    return null; // A frame that cannot be read is skipped.
  }
}

/**
 * Analyses one post. `toolsDir` is where ffmpeg and ffprobe live, or null if
 * they are unavailable, in which case only the text is analysed.
 */
export async function analyzePost(
  apiKey: string,
  item: ResearchItem,
  itemDir: string,
  toolsDir: string | null,
): Promise<{ ok: true; analysis: PostAnalysis } | { ok: false; error: string }> {
  if (!apiKey) return { ok: false, error: "Add your Claude API key in Settings first." };

  const video = item.media.find((m) => m.kind === "video");
  const pictures = item.media.filter((m) => m.kind === "image").slice(0, MAX_PICTURES);
  const frames: Frame[] = [];
  let seconds: number | null = item.durationSeconds;
  let cuts: number | null = null;

  const work = join(itemDir, "analysis-frames");
  try {
    if (toolsDir) {
      const ffmpeg = join(toolsDir, `ffmpeg${EXE}`);
      const ffprobe = join(toolsDir, `ffprobe${EXE}`);
      await mkdir(work, { recursive: true });

      if (video) {
        const file = join(itemDir, video.file);
        seconds = (await duration(ffprobe, file)) ?? seconds;
        cuts = await countCuts(ffmpeg, file);

        const end = seconds ?? 0;
        const times = OPENING_SECONDS.filter((t) => t === 0 || t < end);
        const last = OPENING_SECONDS[OPENING_SECONDS.length - 1];
        if (end > last + 2) {
          // Evenly spaced through what is left, stopping just short of the end.
          for (let i = 1; i <= LATER_FRAMES; i++) times.push(last + ((end - 0.5 - last) * i) / LATER_FRAMES);
        }
        for (const [i, t] of times.entries()) {
          const base64 = await grab(ffmpeg, ["-ss", t.toFixed(2), "-i", file, "-frames:v", "1"], join(work, `f${i}.jpg`));
          if (base64) frames.push({ label: `Frame at ${Math.round(t)} seconds`, base64 });
        }
      }
      for (const [i, picture] of pictures.entries()) {
        const base64 = await grab(ffmpeg, ["-i", join(itemDir, picture.file), "-frames:v", "1"], join(work, `p${i}.jpg`));
        if (base64) frames.push({ label: `Picture ${i + 1} of the post`, base64 });
      }
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }

  const words = item.transcript.split(/\s+/).filter(Boolean).length;
  const wordsPerMinute = seconds && words > 0 ? Math.round(words / (seconds / 60)) : null;

  const facts = [
    `Platform: ${item.platform}`,
    `Creator: ${item.author}${item.authorHandle ? ` (@${item.authorHandle})` : ""}`,
    video ? `Length: ${seconds ? `${Math.round(seconds)} seconds` : "unknown"}` : "This post has no video, only pictures.",
    cuts !== null && `Cuts counted: ${cuts}`,
    wordsPerMinute !== null && `Speaking pace: about ${wordsPerMinute} words a minute`,
    item.likeCount !== null && `Likes: ${item.likeCount}`,
    item.commentCount !== null && `Comments: ${item.commentCount}`,
    item.viewCount !== null && `Views: ${item.viewCount}`,
    item.audio && `Sound: ${item.audio.kind === "music" ? "song" : "original sound"} "${item.audio.title}"${item.audio.trending ? " (marked trending)" : ""}`,
    item.title && item.platform === "youtube" && `Title: ${item.title}`,
    item.note && `The creator studying this post noted: ${item.note}`,
  ]
    .filter(Boolean)
    .join("\n");

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const frame of frames) {
    content.push({ type: "text", text: `${frame.label}:` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: frame.base64 } });
  }
  content.push({
    type: "text",
    text: [
      facts,
      "",
      "Transcript of what is said:",
      item.transcript || "(no transcript available)",
      "",
      "Caption:",
      item.caption || "(no caption)",
      frames.length === 0 ? "\nNo frames could be read from this post, so base the analysis on the text alone." : "",
    ].join("\n"),
  });

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      // If the model declines for policy reasons, let the API retry on its default fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{ role: "user", content }],
      output_config: { format: betaZodOutputFormat(AnalysisSchema) },
    });
    recordClaude("analysis", response.usage, item.author || item.authorHandle);
    if (response.stop_reason === "refusal") return { ok: false, error: "Claude declined to analyse this post." };
    if (!response.parsed_output) return { ok: false, error: "The analysis came back incomplete. Try again." };

    return {
      ok: true,
      analysis: {
        ...response.parsed_output,
        durationSeconds: seconds,
        cuts,
        wordsPerMinute,
        framesUsed: frames.length,
        usedTranscript: item.transcript !== "",
        costUsd: estimateCostUsd(response.usage),
        analyzedAt: new Date().toISOString(),
      },
    };
  } catch (e) {
    return { ok: false, error: describeClaudeError(e) };
  }
}

/** Turns an Anthropic SDK error into something a person can act on. */
export function describeClaudeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "The Claude API key was rejected. Check it in Settings.";
  if (e instanceof Anthropic.PermissionDeniedError) return "This Claude API key is not allowed to use the model.";
  if (e instanceof Anthropic.RateLimitError) return "Claude's rate limit was reached. Wait a minute and try again.";
  if (e instanceof Anthropic.APIConnectionError) return "Could not reach Anthropic. Check your internet connection.";
  if (e instanceof Anthropic.APIError) return `Anthropic returned an error (${e.status ?? "unknown"}): ${e.message}`;
  return e instanceof Error ? e.message : "The request to Claude failed.";
}
