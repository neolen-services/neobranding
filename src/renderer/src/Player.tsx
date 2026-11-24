// Plays a whole video from the top, at any stage: a scene's clip where it has one, and otherwise its storyboard
// frame by frame with the recorded voices (or each line held for as long as it takes to say).
import { useEffect, useMemo, useRef, useState } from "react";
import { pickedClip, pickedPicture, speakerName, type Character, type Scene, type SceneLine, type Video } from "@shared/studio";
import { api } from "./api";
import { MotionPlayer } from "./MotionBoard";
import { Icon, ICONS, WORDS_PER_SECOND } from "./studioUi";

const FRAMES = 4;
const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;
const sayFor = (line: SceneLine | null, scene: Scene) => (line ? Math.max(countWords(line.text) / WORDS_PER_SECOND, 1.2) : scene.seconds);

export function Player({
  video,
  cast,
  onClose,
  inline,
}: {
  video: Video;
  cast: Character[];
  onClose?: () => void;
  /** Shown in the page (the Preview step) rather than over it: it waits to be played and has a row of scenes to jump to. */
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
      audio.addEventListener("ended", next);
      audio.addEventListener("error", next);
      audio.play().catch(next);
      return () => {
        audio.removeEventListener("ended", next);
        audio.removeEventListener("error", next);
        audio.pause();
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
          <p className="relative w-fit rounded-full bg-black/55 px-2 py-0.5 text-xs">
            Scene {step.sceneIndex + 1} of {video.scenes.length}
            {!clip && step.scene.madeBy === "me" ? " · you film this" : ""}
          </p>
          {!clip && step.scene.text && <p className="relative mt-4 text-center text-xl font-bold leading-tight [text-shadow:0_1px_4px_#000]">{step.scene.text}</p>}
          <p className="relative my-auto text-center text-sm italic leading-relaxed opacity-70">{clip || picture || step.scene.animation ? "" : step.scene.action}</p>
          {!clip && step.line && (
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
