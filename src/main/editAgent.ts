// The video editor's own agent: the creator says what they want ("make it punchy", "captions in yellow",
// "add calm music") and Claude edits the timeline with tools. It sees the timeline, the words heard in
// every file with their times, and frames of the videos when it asks to look.
// Plain Node code with relative imports only (used by the desktop app and the dev server).
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import {
  CAPTION_STYLES,
  TRANSITIONS,
  clipLength,
  clipStarts,
  LOOKS,
  MOTIONS,
  projectLength,
  showTime,
  type EditAgentReply,
  type EditAudio,
  type EditChatEntry,
  type EditChatView,
  type EditClip,
  type EditProject,
  type EditText,
  type EditTimeline,
  timelineOf,
} from "../shared/edit";
import { estimateCostUsd } from "../shared/analysis";
import type { ApiProvider } from "../shared/settings";
import { describeClaudeError } from "./analyze";
import { captionsFromSpeech, editOps, newAudio, newClip } from "./edit";
import type { Store } from "./store";
import { recordClaude } from "./usage";

type Message = Anthropic.Beta.BetaMessageParam;
type Tool = Anthropic.Beta.BetaTool;
type Input = Record<string, unknown>;

export type EditAgentContext = { dataDir: () => string; store: () => Store; key: (provider: ApiProvider) => string };


type StoredChat = {
  messages: Message[];
  costUsd: number;
  /** What each tool call did, in words, by its id. */
  done: Record<string, string>;
  /** The timeline as it was before each of the creator's messages, by that message's position in `messages`. */
  checkpoints: Record<string, EditTimeline>;
};

const MAX_STEPS = 24;
const chatKey = (projectId: string) => `edit_chat_${projectId}`;
/** What the agent is doing right now, by project id. */
const progress = new Map<string, string>();
export const editAgentProgress = (id: string) => progress.get(id) ?? null;

const SYSTEM = `You are the editor inside AI Shorts, a desktop app one creator uses to make short vertical videos (Reels, Shorts, TikTok). You edit a project's timeline with your tools; the creator watches the preview and exports the MP4 themself.

How a project works:
- Media: the files in the project, named A1, A2… Each has a length, and for video and sound the words heard in it with their times (once transcribed; words from a Studio script are estimated, not heard).
- Picture track: clips played one after another in order, numbered 1, 2… Each uses part of a media file (in to out seconds of that file) and has a speed, a look (colour), a motion (zoom or pan), how it starts (cut or a fade from black) and the volume of its own sound. Pictures (stills) work as clips too.
- Sound: voice lines, music and sound effects placed at a time on the timeline, named S1, S2… Music is turned down by itself whenever anyone speaks, so leave its volume around 0.25 to 0.4.
- Captions: made from the words heard, a few words at a time, in one style for the whole video. They can be hidden.
- Text: words placed over the picture for a while (a hook, a label, a call to action), named T1, T2…
Every change you make is saved straight away and the creator sees it. Each tool answers with the timeline as it now is.

How to edit well for short vertical video:
- The first 1 to 2 seconds decide whether anyone stays: open on the strongest moment or line, never on a slow start, a breath or a logo.
- Cut silences, ums, false starts and repeated takes from talking footage. Use the word times: cut between words, a little after the last word ends and a little before the next one starts (about 0.05 to 0.1 seconds of room).
- Keep the pace up: a new shot or a change (punch-in, angle, b-roll) every 2 to 4 seconds while someone talks to camera. A punch-in on one clip of talking footage gives a cut without new footage.
- Captions are expected on almost every short: big, a few words at a time, kept above the bottom fifth of the frame where the app's buttons are.
- Looks and motion are seasoning: use the same look across the video unless a change means something; slow zooms suit stills and calm shots.
- End cleanly: on the last word or the payoff, optionally with a short call to action as text.
- Do not invent media. Only use the files the project has; ask the creator to add what is missing.

When you are unsure what is in a video, look at it (look_at) before deciding: the words tell you what is said, not what is shown.
Costs: you use the creator's Claude credit. Transcribing uses Deepgram (fractions of a cent a minute). Music and sound effects are made by ElevenLabs and use its credits: make them only when the creator asked for music or a sound, or after asking.
Answer in plain, short sentences: say what you changed and anything the creator should check, in a few lines. Never paste the whole timeline back.`;

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

const CLIP_PROPS = {
  speed: { type: "number", description: "0.25 to 4. 1 is normal." },
  look: { type: "string", enum: [...LOOKS] },
  motion: { type: "string", enum: [...MOTIONS] },
  transition: { type: "string", enum: [...TRANSITIONS], description: "How the clip comes in: cut, fade (from black), flash (white, for a reveal), zoom (a jump into a detail), whip (fast energy). Mostly cut." },
  volume: { type: "number", description: "Its own sound, 0 (muted) to 2." },
} as const;

const TOOLS: Tool[] = [
  {
    name: "look_at",
    description: "See frames of a video or a picture in the project. Give the media name (A1…) and up to 8 times in seconds inside that file.",
    input_schema: { type: "object", properties: { media: { type: "string" }, times: { type: "array", items: { type: "number" } } }, required: ["media"] },
  },
  {
    name: "transcribe",
    description: "Hear the words in a video or sound file with their times, with Deepgram. Needed before cutting talking footage by its words or making captions from it.",
    input_schema: { type: "object", properties: { media: { type: "string" } }, required: ["media"] },
  },
  {
    name: "set_clips",
    description: "Replace the whole picture track with these clips, in order. Use it for a first cut or a re-cut. Times are seconds inside each file.",
    input_schema: {
      type: "object",
      properties: {
        clips: {
          type: "array",
          items: { type: "object", properties: { media: { type: "string" }, in: { type: "number" }, out: { type: "number" }, ...CLIP_PROPS }, required: ["media", "in", "out"] },
        },
      },
      required: ["clips"],
    },
  },
  {
    name: "edit_clip",
    description: "Change one clip (numbered from 1), or remove it. Only the fields given change.",
    input_schema: { type: "object", properties: { clip: { type: "integer" }, in: { type: "number" }, out: { type: "number" }, ...CLIP_PROPS, remove: { type: "boolean" } }, required: ["clip"] },
  },
  {
    name: "split_clip",
    description: "Split one clip in two at a time on the timeline (seconds from the start of the video), for example to give the second half a punch-in.",
    input_schema: { type: "object", properties: { clip: { type: "integer" }, at: { type: "number" } }, required: ["clip", "at"] },
  },
  {
    name: "place_sound",
    description: "Put a sound file (A…) on the timeline as a voice line, music or a sound effect, starting at `start` seconds. Use in/out to use part of it.",
    input_schema: {
      type: "object",
      properties: {
        media: { type: "string" },
        role: { type: "string", enum: ["voice", "music", "sfx"] },
        start: { type: "number" },
        in: { type: "number" },
        out: { type: "number" },
        volume: { type: "number", description: "0 to 2. Music usually 0.25 to 0.4." },
        fade_in: { type: "number" },
        fade_out: { type: "number" },
      },
      required: ["media", "role", "start"],
    },
  },
  {
    name: "edit_sound",
    description: "Change a placed sound (S1…) or remove it. Only the fields given change.",
    input_schema: {
      type: "object",
      properties: { sound: { type: "string" }, start: { type: "number" }, in: { type: "number" }, out: { type: "number" }, volume: { type: "number" }, fade_in: { type: "number" }, fade_out: { type: "number" }, remove: { type: "boolean" } },
      required: ["sound"],
    },
  },
  {
    name: "make_music",
    description: "Have ElevenLabs make an instrumental music track and place it under the whole video. Uses the creator's ElevenLabs credits. Describe genre, mood, tempo and instruments.",
    input_schema: { type: "object", properties: { description: { type: "string" }, volume: { type: "number" } }, required: ["description"] },
  },
  {
    name: "make_sound_effect",
    description: "Have ElevenLabs make a short sound effect (a whoosh, a pop, a click) and place it at `at` seconds. Uses the creator's ElevenLabs credits.",
    input_schema: { type: "object", properties: { description: { type: "string" }, at: { type: "number" }, seconds: { type: "number" }, volume: { type: "number" } }, required: ["description", "at"] },
  },
  {
    name: "make_captions",
    description: "Make captions from every word that will be heard, as the timeline now stands. Run it again after re-cutting. Replaces the captions there were.",
    input_schema: { type: "object", properties: { words_per_caption: { type: "integer", description: "1 to 5. 2 or 3 reads best." } } },
  },
  {
    name: "caption_style",
    description: "Change how captions look, or hide or show them.",
    input_schema: {
      type: "object",
      properties: {
        style: { type: "string", enum: [...CAPTION_STYLES], description: "bold: big white words with an outline. karaoke: the word being said lights up in the accent colour. clean: smaller with a shadow. boxed: on a solid band in the accent colour." },
        color: { type: "string", description: "#RRGGBB" },
        accent: { type: "string", description: "#RRGGBB" },
        upper: { type: "boolean" },
        size: { type: "number", description: "0.6 to 1.6" },
        height: { type: "number", description: "Where the caption sits, as a share of the frame from the top: 0.5 middle, 0.68 lower third. Keep it below 0.78." },
        show: { type: "boolean" },
      },
    },
  },
  {
    name: "edit_caption",
    description: "Change the words or timing of one caption (numbered from 1), or remove it.",
    input_schema: { type: "object", properties: { caption: { type: "integer" }, text: { type: "string" }, start: { type: "number" }, end: { type: "number" }, remove: { type: "boolean" } }, required: ["caption"] },
  },
  {
    name: "set_texts",
    description: "Replace all text over the picture with these.",
    input_schema: {
      type: "object",
      properties: {
        texts: {
          type: "array",
          items: {
            type: "object",
            properties: { text: { type: "string" }, start: { type: "number" }, end: { type: "number" }, position: { type: "string", enum: ["top", "middle", "bottom"] }, style: { type: "string", enum: ["title", "label", "plain"] }, pop: { type: "boolean", description: "Pops in as it appears." } },
            required: ["text", "start", "end"],
          },
        },
      },
      required: ["texts"],
    },
  },
  {
    name: "rename",
    description: "Give the project a new title.",
    input_schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
  },
];

/** The timeline in a compact form Claude reads at the start of each turn and after each change. */
export function describeProject(p: EditProject): string {
  const name = (id: string) => `A${p.assets.findIndex((a) => a.id === id) + 1}`;
  const starts = clipStarts(p);
  const words = (w: { text: string; start: number }[]) => w.map((x) => `[${x.start.toFixed(1)}]${x.text}`).join(" ");
  const lines = [
    `Project "${p.title}", ${p.width}x${p.height}, ${p.fps} fps, ${projectLength(p).toFixed(1)} seconds long.`,
    "",
    "Media:",
    ...(p.assets.length
      ? p.assets.map((a, i) => {
          const kind = a.kind === "image" ? "picture" : a.kind === "audio" ? "sound" : `video${a.hasAudio ? " with sound" : ", silent"}`;
          const heard = a.kind === "image" || (a.kind === "video" && !a.hasAudio) ? "" : a.words ? ` Words${a.wordsEstimated ? " (estimated from the script)" : ""}: ${words(a.words) || "(nothing said)"}` : " Not transcribed.";
          return `- A${i + 1}: ${kind}, ${a.seconds.toFixed(1)}s${a.width ? `, ${a.width}x${a.height}` : ""}, "${a.name}".${heard}`;
        })
      : ["(none yet: the creator has to add files)"]),
    "",
    "Picture track:",
    ...(p.clips.length
      ? p.clips.map((c, i) => `${i + 1}. ${showTime(starts[i])} to ${showTime(starts[i] + clipLength(c))}: ${name(c.assetId)} from ${c.in.toFixed(2)} to ${c.out.toFixed(2)}${c.speed !== 1 ? `, speed ${c.speed}` : ""}${c.look !== "none" ? `, look ${c.look}` : ""}${c.motion !== "none" ? `, ${c.motion}` : ""}${c.transition !== "cut" ? `, comes in with ${c.transition}` : ""}${c.volume !== 1 ? `, own sound ${c.volume}` : ""}`)
      : ["(empty)"]),
    "",
    "Sound:",
    ...(p.audio.length ? p.audio.map((a, i) => `- S${i + 1}: ${a.role} ${name(a.assetId)} at ${showTime(a.start)}, using ${a.in.toFixed(2)} to ${a.out.toFixed(2)}, volume ${a.volume}${a.fadeIn ? `, fade in ${a.fadeIn}` : ""}${a.fadeOut ? `, fade out ${a.fadeOut}` : ""}`) : ["(none)"]),
    "",
    `Captions: ${p.captions.length}, style ${p.captionStyle.name}, colour ${p.captionStyle.color}, accent ${p.captionStyle.accent}, height ${p.captionStyle.y}, ${p.showCaptions ? "shown" : "hidden"}.`,
    ...p.captions.slice(0, 60).map((c, i) => `${i + 1}. ${showTime(c.start)} to ${showTime(c.end)}: ${c.words.map((w) => w.text).join(" ")}`),
    p.captions.length > 60 ? `(and ${p.captions.length - 60} more)` : "",
    "",
    "Text over the picture:",
    ...(p.texts.length ? p.texts.map((t, i) => `- T${i + 1}: "${t.text}" ${showTime(t.start)} to ${showTime(t.end)}, ${t.position}, ${t.style}`) : ["(none)"]),
  ];
  return lines.filter((l, i, all) => !(l === "" && all[i - 1] === "")).join("\n");
}

function readChat(ctx: EditAgentContext, projectId: string): StoredChat {
  try {
    const saved = JSON.parse(ctx.store().getSetting(chatKey(projectId)) || "null") as StoredChat | null;
    if (saved && Array.isArray(saved.messages)) return { messages: saved.messages, costUsd: Number(saved.costUsd) || 0, done: saved.done ?? {}, checkpoints: saved.checkpoints ?? {} };
  } catch {
    // A chat that cannot be read starts again.
  }
  return { messages: [], costUsd: 0, done: {}, checkpoints: {} };
}

const STATE_MARK = "\n\n<timeline>\n";

/** The chat as the creator sees it: what they said, what the editor answered, and what it did in between. */
function toView(chat: StoredChat): EditChatView {
  const entries: EditChatEntry[] = [];
  let turn = "";
  for (const [i, m] of chat.messages.entries()) {
    if (m.role === "user") {
      if (typeof m.content === "string") {
        entries.push({ role: "user", text: m.content.split(STATE_MARK)[0], actions: [] });
        turn = chat.checkpoints[String(i)] ? String(i) : "";
      }
      continue;
    }
    const blocks = typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : (m.content ?? []);
    let last = entries[entries.length - 1];
    if (!last || last.role !== "assistant") entries.push((last = { role: "assistant", text: "", actions: [], ...(turn && { checkpoint: turn }) }));
    for (const b of blocks) {
      if (b.type === "text" && b.text.trim()) last.text = [last.text, b.text.trim()].filter(Boolean).join("\n\n");
      if (b.type === "tool_use" && chat.done[b.id]) last.actions.push(chat.done[b.id]);
    }
  }
  return { entries, costUsd: chat.costUsd };
}

export const getEditChat = (ctx: EditAgentContext, projectId: string): EditChatView => toView(readChat(ctx, projectId));

/** Puts the timeline back as it was before one of the editor's turns. */
export function undoEditorTurn(ctx: EditAgentContext, projectId: string, checkpoint: string) {
  const saved = readChat(ctx, projectId).checkpoints[checkpoint];
  if (!saved) return { ok: false as const, error: "That point can no longer be gone back to." };
  return editOps(ctx).restore(projectId, saved);
}

export function clearEditChat(ctx: EditAgentContext, projectId: string) {
  ctx.store().setSetting(chatKey(projectId), "");
}

/** Sends the creator's message to the editor and runs it until it has answered. */
export async function sendToEditor(ctx: EditAgentContext, projectId: string, said: string): Promise<EditAgentReply> {
  const ops = editOps(ctx);
  const start = ops.find(projectId);
  if (!start) return { ok: false, error: "That project is gone." };
  const message = said.trim();
  if (!message) return { ok: false, error: "Say what you want done first." };
  const apiKey = ctx.key("anthropic");
  if (!apiKey) return { ok: false, error: "Add your Claude API key in Settings first." };
  if (progress.has(projectId)) return { ok: false, error: "The editor is still working on your last message." };

  const chat = readChat(ctx, projectId);
  const store = () => ctx.store().setSetting(chatKey(projectId), JSON.stringify(chat));
  chat.checkpoints[String(chat.messages.length)] = timelineOf(start);
  chat.messages.push({ role: "user", content: `${message}${STATE_MARK}${describeProject(start)}\n</timeline>` });
  progress.set(projectId, "Thinking");
  const client = new Anthropic({ apiKey });
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const response = await client.beta.messages.create({
        model: "claude-opus-5-5",
        max_tokens: 16000,
        output_config: { effort: "medium" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        cache_control: { type: "ephemeral" },
        system: SYSTEM,
        tools: TOOLS,
        messages: chat.messages,
      });
      const project = ops.find(projectId);
      chat.costUsd += estimateCostUsd(response.usage);
      recordClaude("editor", response.usage, project?.title ?? "Video editor");
      if (response.stop_reason === "refusal") {
        chat.messages.pop();
        store();
        return { ok: false, error: "Claude declined this request. Try asking in a different way.", chat: toView(chat) };
      }
      chat.messages.push({ role: "assistant", content: response.content });
      const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (response.stop_reason === "max_tokens" && calls.length) {
        chat.messages.push({ role: "user", content: calls.map((c) => ({ type: "tool_result" as const, tool_use_id: c.id, is_error: true, content: "Not run: the reply was cut off." })) });
        store();
        return { ok: false, error: "The reply got cut off. Ask for a smaller change at a time.", chat: toView(chat) };
      }
      if (response.stop_reason === "pause_turn") {
        store();
        continue;
      }
      if (calls.length === 0) {
        store();
        return { ok: true, chat: toView(chat) };
      }
      // One at a time and in order: each change builds on the one before it.
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const call of calls) {
        try {
          const out = await runTool(ctx, projectId, call.name, (call.input ?? {}) as Input, (s) => progress.set(projectId, s));
          chat.done[call.id] = out.did;
          chat.costUsd += out.costUsd ?? 0;
          results.push({ type: "tool_result", tool_use_id: call.id, content: out.content });
        } catch (e) {
          results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: e instanceof Error ? e.message : "That did not work." });
        }
      }
      chat.messages.push({ role: "user", content: results });
      store();
      progress.set(projectId, "Thinking");
    }
    store();
    return { ok: false, error: "The editor took too many steps and stopped. Ask it to carry on.", chat: toView(chat) };
  } catch (e) {
    // The last message has no answer, so it is taken back; the creator can send it again.
    if (chat.messages.at(-1)?.role === "user" && typeof chat.messages.at(-1)?.content === "string") chat.messages.pop();
    store();
    return { ok: false, error: describeClaudeError(e), chat: toView(chat) };
  } finally {
    progress.delete(projectId);
  }
}

type ToolOut = { content: string | Anthropic.Beta.BetaToolResultBlockParam["content"]; did: string; costUsd?: number };

async function runTool(ctx: EditAgentContext, projectId: string, name: string, input: Input, say: (s: string) => void): Promise<ToolOut> {
  const ops = editOps(ctx);
  const project = ops.find(projectId);
  if (!project) throw new Error("The project is gone.");
  const media = (label: unknown) => {
    const match = /^A(\d+)$/i.exec(text(label));
    const asset = match ? project.assets[Number(match[1]) - 1] : undefined;
    if (!asset) throw new Error(`There is no media called ${text(label) || "that"}. Use A1 to A${project.assets.length}.`);
    return asset;
  };
  const clipIndex = (v: unknown) => {
    const i = Math.round(num(v, 0)) - 1;
    if (i < 0 || i >= project.clips.length) throw new Error(`There is no clip ${v}. The picture track has ${project.clips.length}.`);
    return i;
  };
  /** Saves the change and answers with the timeline as it now is. */
  const commit = (next: EditProject, did: string): ToolOut => {
    const saved = ops.save(next);
    return { content: `Done. The timeline now:\n${describeProject(saved)}`, did };
  };
  const clipFrom = (base: EditClip, i: Input): EditClip => {
    const asset = project.assets.find((a) => a.id === base.assetId)!;
    const limit = asset.kind === "image" ? 600 : asset.seconds;
    const inAt = Math.min(Math.max(num(i.in, base.in), 0), limit);
    const outAt = Math.min(Math.max(num(i.out, base.out), inAt + 0.05), asset.kind === "image" ? 600 : limit);
    return {
      ...base,
      in: inAt,
      out: outAt,
      speed: Math.min(Math.max(num(i.speed, base.speed), 0.25), 4),
      look: LOOKS.includes(i.look as never) ? (i.look as EditClip["look"]) : base.look,
      motion: MOTIONS.includes(i.motion as never) ? (i.motion as EditClip["motion"]) : base.motion,
      transition: TRANSITIONS.includes(i.transition as never) ? (i.transition as EditClip["transition"]) : base.transition,
      volume: Math.min(Math.max(num(i.volume, base.volume), 0), 2),
    };
  };
  const soundIndex = (v: unknown) => {
    const match = /^S(\d+)$/i.exec(text(v));
    const i = match ? Number(match[1]) - 1 : -1;
    if (i < 0 || i >= project.audio.length) throw new Error(`There is no sound called ${text(v) || "that"}.`);
    return i;
  };
  const soundFrom = (base: EditAudio, i: Input, length: number): EditAudio => {
    const inAt = Math.min(Math.max(num(i.in, base.in), 0), length);
    return {
      ...base,
      start: Math.max(num(i.start, base.start), 0),
      in: inAt,
      out: Math.min(Math.max(num(i.out, base.out), inAt + 0.05), length),
      volume: Math.min(Math.max(num(i.volume, base.volume), 0), 2),
      fadeIn: Math.min(Math.max(num(i.fade_in, base.fadeIn), 0), 10),
      fadeOut: Math.min(Math.max(num(i.fade_out, base.fadeOut), 0), 10),
    };
  };

  switch (name) {
    case "look_at": {
      const asset = media(input.media);
      say(`Looking at ${asset.name}`);
      const times = Array.isArray(input.times) && input.times.length ? input.times.map((t) => num(t, 0)) : [0, asset.seconds / 2, Math.max(asset.seconds - 0.1, 0)];
      const frames = await ops.frames(projectId, asset.id, times);
      return {
        content: frames.flatMap((f) => [
          { type: "text" as const, text: `${asset.kind === "image" ? "The picture" : `At ${f.time.toFixed(2)}s`}:` },
          { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: f.base64 } },
        ]),
        did: `Looked at ${asset.name}`,
      };
    }
    case "transcribe": {
      const asset = media(input.media);
      say(`Transcribing ${asset.name}`);
      const result = await ops.transcribe(projectId, asset.id, ctx.key("deepgram"));
      if (!result.ok) throw new Error(result.error);
      // Deepgram's list price for this model, for the chat's running total.
      return { ...commitView(result.project), did: `Transcribed ${asset.name}`, costUsd: ((result.seconds ?? 0) / 60) * 0.0043 };
    }
    case "set_clips": {
      const items = Array.isArray(input.clips) ? (input.clips as Input[]) : [];
      if (items.length === 0) throw new Error("Give at least one clip.");
      const clips = items.map((c) => clipFrom(newClip(media(c.media)), c));
      return commit({ ...project, clips }, `Cut the picture track into ${clips.length} clip${clips.length === 1 ? "" : "s"}`);
    }
    case "edit_clip": {
      const i = clipIndex(input.clip);
      if (input.remove === true) return commit({ ...project, clips: project.clips.filter((_, j) => j !== i) }, `Removed clip ${i + 1}`);
      const clips = project.clips.map((c, j) => (j === i ? clipFrom(c, input) : c));
      return commit({ ...project, clips }, `Changed clip ${i + 1}`);
    }
    case "split_clip": {
      const i = clipIndex(input.clip);
      const c = project.clips[i];
      const at = num(input.at, 0) - clipStarts(project)[i];
      if (at <= 0.05 || at >= clipLength(c) - 0.05) throw new Error(`${num(input.at, 0)}s is not inside clip ${i + 1}.`);
      const cut = c.in + at * c.speed;
      const clips = [...project.clips.slice(0, i), { ...c, out: cut }, { ...c, id: randomUUID(), in: cut, transition: "cut" as const }, ...project.clips.slice(i + 1)];
      return commit({ ...project, clips }, `Split clip ${i + 1}`);
    }
    case "place_sound": {
      const asset = media(input.media);
      if (asset.kind === "image" || (asset.kind === "video" && !asset.hasAudio)) throw new Error(`${asset.name} has no sound.`);
      const role = input.role === "music" || input.role === "sfx" ? input.role : "voice";
      const item = soundFrom(newAudio(asset, role, 0), input, asset.seconds);
      return commit({ ...project, audio: [...project.audio, item] }, `Placed ${role === "sfx" ? "a sound effect" : role} at ${showTime(item.start)}`);
    }
    case "edit_sound": {
      const i = soundIndex(input.sound);
      if (input.remove === true) return commit({ ...project, audio: project.audio.filter((_, j) => j !== i) }, `Removed sound S${i + 1}`);
      const length = project.assets.find((a) => a.id === project.audio[i].assetId)?.seconds ?? 0;
      return commit({ ...project, audio: project.audio.map((a, j) => (j === i ? soundFrom(a, input, length) : a)) }, `Changed sound S${i + 1}`);
    }
    case "make_music": {
      const description = text(input.description);
      if (!description) throw new Error("Describe the music.");
      say("Making music with ElevenLabs");
      const length = Math.max(Math.ceil(projectLength(project) + 1), 10);
      const made = await ops.generateAudio(projectId, "music", description, length, ctx.key("elevenlabs"));
      const item = { ...newAudio(made.asset, "music", 0), volume: Math.min(Math.max(num(input.volume, 0.3), 0), 1) };
      return commit({ ...made.project, audio: [...made.project.audio.filter((a) => a.role !== "music"), item] }, `Made music: ${description.slice(0, 60)}`);
    }
    case "make_sound_effect": {
      const description = text(input.description);
      if (!description) throw new Error("Describe the sound.");
      say("Making a sound effect with ElevenLabs");
      const made = await ops.generateAudio(projectId, "sfx", description, Math.min(Math.max(num(input.seconds, 1), 0.5), 10), ctx.key("elevenlabs"));
      const item = { ...newAudio(made.asset, "sfx", Math.max(num(input.at, 0), 0)), volume: Math.min(Math.max(num(input.volume, 0.8), 0), 2) };
      return commit({ ...made.project, audio: [...made.project.audio, item] }, `Made a sound effect: ${description.slice(0, 60)}`);
    }
    case "make_captions": {
      const captions = captionsFromSpeech(project, Math.min(Math.max(Math.round(num(input.words_per_caption, 3)), 1), 5));
      const unheard = project.assets.filter((a) => !a.words && (a.kind === "audio" || a.hasAudio) && (project.clips.some((c) => c.assetId === a.id) || project.audio.some((s) => s.assetId === a.id && s.role === "voice")));
      if (captions.length === 0) throw new Error(unheard.length ? `Nothing has been transcribed yet. Transcribe ${unheard.map((a) => `A${project.assets.indexOf(a) + 1}`).join(", ")} first.` : "Nothing is said in this video, so there is nothing to caption.");
      const out = commit({ ...project, captions, showCaptions: true }, `Made ${captions.length} captions`);
      return unheard.length ? { ...out, content: `${out.content}\n\nNot captioned, because not transcribed: ${unheard.map((a) => `A${project.assets.indexOf(a) + 1}`).join(", ")}.` } : out;
    }
    case "caption_style": {
      const s = project.captionStyle;
      const colour = (v: unknown, fallback: string) => (/^#[0-9a-f]{6}$/i.test(text(v)) ? text(v) : fallback);
      const captionStyle = {
        name: CAPTION_STYLES.includes(input.style as never) ? (input.style as typeof s.name) : s.name,
        color: colour(input.color, s.color),
        accent: colour(input.accent, s.accent),
        upper: typeof input.upper === "boolean" ? input.upper : s.upper,
        size: Math.min(Math.max(num(input.size, s.size), 0.6), 1.6),
        y: Math.min(Math.max(num(input.height, s.y), 0.1), 0.85),
      };
      return commit({ ...project, captionStyle, showCaptions: typeof input.show === "boolean" ? input.show : project.showCaptions }, "Changed the caption style");
    }
    case "edit_caption": {
      const i = Math.round(num(input.caption, 0)) - 1;
      const c = project.captions[i];
      if (!c) throw new Error(`There is no caption ${input.caption}.`);
      if (input.remove === true) return commit({ ...project, captions: project.captions.filter((_, j) => j !== i) }, `Removed caption ${i + 1}`);
      const start = Math.max(num(input.start, c.start), 0);
      const end = Math.max(num(input.end, c.end), start + 0.1);
      const said = text(input.text);
      // New words are spread over the caption's time; the highlight follows them.
      const words = said ? said.split(/\s+/).map((w, k, all) => ({ text: w, start: start + ((end - start) * k) / all.length, end: start + ((end - start) * (k + 1)) / all.length })) : c.words.map((w) => ({ ...w, start: start + (w.start - c.start), end: Math.min(start + (w.end - c.start), end) }));
      return commit({ ...project, captions: project.captions.map((x, j) => (j === i ? { ...x, start, end, words } : x)) }, `Changed caption ${i + 1}`);
    }
    case "set_texts": {
      const items = Array.isArray(input.texts) ? (input.texts as Input[]) : [];
      const texts: EditText[] = items
        .filter((t) => text(t.text))
        .map((t) => {
          const start = Math.max(num(t.start, 0), 0);
          return {
            id: randomUUID(),
            text: text(t.text).slice(0, 200),
            start,
            end: Math.max(num(t.end, start + 2), start + 0.2),
            position: t.position === "middle" || t.position === "bottom" ? t.position : "top",
            style: t.style === "label" || t.style === "plain" ? t.style : "title",
            ...(t.pop === true && { pop: true }),
          };
        });
      return commit({ ...project, texts }, texts.length ? `Set ${texts.length} text${texts.length === 1 ? "" : "s"} over the picture` : "Removed the text over the picture");
    }
    case "rename": {
      const title = text(input.title).slice(0, 120);
      if (!title) throw new Error("Give a title.");
      return commit({ ...project, title }, `Renamed it "${title}"`);
    }
    default:
      throw new Error(`Unknown tool ${name}.`);
  }
}

const commitView = (p: EditProject) => ({ content: `Done. The timeline now:\n${describeProject(p)}` });
