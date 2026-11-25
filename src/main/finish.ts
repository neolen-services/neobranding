// Finishing a Studio video: the cover (Claude picks the best moments and words, the creator chooses), Claude's final
// check of the exported video, and the posting kit for each platform.
// Plain Node code with relative imports only (used by the desktop app and the dev server).
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { estimateCostUsd } from "../shared/analysis";
import { clipStarts, showTime, type Look } from "../shared/edit";
import { COVER_TITLE_MAX, coverLookKey, FIX_STEPS, musicScenesKey, parseCharacter, parseVideo, pickedClip, pickedPicture, platformLabel, POST_LIMITS, speakerName, type CoverFrame, type CoverPlan, type FinalCheck, type PostKit, type StudioResult, type Video } from "../shared/studio";
import type { ApiProvider } from "../shared/settings";
import { describeClaudeError } from "./analyze";
import { editOps, LOOK_FILTERS } from "./edit";
import { mediaFilePath } from "./media";
import { ensureFfmpeg } from "./research";
import type { Store } from "./store";
import { recordClaude } from "./usage";

const run = promisify(execFile);
const EXE = process.platform === "win32" ? ".exe" : "";
/** At most this many frames are shown to Claude, so a check stays a few cents. */
const MAX_FRAMES = 14;
/** At most this many candidate frames are taken for the cover. */
const MAX_COVER_FRAMES = 12;

export type FinishContext = { dataDir: () => string; store: () => Store; key: (provider: ApiProvider) => string };

const FINAL_CHECK_SYSTEM = `You check a finished short vertical video (Reels, Shorts, TikTok) before the creator posts it. You see frames from the exported file at known times, the captions with their times, the script it was made from, and the effects that were planned.

Look for what a viewer would notice and what would make the video look unprofessional or wrong:
- AI picture faults: garbled hands or faces, extra limbs, warped objects, unreadable or misspelt writing inside the picture, things melting or changing shape.
- Continuity: a character who looks different from one scene to the next (face, hair, clothes), a prop or set that changes, light or time of day that jumps.
- The picture not matching the script: the wrong action, a missing person or object the words talk about.
- Captions: over a face or covering the action, too long to read, or not matching what is said.
- On-screen text or the end card: misspelt, cut off, or under the platform's buttons (the bottom fifth and the right edge).
- Pacing: a long stretch with nothing happening, an opening that does not grab in the first two seconds, an abrupt or missing ending.

Do not report taste, small things a viewer would not notice, or the stand-in pictures used where a scene has no clip yet (say so once in the summary instead).

For each problem give the time, the scene (numbered from 1; 0 when it is the whole video), what is wrong in one plain sentence, the fix in one sentence, and the step of the app where it is fixed: script (the words or what happens), cast (how a character looks or sounds), storyboard (what a scene shows), clips (redo the clip), music, effects (captions, transitions, sounds, look, end card), or export. serious is true only for what would make a viewer stop watching or doubt the creator. ok is true when nothing serious was found. The summary is one or two plain sentences.`;

const FinalCheckSchema = z.object({
  ok: z.boolean(),
  summary: z.string(),
  issues: z.array(z.object({ time: z.number(), scene: z.number(), problem: z.string(), fix: z.string(), step: z.enum(FIX_STEPS), serious: z.boolean() })),
});

const COVER_SYSTEM = `You choose the cover (the thumbnail) for a finished short vertical video (Reels, Shorts, TikTok): the picture people see in a profile grid and in search, and the few words laid over it. You are shown candidate frames, numbered from 0, with the scene each comes from and no captions or text on them, the script, and what the video is about.

A strong cover frame:
- has one clear subject (a face, or the key object) large and in focus, with a readable expression or a moment of tension or curiosity;
- is not blurred, mid-motion, dark, or caught with closed eyes, and shows none of the faults AI pictures have (garbled hands or faces, warped objects, unreadable writing);
- keeps the middle of the picture free enough for words, so the title does not sit on the subject's face;
- is true to the video: it promises what the video delivers, never bait.

A strong title is 2 to 6 words (never more than ${COVER_TITLE_MAX} characters), in the video's language, and makes someone want the rest: a question, a bold claim, a number, or a surprising turn that the video pays off. No emoji, no hashtags, no quotation marks.

Give three ideas, best first, each on a different frame: the frame number, the title, and one plain sentence on why that frame and those words would make people tap. Then one sentence saying what the covers are going for.

When the creator gave feedback on earlier ideas, change what they asked for and keep what they did not mention; say in one or two sentences what you changed. Otherwise leave the reply empty.`;

const CoverPlanSchema = z.object({
  summary: z.string(),
  reply: z.string(),
  ideas: z.array(z.object({ frame: z.number(), title: z.string(), why: z.string() })),
});

const POST_KIT_SYSTEM = `You write what a creator posts with a finished short video on TikTok, Instagram Reels and YouTube Shorts.

Write in the creator's voice and in the video's language. Each caption opens with a line that makes someone stop scrolling and want to watch, adds a little context or value, and ends with a light call to action (a question that invites comments works well). No more than two or three emoji, and none when the creator's voice is serious. Never make claims the video does not make.

Hashtags: a few specific ones beat many vague ones. TikTok: 3 to 5. Instagram: 3 to 8. YouTube: 2 to 3 (they show above the title). No spaces inside a hashtag; leave out the # sign.

Limits: TikTok caption up to ${POST_LIMITS.tiktokCaption} characters, but under 300 reads best. Instagram caption up to ${POST_LIMITS.instagramCaption}, under 400 reads best. YouTube title up to ${POST_LIMITS.youtubeTitle} characters, under 60 reads best, with the key words first. YouTube description: two or three short sentences.`;

const PostKitSchema = z.object({
  tiktok: z.object({ caption: z.string(), hashtags: z.array(z.string()) }),
  instagram: z.object({ caption: z.string(), hashtags: z.array(z.string()) }),
  youtube: z.object({ title: z.string(), description: z.string(), hashtags: z.array(z.string()) }),
});

export function finishOps(ctx: FinishContext) {
  const db = ctx.store;
  const edits = editOps(ctx);
  const findVideo = (id: unknown) => db().listDocs<unknown>("videos").map(parseVideo).find((v) => v.id === String(id));
  const saveVideo = (video: Video) => db().saveDoc("videos", { ...video, updatedAt: new Date().toISOString() });
  const ffmpeg = async () => {
    const dir = await ensureFfmpeg(ctx.dataDir());
    if (!dir) throw new Error("FFmpeg could not be set up on this computer. Check your internet connection and try again.");
    return join(dir, `ffmpeg${EXE}`);
  };

  /** One frame of a file at a time, as a JPEG. `height` 0 keeps the full size. */
  async function frameAt(source: string, time: number, height: number): Promise<Buffer> {
    const work = await mkdtemp(join(tmpdir(), "frame-"));
    try {
      const out = join(work, "f.jpg");
      await run(await ffmpeg(), ["-y", "-hide_banner", "-loglevel", "error", "-ss", Math.max(time, 0).toFixed(2), "-i", source, "-frames:v", "1", ...(height ? ["-vf", `scale=-2:${height}`] : []), "-q:v", height ? "5" : "2", out], { windowsHide: true });
      return await readFile(out);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  /** The video's last export from Studio, and where it is on disk. */
  function lastExport(videoId: string) {
    const render = edits.studioExport(videoId);
    const last = render?.exports[0];
    const path = last ? join(ctx.dataDir(), last.file) : "";
    return render && last && existsSync(path) ? { render, last, path } : null;
  }

  /**
   * A clean frame of a scene (no captions or text), at `time` seconds into its clip, sized to fill a vertical frame and
   * coloured as the video's look is. A scene with no clip uses its storyboard. False when the scene has nothing to take it from.
   */
  async function sceneFrame(video: Video, index: number, time: number, width: number, target: string): Promise<boolean> {
    const scene = video.scenes[index];
    const clip = scene && pickedClip(scene);
    const take = clip ?? (scene && pickedPicture(scene));
    const source = take ? mediaFilePath(ctx.dataDir(), take.file) : null;
    if (!source || !existsSync(source)) return false;
    const fx = video.effects;
    const move = fx?.moves.on ? fx.moves.scenes.find((m) => m.scene === index + 1) : undefined;
    const look = move?.look || (fx?.look.on ? fx.look.look : "");
    const height = Math.round((width * 16) / 9 / 2) * 2;
    const filter = [`scale=${width}:${height}:force_original_aspect_ratio=increase`, `crop=${width}:${height}`, look ? LOOK_FILTERS[look as Look] : ""].filter(Boolean).join(",");
    const bin = await ffmpeg();
    for (const at of clip ? [time, 0.3] : [0]) {
      await run(bin, ["-y", "-hide_banner", "-loglevel", "error", ...(clip ? ["-ss", Math.max(at, 0).toFixed(2)] : []), "-i", source, "-frames:v", "1", "-vf", filter, "-q:v", "3", target], { windowsHide: true }).catch(() => undefined);
      // A time past the end of a shorter clip makes no frame; then the start of it is used.
      if (existsSync(target)) return true;
    }
    return false;
  }

  return {
    /** Has Claude look at frames of the exported video and its timed captions, and say what a viewer would notice. Uses Claude credit. */
    async check(videoId: unknown): Promise<StudioResult<Video>> {
      const video = findVideo(videoId);
      if (!video) return { ok: false, error: "That video no longer exists." };
      const apiKey = ctx.key("anthropic");
      if (!apiKey) return { ok: false, error: "Add your Claude API key in Settings first." };
      const done = lastExport(video.id);
      if (!done) return { ok: false, error: "Export the video first." };
      const { render, last, path } = done;
      const cast = db().listDocs<unknown>("characters").map(parseCharacter);

      // A frame early in each clip and one in its middle, and one in the end card, up to the limit.
      const starts = clipStarts(render);
      const scenes = render.clips.map((c) => Number(/Scene (\d+)/.exec(render.assets.find((a) => a.id === c.assetId)?.name ?? "")?.[1] ?? 0));
      const times: { t: number; scene: number }[] = [];
      render.clips.forEach((c, i) => {
        const length = (c.out - c.in) / c.speed;
        times.push({ t: starts[i] + Math.min(0.5, length / 3), scene: scenes[i] });
        if (length > 2) times.push({ t: starts[i] + length / 2, scene: scenes[i] });
      });
      if (render.texts.some((x) => x.style === "label" && x.end >= last.seconds - 0.1)) times.push({ t: Math.max(last.seconds - 0.6, 0), scene: 0 });
      const picked = times.length > MAX_FRAMES ? times.filter((_, i) => i % Math.ceil(times.length / MAX_FRAMES) === 0) : times;
      let frames: { t: number; scene: number; data: string }[];
      try {
        frames = [];
        for (const f of picked.filter((f) => f.t < last.seconds)) frames.push({ ...f, data: (await frameAt(path, f.t, 640)).toString("base64") });
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Frames could not be taken from the video." };
      }

      const script = video.scenes
        .map((s, i) => `Scene ${i + 1}${scenes.includes(i + 1) ? ` (starts at ${showTime(starts[scenes.indexOf(i + 1)])})` : " (not in the export: no clip or picture yet)"}: ${s.action}${s.characters.length ? ` In it: ${s.characters.map((id) => cast.find((c) => c.id === id)?.name).filter(Boolean).join(", ")}.` : ""}${s.text ? ` On screen: "${s.text}".` : ""}${s.lines.length ? ` Said: ${s.lines.map((l) => `${speakerName(l.speaker, cast)}: ${l.text}`).join(" / ")}` : ""}`)
        .join("\n");
      const people = cast.filter((c) => video.scenes.some((s) => s.characters.includes(c.id))).map((c) => `${c.name}: ${c.look || c.role}`);
      const captions = render.showCaptions && render.captions.length ? render.captions.map((c) => `${showTime(c.start)} to ${showTime(c.end)}: ${c.words.map((w) => w.text).join(" ")}`).join("\n") : "No captions.";
      const texts = render.texts.map((x) => `${showTime(x.start)} to ${showTime(x.end)}, ${x.position}: "${x.text}"`).join("\n") || "None.";
      const stills = render.clips.filter((c) => render.assets.find((a) => a.id === c.assetId)?.kind === "image").length;

      try {
        const client = new Anthropic({ apiKey });
        const response = await client.beta.messages
          .stream({
            model: "claude-opus-5-5",
            max_tokens: 8000,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default" as const,
            system: FINAL_CHECK_SYSTEM,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: [
                      `THE VIDEO\n${video.title}, ${last.seconds.toFixed(1)} seconds${platformLabel(video.platform) ? `, for ${platformLabel(video.platform)}` : ""}.${stills ? ` ${stills} scene${stills === 1 ? " is" : "s are"} shown as a still storyboard because the clip is not made yet.` : ""}`,
                      people.length ? `THE CHARACTERS\n${people.join("\n")}` : "",
                      `THE SCRIPT\n${script}`,
                      `CAPTIONS\n${captions}`,
                      `TEXT OVER THE PICTURE\n${texts}`,
                      video.effects ? `PLANNED EFFECTS\n${video.effects.summary}` : "",
                      "FRAMES FROM THE EXPORTED VIDEO",
                    ]
                      .filter(Boolean)
                      .join("\n\n"),
                  },
                  ...frames.flatMap((f) => [
                    { type: "text" as const, text: `At ${showTime(f.t)}${f.scene ? ` (scene ${f.scene})` : " (the end)"}:` },
                    { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: f.data } },
                  ]),
                ],
              },
            ],
            output_config: { format: betaZodOutputFormat(FinalCheckSchema) },
          })
          .finalMessage();
        recordClaude("final_check", response.usage, video.title);
        if (response.stop_reason === "refusal") return { ok: false, error: "Claude declined to check this video." };
        const out = response.parsed_output;
        if (response.stop_reason === "max_tokens" || !out) return { ok: false, error: "The check came back incomplete. Try again." };
        const check: FinalCheck = {
          exportFile: last.file,
          at: new Date().toISOString(),
          ok: out.ok && !out.issues.some((x) => x.serious),
          summary: out.summary.trim(),
          issues: out.issues
            .map((x) => ({ time: Math.max(x.time, 0), scene: Math.max(0, Math.min(Math.round(x.scene), video.scenes.length)), problem: x.problem.trim(), fix: x.fix.trim(), step: x.step, serious: x.serious }))
            .filter((x) => x.problem)
            .sort((a, b) => Number(b.serious) - Number(a.serious) || a.time - b.time),
          costUsd: estimateCostUsd(response.usage),
        };
        const now = findVideo(video.id) ?? video;
        const saved = { ...now, finalCheck: check };
        saveVideo(saved);
        return { ok: true, value: saved };
      } catch (e) {
        return { ok: false, error: describeClaudeError(e) };
      }
    },

    /** Has Claude write the caption, hashtags, title and description for each platform. Uses Claude credit. */
    async postKit(videoId: unknown): Promise<StudioResult<Video>> {
      const video = findVideo(videoId);
      if (!video) return { ok: false, error: "That video no longer exists." };
      const apiKey = ctx.key("anthropic");
      if (!apiKey) return { ok: false, error: "Add your Claude API key in Settings first." };
      const brand = db().getBrand();
      const cast = db().listDocs<unknown>("characters").map(parseCharacter);
      const said = video.scenes.flatMap((s) => s.lines.map((l) => `${speakerName(l.speaker, cast)}: ${l.text}`)).join("\n");
      try {
        const client = new Anthropic({ apiKey });
        const response = await client.beta.messages
          .stream({
            model: "claude-opus-5-5",
            max_tokens: 4000,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default" as const,
            system: POST_KIT_SYSTEM,
            messages: [
              {
                role: "user",
                content: [
                  `THE VIDEO\n${video.title}${video.brief ? `\nAbout: ${video.brief}` : ""}${video.language ? `\nLanguage: ${video.language}` : ""}${video.claim ? `\nIts claim: ${video.claim.fact}` : ""}`,
                  video.caption ? `THE CAPTION WRITTEN WITH THE SCRIPT\n${video.caption}` : "",
                  said ? `WHAT IS SAID\n${said}` : "",
                  brand
                    ? `THE CREATOR\n${brand.name}${brand.topics.length ? `\nTopics: ${brand.topics.join(", ")}` : ""}${brand.audience ? `\nAudience: ${brand.audience}` : ""}${brand.voice.length ? `\nVoice: ${brand.voice.join(", ")}` : ""}${brand.platforms.some((p) => p.handle) ? `\nHandles: ${brand.platforms.filter((p) => p.handle).map((p) => `${p.platform} ${p.handle}`).join(", ")}` : ""}`
                    : "",
                ]
                  .filter(Boolean)
                  .join("\n\n"),
              },
            ],
            output_config: { format: betaZodOutputFormat(PostKitSchema) },
          })
          .finalMessage();
        recordClaude("post_kit", response.usage, video.title);
        if (response.stop_reason === "refusal") return { ok: false, error: "Claude declined to write the posting kit." };
        const out = response.parsed_output;
        if (response.stop_reason === "max_tokens" || !out) return { ok: false, error: "The posting kit came back incomplete. Try again." };
        const tags = (list: string[], most: number) => [...new Set(list.map((t) => t.replace(/^#+/, "").replace(/\s+/g, "")).filter(Boolean))].slice(0, most);
        const kit: PostKit = {
          at: new Date().toISOString(),
          tiktok: { caption: out.tiktok.caption.trim().slice(0, POST_LIMITS.tiktokCaption), hashtags: tags(out.tiktok.hashtags, 8) },
          instagram: { caption: out.instagram.caption.trim().slice(0, POST_LIMITS.instagramCaption), hashtags: tags(out.instagram.hashtags, POST_LIMITS.instagramHashtags) },
          youtube: { title: out.youtube.title.trim().slice(0, POST_LIMITS.youtubeTitle), description: out.youtube.description.trim().slice(0, POST_LIMITS.youtubeDescription), hashtags: tags(out.youtube.hashtags, 3) },
          costUsd: estimateCostUsd(response.usage),
        };
        const now = findVideo(video.id) ?? video;
        const saved = { ...now, postKit: kit };
        saveVideo(saved);
        return { ok: true, value: saved };
      } catch (e) {
        return { ok: false, error: describeClaudeError(e) };
      }
    },

    /**
     * Takes candidate frames from the scenes and has Claude pick the best three with the words for each. With `feedback`
     * (the creator's reply to the earlier picks) the same frames are looked at again and only what was asked changes.
     * Uses Claude credit.
     */
    async planCover(videoId: unknown, feedback: unknown): Promise<StudioResult<Video>> {
      const video = findVideo(videoId);
      if (!video) return { ok: false, error: "That video no longer exists." };
      const apiKey = ctx.key("anthropic");
      if (!apiKey) return { ok: false, error: "Add your Claude API key in Settings first." };
      const said = String(feedback ?? "").trim().slice(0, 1500);
      const key = musicScenesKey(video);
      const before = video.coverPlan;
      const reuse = Boolean(said && before && !before.skipped && before.scenesKey === key && before.frames.length > 0 && before.frames.every((f) => existsSync(join(ctx.dataDir(), f.file))));
      const cast = db().listDocs<unknown>("characters").map(parseCharacter);
      const brand = db().getBrand();

      let frames: CoverFrame[] = [];
      const made: string[] = [];
      if (reuse && before) frames = before.frames;
      else {
        // Up to two moments of each scene that has a clip (one when there are many scenes), thinned to the limit.
        const withClip = video.scenes.map((s, i) => ({ s, i })).filter(({ s }) => pickedClip(s));
        const pool = withClip.length > 0 ? withClip : video.scenes.map((s, i) => ({ s, i })).filter(({ s }) => pickedPicture(s));
        const spots = pool.flatMap(({ s, i }) => (withClip.length === 0 ? [{ i, t: 0 }] : pool.length > 6 ? [{ i, t: Math.max(s.seconds * 0.45, 0.2) }] : [{ i, t: Math.max(s.seconds * 0.3, 0.2) }, { i, t: Math.max(s.seconds * 0.65, 0.4) }]));
        const picked = spots.length > MAX_COVER_FRAMES ? spots.filter((_, n) => n % Math.ceil(spots.length / MAX_COVER_FRAMES) === 0).slice(0, MAX_COVER_FRAMES) : spots;
        if (picked.length === 0) return { ok: false, error: "Make the clips first: the cover is taken from a scene of the video." };
        await mkdir(join(ctx.dataDir(), "videos", video.id), { recursive: true });
        try {
          for (const spot of picked) {
            const name = `videos/${video.id}/cf-${randomUUID()}.jpg`;
            if (await sceneFrame(video, spot.i, spot.t, 540, join(ctx.dataDir(), name))) {
              made.push(name);
              frames.push({ scene: spot.i + 1, time: spot.t, file: name });
            }
          }
        } catch (e) {
          await Promise.all(made.map((f) => rm(join(ctx.dataDir(), f), { force: true })));
          return { ok: false, error: e instanceof Error ? e.message : "Frames could not be taken from the video." };
        }
        if (frames.length === 0) return { ok: false, error: "No picture could be taken from the scenes. Check that their clips play." };
      }

      const script = video.scenes
        .map((s, i) => `Scene ${i + 1}: ${s.action}${s.characters.length ? ` In it: ${s.characters.map((id) => cast.find((c) => c.id === id)?.name).filter(Boolean).join(", ")}.` : ""}${s.lines.length ? ` Said: ${s.lines.map((l) => `${speakerName(l.speaker, cast)}: ${l.text}`).join(" / ")}` : ""}`)
        .join("\n");
      const earlier = reuse && before ? `WHAT YOU SUGGESTED BEFORE\n${before.ideas.map((x) => `Frame ${x.frame}: "${x.title}"`).join("\n")}${before.rounds.length ? `\n\nTHE FEEDBACK SO FAR\n${before.rounds.map((r) => `Creator: ${r.feedback}${r.reply ? `\nYou: ${r.reply}` : ""}`).join("\n")}` : ""}\n\nTHE CREATOR NOW SAYS\n${said}` : "";
      try {
        const client = new Anthropic({ apiKey });
        const response = await client.beta.messages
          .stream({
            model: "claude-opus-5-5",
            max_tokens: 4000,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default" as const,
            system: COVER_SYSTEM,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: [
                      `THE VIDEO\n${video.title}${video.brief ? `\nAbout: ${video.brief}` : ""}${platformLabel(video.platform) ? `\nFor: ${platformLabel(video.platform)}` : ""}${video.language ? `\nLanguage: ${video.language}` : ""}${video.claim ? `\nIts claim: ${video.claim.fact}` : ""}${video.hooks.length ? `\nIts opening hooks: ${video.hooks.join(" / ")}` : ""}`,
                      brand ? `THE CREATOR\n${brand.name}${brand.topics.length ? `\nTopics: ${brand.topics.join(", ")}` : ""}${brand.audience ? `\nAudience: ${brand.audience}` : ""}${brand.voice.length ? `\nVoice: ${brand.voice.join(", ")}` : ""}` : "",
                      `THE SCRIPT\n${script}`,
                      earlier,
                      "CANDIDATE FRAMES",
                    ]
                      .filter(Boolean)
                      .join("\n\n"),
                  },
                  ...(await Promise.all(frames.map(async (f, n) => [
                    { type: "text" as const, text: `Frame ${n} (scene ${f.scene}, ${f.time.toFixed(1)}s in):` },
                    { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: (await readFile(join(ctx.dataDir(), f.file))).toString("base64") } },
                  ]))).flat(),
                ],
              },
            ],
            output_config: { format: betaZodOutputFormat(CoverPlanSchema) },
          })
          .finalMessage();
        recordClaude("cover_plan", response.usage, video.title);
        const out = response.parsed_output;
        const fail = response.stop_reason === "refusal" ? "Claude declined to choose a cover." : response.stop_reason === "max_tokens" || !out ? "The cover ideas came back incomplete. Try again." : "";
        if (fail || !out) {
          await Promise.all(made.map((f) => rm(join(ctx.dataDir(), f), { force: true })));
          return { ok: false, error: fail };
        }
        const seen = new Set<number>();
        const ideas = out.ideas
          .map((x) => ({ frame: Math.round(x.frame), title: x.title.replace(/["“”]/g, "").trim().slice(0, COVER_TITLE_MAX), why: x.why.trim() }))
          .filter((x) => x.frame >= 0 && x.frame < frames.length && !seen.has(x.frame) && seen.add(x.frame))
          .slice(0, 4);
        if (ideas.length === 0) {
          await Promise.all(made.map((f) => rm(join(ctx.dataDir(), f), { force: true })));
          return { ok: false, error: "Claude gave no usable cover ideas. Try again." };
        }
        const plan: CoverPlan = {
          summary: out.summary.trim(),
          frames,
          ideas,
          rounds: [...(reuse && before ? before.rounds : []), ...(said ? [{ feedback: said, reply: out.reply.trim(), at: new Date().toISOString() }] : [])],
          scenesKey: key,
          lookKey: reuse && before ? before.lookKey : coverLookKey(video),
          skipped: false,
          costUsd: (reuse && before ? before.costUsd : 0) + estimateCostUsd(response.usage),
        };
        const now = findVideo(video.id) ?? video;
        // Frames of an earlier plan are removed, and a cover already made needs approving again.
        if (!reuse) await Promise.all((now.coverPlan?.frames ?? []).map((f) => rm(join(ctx.dataDir(), f.file), { force: true })));
        const saved = { ...now, coverPlan: plan, cover: now.cover ? { ...now.cover, approvedAt: "" } : null };
        saveVideo(saved);
        return { ok: true, value: saved };
      } catch (e) {
        await Promise.all(made.map((f) => rm(join(ctx.dataDir(), f), { force: true })));
        return { ok: false, error: describeClaudeError(e) };
      }
    },

    /**
     * Takes the same candidate frames again, with the look as it is now (no Claude, no cost). Claude's picks keep their
     * frames; a cover already made needs making again, and approving.
     */
    async retakeCoverFrames(videoId: unknown): Promise<StudioResult<Video>> {
      const video = findVideo(videoId);
      const plan = video?.coverPlan;
      if (!video || !plan || plan.frames.length === 0) return { ok: false, error: "There are no cover frames to take again." };
      const made: CoverFrame[] = [];
      try {
        for (const f of plan.frames) {
          const name = `videos/${video.id}/cf-${randomUUID()}.jpg`;
          if (!(await sceneFrame(video, f.scene - 1, f.time, 540, join(ctx.dataDir(), name)))) throw new Error(`Scene ${f.scene} has no clip or picture to take a frame from.`);
          made.push({ ...f, file: name });
        }
      } catch (e) {
        await Promise.all(made.map((f) => rm(join(ctx.dataDir(), f.file), { force: true })));
        return { ok: false, error: e instanceof Error ? e.message : "The frames could not be taken again." };
      }
      const now = findVideo(video.id) ?? video;
      await Promise.all(plan.frames.map((f) => rm(join(ctx.dataDir(), f.file), { force: true })));
      const saved = { ...now, coverPlan: { ...plan, frames: made, lookKey: coverLookKey(video) }, cover: now.cover ? { ...now.cover, approvedAt: "" } : null };
      saveVideo(saved);
      return { ok: true, value: saved };
    },

    /**
     * Makes the cover picture from a frame of one scene (`time` seconds into its clip), with the title laid over it when
     * `overlay` (a full-frame transparent PNG drawn by the interface) is given. Kept in the video's own folder. A new
     * cover needs approving.
     */
    async cover(videoId: unknown, scene: unknown, time: unknown, title: unknown, overlay: unknown): Promise<StudioResult<Video>> {
      const video = findVideo(videoId);
      if (!video) return { ok: false, error: "That video no longer exists." };
      const index = Math.min(Math.max(Math.round(Number(scene) || 1) - 1, 0), Math.max(video.scenes.length - 1, 0));
      const at = Math.max(Number(time) || 0, 0);
      const work = await mkdtemp(join(tmpdir(), "cover-"));
      try {
        const frame = join(work, "frame.jpg");
        if (!(await sceneFrame(video, index, at, 1080, frame))) return { ok: false, error: "That scene has no clip or picture to take the cover from." };
        const name = `videos/${video.id}/cover-${randomUUID()}.jpg`;
        const target = join(ctx.dataDir(), name);
        await mkdir(join(ctx.dataDir(), "videos", video.id), { recursive: true });
        const png = /^data:image\/png;base64,(.+)$/.exec(String(overlay ?? ""));
        if (png) {
          const layer = join(work, "title.png");
          await writeFile(layer, Buffer.from(png[1], "base64"));
          await run(await ffmpeg(), ["-y", "-hide_banner", "-loglevel", "error", "-i", frame, "-i", layer, "-filter_complex", "[1:v]scale=1080:1920[t];[0:v]scale=1080:1920[f];[f][t]overlay=0:0", "-frames:v", "1", "-q:v", "2", target], { windowsHide: true });
        } else {
          await run(await ffmpeg(), ["-y", "-hide_banner", "-loglevel", "error", "-i", frame, "-vf", "scale=1080:1920", "-frames:v", "1", "-q:v", "2", target], { windowsHide: true });
        }
        // The cover it replaces is removed.
        const now = findVideo(video.id) ?? video;
        if (now.cover) await rm(join(ctx.dataDir(), now.cover.file), { force: true });
        const saved = { ...now, cover: { file: name, scene: index + 1, time: at, title: String(title ?? "").trim().slice(0, COVER_TITLE_MAX), approvedAt: "" } };
        saveVideo(saved);
        return { ok: true, value: saved };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "The cover could not be made." };
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    },

    /** Approves the cover, takes the approval back (false), or chooses to post without a cover of its own ("skip"). */
    approveCover(videoId: unknown, value: unknown): StudioResult<Video> {
      const video = findVideo(videoId);
      if (!video) return { ok: false, error: "That video no longer exists." };
      const plan: CoverPlan = video.coverPlan ?? { summary: "", frames: [], ideas: [], rounds: [], scenesKey: musicScenesKey(video), lookKey: coverLookKey(video), skipped: false, costUsd: 0 };
      let saved: Video;
      if (value === "skip") saved = { ...video, coverPlan: { ...plan, skipped: true, scenesKey: musicScenesKey(video) } };
      else if (value === true) {
        if (!video.cover) return { ok: false, error: "Make the cover first." };
        saved = { ...video, coverPlan: { ...plan, skipped: false }, cover: { ...video.cover, approvedAt: new Date().toISOString() } };
      } else saved = { ...video, coverPlan: plan.frames.length > 0 ? { ...plan, skipped: false } : null, cover: video.cover ? { ...video.cover, approvedAt: "" } : null };
      saveVideo(saved);
      return { ok: true, value: saved };
    },
  };
}
