// Plays a whole video from the top, at any stage: a scene's clip where it has one, and otherwise its storyboard
// frame by frame with the recorded voices (or each line held for as long as it takes to say).
import { useEffect, useMemo, useRef, useState } from "react";
import { estimateWords, TRANSITION_SECONDS, wordsToCaptions, type Look, type Motion } from "@shared/edit";
import { pickedClip, pickedPicture, speakerName, type Character, type Scene, type SceneLine, type Video } from "@shared/studio";
import { api } from "./api";
import { drawCaption, fontsReady } from "./EditDraw";
import { LOOK_CSS } from "./EditPreview";
import { MotionPlayer } from "./MotionBoard";
import { Icon, ICONS, WORDS_PER_SECOND } from "./studioUi";

const FRAMES = 4;
const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;
const sayFor = (line: SceneLine | null, scene: Scene) => (line ? Math.max(countWords(line.text) / WORDS_PER_SECOND, 1.2) : scene.seconds);

/** A scene's camera move `p` of the way through it, as a CSS transform (close to what the export does). */
function motionCss(motion: Motion, p: number, intoScene: number) {
  switch (motion) {
    case "zoom-in":
      return `scale(${1 + 0.12 * p})`;
    case "zoom-out":
      return `scale(${1.12 - 0.12 * p})`;
    case "punch-in":
      return "scale(1.18)";
    case "pan-left":
      return `scale(1.15) translateX(${(-6.5 + 13 * p).toFixed(2)}%)`;
    case "pan-right":
      return `scale(1.15) translateX(${(6.5 - 13 * p).toFixed(2)}%)`;
    case "shake": {
      // A short shake as the scene starts, dying away.
      const left = Math.max(1 - intoScene / 0.5, 0);
      return `scale(1.1) translate(${(Math.sin(intoScene * 70) * 2.2 * left).toFixed(2)}%, ${(Math.cos(intoScene * 55) * 1.6 * left).toFixed(2)}%)`;
    }
    default:
      return "";
  }
}

export function Player({
  video,
  cast,
  onClose,
  inline,
}: {
  video: Video;
  cast: Character[];
  onClose?: () => void;
  /** Shown in the page (the Export step) rather than over it: it waits to be played and has a row of scenes to jump to. */
  inline?: boolean;
}) {
  // One step per spoken line, one for a scene nobody speaks in, and one for a scene with a clip (the clip plays whole).
  const steps = useMemo(
    () =>
      video.scenes.flatMap((scene, sceneIndex): { scene: Scene; sceneIndex: number; line: SceneLine | null }[] =>
        pickedClip(scene) || scene.lines.length === 0 ? [{ scene, sceneIndex, line: null }] : scene.lines.map((line) => ({ scene, sceneIndex, line })),
      ),
    [video],
  );
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(!inline);
  const step = steps[Math.min(at, steps.length - 1)];
  const clip = step ? pickedClip(step.scene) : undefined;
  const picture = step ? pickedPicture(step.scene) : undefined;
  const clipRef = useRef<HTMLVideoElement>(null);
  const lineAudio = useRef<HTMLAudioElement | null>(null);
  // The video's planned effects, shown here as they will be in the finished video.
  const fx = video.effects;
  const stage = useRef<HTMLDivElement>(null);
  const cover = useRef<HTMLDivElement>(null);
  const captions = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const endCard = useRef<HTMLParagraphElement>(null);
  /** When the current step started, for steps timed by the clock rather than by a clip or a recording. */
  const clock = useRef({ start: performance.now(), held: 0 });

  // Each line of a scene gets its share of the storyboard's four frames, stepped through while it plays.
  const inScene = steps.filter((s) => s.scene.id === step?.scene.id);
  const place = step ? inScene.indexOf(step) : 0;
  const firstFrame = Math.floor((place * FRAMES) / Math.max(inScene.length, 1));
  const lastFrame = Math.max(firstFrame, Math.floor(((place + 1) * FRAMES) / Math.max(inScene.length, 1)) - 1);
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    setFrame(firstFrame);
    if (!playing || !step || clip || lastFrame === firstFrame) return;
    const timer = setInterval(() => setFrame((f) => Math.min(f + 1, lastFrame)), (sayFor(step.line, step.scene) * 1000) / (lastFrame - firstFrame + 1));
    return () => clearInterval(timer);
  }, [at, playing, firstFrame, lastFrame]);

  useEffect(() => {
    const current = steps[at];
    if (!current) return setPlaying(false);
    const next = () => (at + 1 < steps.length ? setAt(at + 1) : setPlaying(false));
    if (pickedClip(current.scene)) {
      const el = clipRef.current;
      if (!el) return;
      if (!playing) return void el.pause();
      el.addEventListener("ended", next);
      el.play().catch(next);
      return () => el.removeEventListener("ended", next);
    }
    if (!playing) return;
    if (current.line?.audioFile) {
      const audio = new Audio(api.audioFileUrl(current.line.audioFile));
      lineAudio.current = audio;
      audio.addEventListener("ended", next);
      audio.addEventListener("error", next);
      audio.play().catch(next);
      return () => {
        audio.removeEventListener("ended", next);
        audio.removeEventListener("error", next);
        audio.pause();
        lineAudio.current = null;
      };
    }
    const timer = setTimeout(next, sayFor(current.line, current.scene) * 1000);
    return () => clearTimeout(timer);
  }, [playing, at, steps]);

  // The approved or planned music: the piece under the scene now playing, started where these scenes come in it.
  const musicEls = useRef(new Map<string, HTMLAudioElement>());
  const musicNow = useRef("");
  useEffect(() => {
    const cue = step ? video.music?.cues.find((c) => c.audioFile && c.madeFrom === c.prompt && step.sceneIndex + 1 >= c.fromScene && step.sceneIndex + 1 <= c.toScene) : undefined;
    for (const [id, el] of musicEls.current) if (id !== cue?.id) el.pause();
    if (!cue || !step) {
      musicNow.current = "";
      return;
    }
    let el = musicEls.current.get(cue.id);
    if (!el) {
      el = new Audio(api.audioFileUrl(cue.audioFile));
      musicEls.current.set(cue.id, el);
    }
    if (musicNow.current !== cue.id) {
      el.currentTime = video.scenes.slice(cue.fromScene - 1, step.sceneIndex).reduce((n, s) => n + s.seconds, 0);
      musicNow.current = cue.id;
    }
    // Lower while a line is spoken, a little fuller under pictures alone.
    el.volume = Math.min(step.line ? cue.volume : cue.volume * 1.5, 1);
    if (playing) void el.play().catch(() => undefined);
    else el.pause();
  }, [at, playing, video.music]);
  useEffect(() => () => musicEls.current.forEach((el) => el.pause()), []);

  // ---------- Effects ----------

  // The step clock starts again with each step, and holds still while paused.
  useEffect(() => {
    clock.current = { start: performance.now(), held: 0 };
  }, [at]);
  useEffect(() => {
    if (playing) clock.current.start = performance.now() - clock.current.held * 1000;
    else clock.current.held = (performance.now() - clock.current.start) / 1000;
  }, [playing]);

  /** How far into the current step, and how long it lasts, in seconds. */
  function stepTime() {
    const el = clipRef.current;
    if (step && pickedClip(step.scene) && el) return { e: el.currentTime, d: el.duration || step.scene.seconds };
    const audio = lineAudio.current;
    if (audio && Number.isFinite(audio.duration) && audio.duration > 0) return { e: audio.currentTime, d: audio.duration };
    const e = playing ? (performance.now() - clock.current.start) / 1000 : clock.current.held;
    return { e, d: step ? sayFor(step.line, step.scene) : 1 };
  }

  // Draws the effects many times a second: the look, the camera move, how the scene comes in, and the captions.
  useEffect(() => {
    if (!fx || !step) return;
    let frameId = 0;
    void fontsReady();
    const draw = () => {
      const { e, d } = stepTime();
      const p = Math.min(Math.max(e / Math.max(d, 0.01), 0), 1);
      const sceneP = (place + p) / Math.max(inScene.length, 1);
      const intoScene = place === 0 ? e : 99;
      const move = fx.moves.on ? fx.moves.scenes.find((m) => m.scene === step.sceneIndex + 1) : undefined;
      const look: Look = (move?.look || (fx.look.on ? fx.look.look : "none")) as Look;
      const into = move && intoScene < TRANSITION_SECONDS ? 1 - intoScene / TRANSITION_SECONDS : 0;
      if (stage.current) {
        const zoomIn = move?.transition === "zoom" && into > 0 ? `scale(${1 + 0.3 * into})` : "";
        const whip = move?.transition === "whip" && into > 0 ? `translateX(${(into * 15).toFixed(1)}%)` : "";
        stage.current.style.transform = [whip, zoomIn, move ? motionCss(move.motion, sceneP, intoScene) : ""].filter(Boolean).join(" ") || "none";
        const blur = move?.transition === "whip" && into > 0 ? `blur(${(into * 18).toFixed(1)}px)` : "";
        stage.current.style.filter = [LOOK_CSS[look] === "none" ? "" : LOOK_CSS[look], blur].filter(Boolean).join(" ") || "none";
      }
      if (cover.current) {
        const shows = move && (move.transition === "fade" || move.transition === "flash") && into > 0;
        cover.current.style.opacity = shows ? String(into) : "0";
        cover.current.style.background = move?.transition === "flash" ? "#ffffff" : "#000000";
      }
      // The end card over the last seconds of the last step.
      if (endCard.current) {
        const showing = fx.endCard.on && at === steps.length - 1 && d - e <= fx.endCard.seconds;
        if (showing && endCard.current.style.opacity !== "1") endCard.current.animate([{ transform: "scale(0.3)" }, { transform: "scale(1.1)", offset: 0.7 }, { transform: "scale(1)" }], { duration: 380, easing: "ease-out" });
        endCard.current.style.opacity = showing ? "1" : "0";
      }
      const ctx = captions.current?.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        const text = step.line ? step.line.text : pickedClip(step.scene) ? step.scene.lines.map((l) => l.text).join(" ") : "";
        if (fx.captions.on && text) {
          // The words as heard in the recording when it has been timed; otherwise spread over it.
          const heard = step.line?.words?.length && step.line.wordsFor === step.line.audioId && lineAudio.current ? step.line.words : null;
          const caption = wordsToCaptions(heard ?? estimateWords(text, d), fx.captions.wordsAtATime).find((c) => e >= c.start && e < c.end);
          if (caption) drawCaption(ctx, caption, fx.captions.style, e, ctx.canvas.width, ctx.canvas.height);
        }
      }
      frameId = requestAnimationFrame(draw);
    };
    frameId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameId);
  });

  // On-screen text pops in as its scene starts.
  useEffect(() => {
    if (fx?.textPop && place === 0 && textRef.current) {
      textRef.current.animate([{ transform: "scale(0.3)", opacity: 0 }, { transform: "scale(1.12)", opacity: 1, offset: 0.7 }, { transform: "scale(1)", opacity: 1 }], { duration: 380, easing: "ease-out" });
    }
  }, [at, fx?.textPop]);

  // Sound effects, each at its moment in its scene.
  useEffect(() => {
    if (!playing || !fx?.sounds.on || !step || place !== 0) return;
    const { e } = stepTime();
    const playingNow: HTMLAudioElement[] = [];
    const timers = fx.sounds.items
      .filter((s) => s.scene === step.sceneIndex + 1 && s.audioFile && s.madeFrom === s.prompt && s.at >= e - 0.05)
      .map((s) =>
        window.setTimeout(() => {
          const audio = new Audio(api.audioFileUrl(s.audioFile));
          audio.volume = Math.min(s.volume, 1);
          playingNow.push(audio);
          void audio.play().catch(() => undefined);
        }, Math.max((s.at - e) * 1000, 0)),
      );
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      playingNow.forEach((a) => a.pause());
    };
  }, [step?.sceneIndex, playing]);

  useEffect(() => {
    // In the page, the keys belong to the page.
    if (inline) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, inline]);

  if (!step) return null;
  const round = "flex h-10 w-10 items-center justify-center rounded-full border border-white/30 text-white hover:border-white disabled:opacity-35";
  const made = video.scenes.filter((s) => pickedClip(s)).length;

  const jump = (sceneIndex: number) => {
    setAt(steps.findIndex((s) => s.sceneIndex === sceneIndex));
    setPlaying(true);
  };

  return (
    <div
      role={inline ? "region" : "dialog"}
      aria-modal={inline ? undefined : true}
      aria-label={`Play ${video.title}`}
      className={inline ? "flex flex-col items-center" : "fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/90 p-6"}
      onClick={inline ? undefined : onClose}
    >
      <div className={`flex flex-col items-center gap-4 ${inline ? "w-full rounded-3xl bg-black p-5" : ""}`} onClick={(e) => e.stopPropagation()}>
        <p className="text-center text-sm text-white/70">
          {made === video.scenes.length ? "Every scene from its clip" : made > 0 ? `${made} of ${video.scenes.length} scenes from their clips, the rest from the storyboard` : "From the storyboard, with the voices"}
        </p>
        <div className={`relative flex aspect-[9/16] ${inline ? "h-[min(58vh,560px)]" : "h-[min(70vh,640px)]"} flex-col overflow-hidden rounded-[2rem] border border-white/20 bg-black p-5 text-white`}>
          {/* The picture, which the look, the camera move and the transition act on. */}
          <div ref={stage} className="absolute inset-0 overflow-hidden" style={{ transformOrigin: "center" }}>
            {clip ? (
              <video key={clip.id} ref={clipRef} src={api.studioFileUrl(clip.file)} playsInline className="absolute inset-0 h-full w-full object-cover" />
            ) : step.scene.animation ? (
              <MotionPlayer key={step.scene.animation.id} video={video} scene={step.scene} className="absolute inset-0 h-full w-full" />
            ) : (
              picture && (
                // The sheet is shown at twice the size and moved so only the current frame fills the screen.
                <img
                  src={api.studioFileUrl(picture.file)}
                  alt={`Storyboard frame ${frame + 1} of scene ${step.sceneIndex + 1}`}
                  className="absolute h-[200%] w-[200%] max-w-none object-fill"
                  style={{ left: `${-(frame % 2) * 100}%`, top: `${-Math.floor(frame / 2) * 100}%` }}
                />
              )
            )}
          </div>
          <div ref={cover} className="pointer-events-none absolute inset-0 opacity-0" />
          {fx?.captions.on && <canvas ref={captions} width={540} height={960} className="pointer-events-none absolute inset-0 h-full w-full" />}
          {fx?.endCard.on && (
            <p ref={endCard} className="pointer-events-none absolute inset-x-6 top-[45%] mx-auto w-fit rounded-2xl bg-black/65 px-4 py-2 text-center text-lg font-semibold opacity-0">
              {fx.endCard.text}
            </p>
          )}
          <p className="relative w-fit rounded-full bg-black/55 px-2 py-0.5 text-xs">
            Scene {step.sceneIndex + 1} of {video.scenes.length}
            {!clip && step.scene.madeBy === "me" ? " · you film this" : ""}
          </p>
          {!clip && step.scene.text && (
            <p ref={textRef} className="relative mt-4 text-center text-xl font-bold leading-tight [text-shadow:0_1px_4px_#000]">
              {step.scene.text}
            </p>
          )}
          <p className="relative my-auto text-center text-sm italic leading-relaxed opacity-70">{clip || picture || step.scene.animation ? "" : step.scene.action}</p>
          {!clip && step.line && !fx?.captions.on && (
            <p className="relative rounded-xl bg-black/65 px-3 py-2 text-center text-sm font-medium leading-snug">
              <span className="block text-[0.7rem] font-normal uppercase tracking-wide opacity-70">{speakerName(step.line.speaker, cast)}</span>
              {step.line.text}
            </p>
          )}
        </div>
        <div className="flex w-full gap-1" aria-hidden>
          {steps.map((_, i) => (
            <span key={i} className={`h-1 flex-1 rounded-full ${i <= at ? "bg-white" : "bg-white/20"}`} />
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button type="button" aria-label="Back" className={round} disabled={at === 0} onClick={() => setAt(at - 1)}>
            <Icon d={ICONS.back} />
          </button>
          <button
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-black hover:opacity-90"
            onClick={() => {
              if (!playing && at >= steps.length - 1) setAt(0);
              setPlaying(!playing);
            }}
          >
            <Icon d={playing ? ICONS.pause : ICONS.play} className="h-5 w-5" />
          </button>
          <button type="button" aria-label="Forward" className={round} disabled={at >= steps.length - 1} onClick={() => setAt(at + 1)}>
            <Icon d="M9 5l7 7-7 7" />
          </button>
        </div>
        {inline && (
          <div className="flex flex-wrap justify-center gap-1.5" role="group" aria-label="Go to a scene">
            {video.scenes.map((s, i) => (
              <button
                key={s.id}
                type="button"
                aria-current={step.sceneIndex === i ? "true" : undefined}
                aria-label={`Scene ${i + 1}`}
                title={s.action}
                onClick={() => jump(i)}
                className={`h-8 min-w-8 rounded-full px-2 text-xs font-semibold tabular-nums ${step.sceneIndex === i ? "bg-white text-black" : pickedClip(s) ? "border border-white/40 text-white hover:border-white" : "border border-dashed border-white/30 text-white/60 hover:border-white"}`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        )}
      </div>
      {!inline && <button type="button" className="absolute right-5 top-5 flex items-center gap-2 rounded-full border border-white/40 bg-black/60 px-4 py-2 text-sm font-medium text-white hover:border-white" onClick={onClose}>
        <Icon d={ICONS.close} className="h-4 w-4" />
        Close
      </button>}
    </div>
  );
}
