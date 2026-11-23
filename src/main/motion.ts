// Motion graphics videos are made by Claude from start to end: it designs the look of the whole
// video once, then writes each scene as markup and CSS animations that the app plays and renders.
// Plain Node code with relative imports only (used by the desktop app and the dev server).
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { estimateCostUsd } from "../shared/analysis";
import type { BrandKit } from "../shared/brand";
import { cleanCss, cleanMarkup, STAGE } from "../shared/motion";
import { speakerName, type StudioResult, type Video } from "../shared/studio";
import { describeClaudeError } from "./analyze";
import { recordClaude } from "./usage";

const DesignSchema = z.object({ css: z.string() });
const SceneSchema = z.object({ html: z.string(), css: z.string() });

/** What every animation has to obey to play and render in the app. Shared by both prompts. */
const HOUSE_RULES = `HOW THE ANIMATIONS RUN
- Each scene is drawn inside a stage of exactly ${STAGE.width} by ${STAGE.height} pixels (a vertical 9:16 phone screen). Position things in pixels within it; nothing may spill outside.
- Everything moves through CSS animations (@keyframes with animation-duration and animation-delay) only. The app pauses every animation and sets its time itself, to play it and to render it frame by frame, so anything that does not run on a CSS animation timeline will not move. No JavaScript, no <script>, no event handlers, no transitions triggered by hover or classes, no SMIL (<animate>), no <video>, <canvas> or <iframe>.
- Nothing may be loaded from anywhere: no web fonts, no images by address, no @import, no url() to a site. Draw with HTML elements, CSS (gradients, borders, shadows, clip-path, transforms, filters) and inline SVG. Use the system font stack already set on the stage; weight and size carry the character.
- Give every animation "animation-fill-mode: both" so things rest where they should before they start and after they end.
- Keep the outer 80 pixels on the left and right and the top 200 and bottom 320 pixels free of text and anything that matters: phone apps cover those edges.
- Text must be large enough to read on a phone: body text at least 56 pixels, headline words 96 pixels or more. A viewer reads about three words a second, so never show more than about eight words at once.`;

const DESIGN_SYSTEM = `You are the motion designer of a short vertical video made entirely as motion graphics: animated type, shapes, icons and simple diagrams, with no photographs and no drawn people. Before any scene is animated you set the look the whole video shares, as one CSS stylesheet that every scene is built on. A separate request will animate each scene using only what you define here plus its own scene styles.

${HOUSE_RULES}

Write the stylesheet:
- :root variables for the palette (a background, a surface, text, a muted text, a primary, an accent and anything else the video needs), built from the creator's brand colours when they are given, with enough contrast to read at a glance.
- Type classes: at least .title, .headline, .body, .label and .number, with sizes, weights, line-heights and letter-spacing that suit a phone.
- Layout helpers: a full-stage background class (.bg and variants), a safe-area container (.safe) that keeps content inside the margins, and a few simple arrangement classes (centred stack, top block, bottom block).
- Reusable motion: named @keyframes for the moves the whole video will use (things arriving, leaving, drawing on, counting attention), and helper classes that apply them, each taking its timing from --delay and --dur custom properties so a scene can stagger them (for example: .in-up { animation: in-up var(--dur, .6s) cubic-bezier(.2,.8,.2,1) var(--delay, 0s) both }). Give the motion one character: the same easing family and the same sense of weight throughout.
- A recurring device that ties the scenes together: one shape, line or texture that can appear in every scene.
Give only the stylesheet in "css", with short comments naming each part. No markup.`;

const SCENE_SYSTEM = `You animate ONE scene of a short vertical video made entirely as motion graphics: animated type, shapes, icons and simple diagrams, with no photographs and no drawn people. The video's shared stylesheet is given to you and is already loaded; build the scene from its variables, classes and keyframes so every scene looks like the same video, and add only what this scene needs in its own CSS.

${HOUSE_RULES}

THE SCENE
- It lasts exactly the number of seconds given. Plan it as beats: something is moving in the first half second, each idea arrives as it is said, and the last second holds a clear, complete frame. Nothing still animates after the scene's length.
- When words are spoken over the scene, the animation follows the voice at about 2.5 words a second: the thing being named arrives as it is named. Do not put the whole spoken line on screen; show the few words or the number that matter, and let pictures (icons, charts, shapes) carry the rest.
- When on-screen words are given for the scene, they must appear, exactly as written.
- Show, do not decorate: every element helps the viewer understand the point. One idea on screen at a time.
- Draw icons and diagrams as inline SVG with simple, confident shapes. Lines can draw on with stroke-dasharray and stroke-dashoffset; shapes can grow, slide, rotate and fade with transforms and opacity. Animate transform and opacity wherever possible.
- Scenes are cut together one after another, so start from the shared background and end on a frame that can be cut away from.

Answer with "html" (what goes inside the stage: no <html>, <head>, <body>, <style> or <script>) and "css" (this scene's own styles and keyframes; prefix its class names with "s-" so they do not collide with the shared stylesheet).`;

const describeVideo = (video: Video, brand: BrandKit, look: string) =>
  [
    `THE VIDEO\nTitle: ${video.title}${video.overlay ? `\nOpening words on screen: ${video.overlay}` : ""}${look ? `\nLook the creator asked for: ${look}` : ""}`,
    `THE BRAND\nName: ${brand.name}\nColours: ${brand.colors.map((c) => `${c.role} ${c.hex}${c.name ? ` (${c.name})` : ""}`).join(", ")}`,
    `THE SCENES\n${video.scenes
      .map((s, i) => `${i + 1}. (${s.seconds}s) ${s.action}${s.text ? ` On screen: "${s.text}".` : ""}${s.lines.length ? ` Said: ${s.lines.map((l) => l.text).join(" ")}` : ""}`)
      .join("\n")}`,
  ].join("\n\n");

/** The look the whole video shares: one stylesheet every scene is built on. */
export async function designMotion(apiKey: string, input: { video: Video; brand: BrandKit; look: string }): Promise<StudioResult<{ css: string; costUsd: number }>> {
  if (!apiKey) return { ok: false, error: "Add your Claude API key in Settings first." };
  try {
    const client = new Anthropic({ apiKey });
    const response = await client.beta.messages
      .stream({
        model: "claude-opus-5-5",
        max_tokens: 32000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default" as const,
        system: DESIGN_SYSTEM,
        messages: [{ role: "user", content: describeVideo(input.video, input.brand, input.look) }],
        output_config: { format: betaZodOutputFormat(DesignSchema) },
      })
      .finalMessage();
    recordClaude("animation", response.usage, `${input.video.title} · design`);
    if (response.stop_reason === "refusal") return { ok: false, error: "Claude declined to design this video." };
    const out = response.parsed_output;
    if (response.stop_reason === "max_tokens" || !out || !out.css.trim()) return { ok: false, error: "The design came back incomplete. Try again." };
    return { ok: true, value: { css: cleanCss(out.css), costUsd: estimateCostUsd(response.usage) } };
  } catch (e) {
    return { ok: false, error: describeClaudeError(e) };
  }
}

/**
 * One scene as markup and CSS animations, built on the video's design. With `note` and `current`
 * it is the current animation changed as the note says, not a new one.
 */
export async function animateScene(
  apiKey: string,
  input: { video: Video; brand: BrandKit; look: string; design: string; index: number; note?: string; current?: { html: string; css: string } },
): Promise<StudioResult<{ html: string; css: string; costUsd: number }>> {
  if (!apiKey) return { ok: false, error: "Add your Claude API key in Settings first." };
  const { video, index } = input;
  const scene = video.scenes[index];
  if (!scene) return { ok: false, error: "That scene no longer exists." };
  const said = scene.lines.map((l) => `${speakerName(l.speaker, [])}: ${l.text}`).join("\n");
  try {
    const client = new Anthropic({ apiKey });
    const response = await client.beta.messages
      .stream({
        model: "claude-opus-5-5",
        max_tokens: 32000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default" as const,
        system: SCENE_SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              describeVideo(video, input.brand, input.look),
              `THE SHARED STYLESHEET (already loaded)\n${input.design}`,
              `ANIMATE SCENE ${index + 1} OF ${video.scenes.length}\nLength: exactly ${scene.seconds} seconds.\nWhat it shows: ${scene.action}${scene.camera ? `\nMovement: ${scene.camera}` : ""}${scene.text ? `\nWords on screen, exactly: "${scene.text}"` : ""}${
                said ? `\nSpoken over it (${scene.lines.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0)} words):\n${said}` : "\nNothing is spoken over it."
              }${index === 0 ? "\nIt opens the video: the first frame must stop someone scrolling." : ""}${index === video.scenes.length - 1 ? "\nIt ends the video: leave the viewer on what to do next." : ""}`,
              input.note && input.current
                ? `THE CURRENT ANIMATION OF THIS SCENE, WHICH THE CREATOR SENT BACK\nhtml:\n${input.current.html}\n\ncss:\n${input.current.css}\n\nTHE CREATOR'S NOTE: ${input.note}\nChange what the note asks for and keep the rest as it is.`
                : input.note
                  ? `THE CREATOR'S NOTE: ${input.note}`
                  : "",
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ],
        output_config: { format: betaZodOutputFormat(SceneSchema) },
      })
      .finalMessage();
    recordClaude("animation", response.usage, `${video.title} · scene ${index + 1}`);
    if (response.stop_reason === "refusal") return { ok: false, error: "Claude declined to animate this scene." };
    const out = response.parsed_output;
    if (response.stop_reason === "max_tokens" || !out || !out.html.trim()) return { ok: false, error: "The animation came back incomplete. Try again." };
    return { ok: true, value: { html: cleanMarkup(out.html), css: cleanCss(out.css), costUsd: estimateCostUsd(response.usage) } };
  } catch (e) {
    return { ok: false, error: describeClaudeError(e) };
  }
}
