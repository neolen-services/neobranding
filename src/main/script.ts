// Turns one saved idea into a timed, ready-to-film script.
// Plain Node code with relative imports only (used by the desktop app and the dev server).
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { estimateCostUsd } from "../shared/analysis";
import type { BrandKit } from "../shared/brand";
import { WORDS_PER_SECOND, type Idea, type IdeaScript } from "../shared/ideas";
import type { ResearchItem } from "../shared/research";
import { describeClaudeError } from "./analyze";
import { describeBrand } from "./generate";

const MIN_SECONDS = 20;
const MAX_SECONDS = 60;
const DEFAULT_SECONDS = 40;

const ScriptSchema = z.object({
  hooks: z.array(z.string()),
  beats: z.array(
    z.object({
      start: z.number(),
      end: z.number(),
      say: z.string(),
      show: z.string(),
      text: z.string(),
    }),
  ),
  sound: z.string(),
  caption: z.string(),
  hashtags: z.array(z.string()),
});

const SYSTEM = `You write shooting scripts for vertical short videos (Reels, Shorts, TikTok) that one creator films alone with a phone.

You are given the creator's brand, one video idea, and (when available) the analysis of the post the idea is modelled on. Turn the idea into a script the creator can read off and film today.

Give:
- hooks: exactly three opening lines for the first three seconds, strongest first. Sharpen the idea's existing lines where you can; each must be one short spoken sentence.
- beats: the whole video in order, as stretches of time. For each:
  - start and end: seconds from the start of the video. The first beat starts at 0, each beat starts where the last one ended, and the last one ends at the target length.
  - say: the exact words spoken, written the way the creator talks. The first beat's words are the first hook. Use "" when nothing is said.
  - show: what the camera shows, in one short sentence the creator can follow while filming: framing, action, prop, or cutaway.
  - text: the words overlaid on screen for that stretch, six words or fewer, or "" for none. The opening beat always has on-screen text.
- sound: one or two sentences on the sound to use. Say whether to use the creator's own voice only, their voice over quiet music, or a music track, and what kind (mood, tempo). If the model post's sound is given, say whether the same kind suits this video. Do not name a specific song as trending: you cannot know what is trending today.
- caption: a ready-to-post caption of one to three sentences in the creator's voice.
- hashtags: three to six hashtags, each starting with #.

Rules:
- Spoken words must fit their time: no more than ${WORDS_PER_SECOND} words for each second of a beat. Count them. If a beat runs over, cut words, do not speed up.
- No beat longer than eight seconds; change what is shown at least that often.
- Follow the model post's pacing and structure where one is given, never its lines, story, numbers or claims.
- The last beat is the closing ask, and asks for one action only.
- Where the topic is health: keep claims accurate and proportionate, never promise cures or diagnose, and do not present the creator as a medical professional unless their bio says they are one.`;

function describeIdea(idea: Idea): string {
  return [
    `Title: ${idea.title}`,
    `Opening line chosen: ${idea.hook}`,
    idea.altHooks?.length ? `Other opening lines considered: ${idea.altHooks.join(" | ")}` : "",
    `Outline: ${idea.outline.map((b, i) => `${i + 1}) ${b}`).join(" ")}`,
    `Closing ask: ${idea.cta}`,
    `Draft caption: ${idea.caption}`,
    idea.pillar && `Content pillar: ${idea.pillar}`,
    idea.platform && `Platform: ${idea.platform}`,
    idea.series && `Series: ${idea.series}`,
    idea.scoreReason && `A reviewer's comment on the idea, to fix where it is a weakness: ${idea.scoreReason}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function describeModel(post: ResearchItem): string {
  const a = post.analysis!;
  const sound = post.audio
    ? post.audio.kind === "music"
      ? `the song "${post.audio.title}" by ${post.audio.artist}`
      : "the creator's own recorded audio"
    : "unknown";
  return [
    `By ${post.author || post.authorHandle} on ${post.platform}. Format: ${a.format}.`,
    `Length: ${a.durationSeconds ? `${Math.round(a.durationSeconds)}s` : "unknown"}${a.cuts !== null ? `, ${a.cuts} cuts` : ""}${a.wordsPerMinute ? `, ${a.wordsPerMinute} words a minute` : ""}`,
    `Opening (${a.hookType}): shows ${a.visualHook || "(not described)"}${a.openingText ? `; on-screen text "${a.openingText}"` : ""}`,
    `What happens: ${a.beats.map((b, i) => `${i + 1}) ${b}`).join(" ")}`,
    `Structure: ${a.skeleton.map((s, i) => `${i + 1}) ${s}`).join(" ")}`,
    `Why it works: ${a.whyItWorks.join(" ")}`,
    `Sound: ${sound}`,
  ].join("\n");
}

export type WriteScriptResult = { ok: true; script: IdeaScript } | { ok: false; error: string };

/** `model` is the saved post the idea borrows its structure from, if it still exists and is analysed. */
export async function writeScript(
  apiKey: string,
  brand: BrandKit,
  idea: Idea,
  model: ResearchItem | undefined,
): Promise<WriteScriptResult> {
  if (!apiKey) return { ok: false, error: "Add your Claude API key in Settings first." };

  const modelSeconds = model?.analysis?.durationSeconds;
  const seconds = Math.round(Math.min(Math.max(modelSeconds || DEFAULT_SECONDS, MIN_SECONDS), MAX_SECONDS));

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 8000,
      // If the model declines for policy reasons, let the API retry on its default fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default" as const,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            `THE CREATOR'S BRAND\n${describeBrand(brand)}`,
            `THE IDEA\n${describeIdea(idea)}`,
            model?.analysis ? `THE POST IT IS MODELLED ON\n${describeModel(model)}` : "",
            `Target length: ${seconds} seconds, so at most about ${Math.round(seconds * WORDS_PER_SECOND)} spoken words in total.`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
      output_config: { format: betaZodOutputFormat(ScriptSchema) },
    });

    if (response.stop_reason === "refusal") return { ok: false, error: "Claude declined to write this script." };
    const out = response.parsed_output;
    if (response.stop_reason === "max_tokens" || !out || out.beats.length === 0) {
      return { ok: false, error: "The script came back incomplete. Try again." };
    }

    return {
      ok: true,
      script: {
        hooks: out.hooks.map((h) => h.trim()).filter(Boolean).slice(0, 3),
        beats: out.beats.map((b) => ({
          start: Math.max(0, Math.round(b.start)),
          end: Math.max(0, Math.round(b.end)),
          say: b.say.trim(),
          show: b.show.trim(),
          text: b.text.trim(),
        })),
        sound: out.sound.trim(),
        caption: out.caption.trim(),
        hashtags: out.hashtags.map((h) => h.trim()).filter(Boolean),
        costUsd: estimateCostUsd(response.usage),
        writtenAt: new Date().toISOString(),
      },
    };
  } catch (e) {
    return { ok: false, error: describeClaudeError(e) };
  }
}
