// The Storyboard tab of a motion graphics video. There are no pictures to draw: Claude writes
// each scene as an animation, which plays right here. Animate them, watch, ask for changes,
// approve. The Make tab then renders the approved animations to clips on this computer.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { animationPage, STAGE } from "@shared/motion";
import { storyboardApproved, type Scene, type TakeResult, type Video } from "@shared/studio";
import { api } from "./api";
import { inOrder } from "./inOrder";
import { card, Chip, fieldClass, Icon, ICONS, label, primaryButton, smallButton } from "./studioUi";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Plays one scene's animation, over and over. The page it is in can do nothing but draw: it runs no
 * script, has no access to the app, and is forbidden from loading anything. It is drawn at its full
 * size and scaled down to the space it is given, and loaded again each time it has played through.
 */
export function MotionPlayer({ video, scene, className }: { video: Video; scene: Scene; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [round, setRound] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.min(el.clientWidth / STAGE.width, el.clientHeight / STAGE.height));
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  // A beat on the last frame, then it starts again.
  useEffect(() => {
    const timer = setInterval(() => setRound((n) => n + 1), (scene.seconds + 0.8) * 1000);
    return () => clearInterval(timer);
  }, [scene.seconds, scene.animation?.id]);
  const page = useMemo(() => (scene.animation ? animationPage(video.design, scene.animation, scene.seconds, "play") : ""), [video.design, scene.animation, scene.seconds]);
  if (!scene.animation) return null;
  return (
    <div ref={box} className={`relative overflow-hidden bg-black ${className ?? ""}`}>
      {scale > 0 && (
        <iframe
          key={round}
          title={`Animation of ${scene.action}`}
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={page}
          width={STAGE.width}
          height={STAGE.height}
          className="pointer-events-none absolute border-0"
          style={{ transform: `scale(${scale})`, transformOrigin: "0 0", left: `calc(50% - ${(STAGE.width * scale) / 2}px)`, top: `calc(50% - ${(STAGE.height * scale) / 2}px)` }}
        />
      )}
    </div>
  );
}

export function MotionBoard({
  video,
  busy,
  save,
  setError,
  setNotice,
  onChange,
  onNext,
}: {
  video: Video;
  /** What the page is doing right now, or "". */
  busy: string;
  save: (changes: Partial<Video>, keepApproval?: boolean) => Promise<boolean>;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
  onChange: (video: Video) => void;
  /** Opens the Preview tab. */
  onNext: () => void;
}) {
  const [look, setLook] = useState(video.look);
  const [doing, setDoing] = useState("");
  const [active, setActive] = useState<ReadonlySet<string>>(new Set());

  const scenes = video.scenes;
  const ai = scenes.filter((s) => s.madeBy === "ai");
  const missing = scenes.map((_, i) => i).filter((i) => scenes[i].madeBy === "ai" && !scenes[i].animation);
  const animated = ai.filter((s) => s.animation);
  const approved = animated.filter(storyboardApproved);
  const unapproved = animated.length - approved.length;
  const filmed = scenes.length - ai.length;

  /** Animates the given scenes, several at once. The video's design is made first, once, by whichever scene asks first. */
  async function animate(which: number[]) {
    setError("");
    setNotice("");
    setDoing("Animating");
    await inOrder(
      which,
      () => undefined,
      async (i) => {
        const id = scenes[i].id;
        setActive((now) => new Set(now).add(id));
        try {
          const result = await api.animateScene(video.id, id);
          if (!result.ok) setError(`Scene ${i + 1}: ${result.error}`);
          else onChange(result.video);
          return result.ok;
        } catch (e) {
          setError(e instanceof Error ? e.message : "The scene could not be animated.");
          return false;
        } finally {
          setActive((now) => {
            const next = new Set(now);
            next.delete(id);
            return next;
          });
        }
      },
    );
    setDoing("");
  }

  async function approveAll() {
    setError("");
    setNotice("");
    setDoing("Approving");
    let done = 0;
    try {
      for (const scene of animated.filter((s) => !storyboardApproved(s))) {
        const result = await api.approveStoryboard(video.id, scene.id, true);
        if (!result.ok) {
          setError(result.error);
          break;
        }
        done++;
        onChange(result.video);
      }
      if (done > 0) setNotice(`${plural(done, "animation")} approved.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setDoing("");
    }
  }

  const off = busy !== "" || doing !== "";
  const stage = missing.length > 0 ? 0 : unapproved > 0 ? 1 : 2;
  const steps = [
    { name: "Design", count: video.design ? "made" : "made with the first scene", done: video.design !== "" },
    { name: "Animate", count: `${animated.length} of ${ai.length}`, done: ai.length > 0 && missing.length === 0 },
    { name: "Approve", count: `${approved.length} of ${animated.length}`, done: ai.length > 0 && missing.length === 0 && unapproved === 0 },
  ];
  const next = [
    { text: `Animate ${plural(missing.length, "scene")}`, act: () => void animate(missing), note: "Claude designs the look of the whole video once, then animates each scene. Uses your Claude credits; a scene takes about a minute." },
    { text: `Approve all ${unapproved}`, act: () => void approveAll(), note: "Or approve them one at a time below, after watching each." },
    { text: "Next: preview it", act: onNext, note: "Watch the animations play in order with the voices." },
  ][stage];

  return (
    <div className="space-y-5">
      <section className={`${card} space-y-4`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="font-display text-lg font-semibold">Animation</h3>
            <p className="mt-0.5 max-w-2xl text-sm opacity-60">
              This video is motion graphics, so Claude makes it from start to end: no picture or video service is used. Each scene is an animation you can watch here and change in words.
              {filmed > 0 && ` ${plural(filmed, "scene")} you film ${filmed === 1 ? "needs" : "need"} none.`}
            </p>
          </div>
          {ai.length > 0 && (
            <div className="text-right">
              <button type="button" className={`${primaryButton} inline-flex items-center gap-2`} disabled={off} onClick={next.act}>
                {doing === "Animating" ? `Animating${active.size > 0 ? ` ${plural(active.size, "scene")}` : ""}…` : doing === "Approving" ? "Approving…" : next.text}
                {stage === 2 && <Icon d={ICONS.arrow} />}
              </button>
              <p className="mt-1.5 max-w-xs text-xs opacity-55">{next.note}</p>
            </div>
          )}
        </div>

        {ai.length > 0 && (
          <ol className="grid gap-2 sm:grid-cols-3" aria-label="Steps">
            {steps.map((step, i) => (
              <li key={step.name} className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 ${i === stage + 1 || (i === 0 && !video.design && stage === 0) ? "border-[var(--primary)] bg-[var(--tint)]" : "border-[var(--line)]"}`}>
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-semibold ${step.done ? "bg-[var(--primary)] text-white" : "border border-[var(--line)]"}`}>
                  {step.done ? <Icon d={ICONS.check} className="h-3 w-3" /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium leading-tight">{step.name}</span>
                  <span className="block truncate text-xs opacity-60">{step.count}</span>
                </span>
              </li>
            ))}
          </ol>
        )}

        {ai.length > 0 && (
          <details className="border-t border-[var(--line)] pt-3 text-sm" open={!video.design}>
            <summary className="cursor-pointer text-xs opacity-60 hover:opacity-100">Look and design</summary>
            <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <label className="block text-sm">
                <span className={label}>What the design should feel like</span>
                <input
                  className={`${fieldClass} mt-1.5`}
                  placeholder="For example: bold and minimal, dark background, one bright accent colour"
                  value={look}
                  onChange={(e) => setLook(e.target.value)}
                  onBlur={() => look.trim() !== video.look && void save({ look: look.trim() }, true)}
                />
              </label>
              {video.design && (
                <button
                  type="button"
                  className={smallButton}
                  disabled={off}
                  title="Throws the shared design away. The next scene you animate makes a new one; animate the others again to match it."
                  onClick={() => void save({ design: "", look: look.trim() }, true).then((ok) => ok && setNotice("The design is cleared. Animate a scene to make a new one, then animate the others again so they match."))}
                >
                  Start a new design
                </button>
              )}
            </div>
            <p className="mt-2 text-xs opacity-55">Colours come from your brand kit. The design is shared by every scene, so they look like one video.</p>
          </details>
        )}
      </section>

      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {scenes.map((scene, index) => (
          <Panel key={scene.id} video={video} scene={scene} index={index} disabled={off} animating={active.has(scene.id)} onVideo={onChange} />
        ))}
      </ol>
    </div>
  );
}

/** One scene: its animation playing, and the ways to change or approve it. */
function Panel({ video, scene, index, disabled, animating, onVideo }: { video: Video; scene: Scene; index: number; disabled: boolean; animating: boolean; onVideo: (video: Video) => void }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [zoomed, setZoomed] = useState(false);
  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setZoomed(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomed]);

  async function run(what: string, work: () => Promise<TakeResult>) {
    setBusy(what);
    setError("");
    try {
      const result = await work();
      if (result.ok) onVideo(result.video);
      else setError(result.error);
      return result.ok;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
      return false;
    } finally {
      setBusy("");
    }
  }

  const filmed = scene.madeBy === "me";
  const off = disabled || busy !== "";
  const isApproved = !filmed && storyboardApproved(scene);
  const making = animating || busy === "Animating";
  const animate = async (change: string) => (await run("Animating", () => api.animateScene(video.id, scene.id, change || undefined))) && setNote("");

  return (
    <li className={`${card} flex flex-col gap-3 !p-3 ${isApproved ? "border-[var(--primary)]/60" : ""}`}>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-xl font-semibold tabular-nums">{index + 1}</span>
        <span className="min-w-0 flex-1 truncate text-xs opacity-60">{scene.seconds}s</span>
        {filmed ? <Chip tone="warn">You film</Chip> : isApproved ? <Chip tone="good">Approved</Chip> : scene.animation ? <Chip>To approve</Chip> : null}
      </div>

      <div className="relative flex aspect-[9/16] w-full items-center justify-center overflow-hidden rounded-xl border border-[var(--line)] bg-black text-center text-xs text-white/60">
        {scene.animation ? (
          <>
            {/* The key restarts the animation whenever a new one is made. */}
            <MotionPlayer key={scene.animation.id} video={video} scene={scene} className="h-full w-full" />
            <button type="button" aria-label={`Watch scene ${index + 1} larger`} title="Watch it larger" className="absolute inset-0 cursor-zoom-in" onClick={() => setZoomed(true)} />
          </>
        ) : (
          <span className="flex flex-col items-center gap-2 px-4">
            <Icon d={filmed ? ICONS.camera : ICONS.ai} className="h-6 w-6 opacity-60" />
            {filmed ? "You film this scene. Add your clip on the Make tab." : "Not animated yet"}
          </span>
        )}
        {making && <span className="absolute inset-0 flex items-center justify-center bg-black/70 px-4 text-sm text-white">Animating… about a minute</span>}
      </div>

      <div className="space-y-1">
        <p className="line-clamp-3 text-sm leading-relaxed" title={scene.action}>
          {scene.action}
        </p>
        {scene.lines[0] && <p className="line-clamp-2 text-sm italic opacity-60">“{scene.lines[0].text}”</p>}
      </div>

      {!filmed && (
        <div className="mt-auto space-y-2">
          {scene.animation ? (
            <button type="button" className={isApproved ? `${smallButton} w-full` : `${primaryButton} w-full !py-1.5`} disabled={off} onClick={() => void run("Approving", () => api.approveStoryboard(video.id, scene.id, !isApproved))}>
              {isApproved ? "Approved · take it back" : "Approve"}
            </button>
          ) : (
            <button type="button" className={`${primaryButton} w-full !py-1.5`} disabled={off} onClick={() => void animate("")}>
              {making ? "Animating…" : "Animate this scene"}
            </button>
          )}
          {scene.animation && !isApproved && (
            <div className="flex gap-2">
              <input
                className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-1.5 text-sm placeholder:opacity-50 focus:border-[var(--primary)] focus:outline-none"
                placeholder="What should change?"
                aria-label={`What should change in the animation of scene ${index + 1}`}
                value={note}
                disabled={off}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && note.trim() && !off && void animate(note.trim())}
              />
              <button type="button" className={smallButton} disabled={off || !note.trim()} title="Changes this animation as you say, keeping the rest." onClick={() => void animate(note.trim())}>
                Change
              </button>
            </div>
          )}
          {scene.animation && !isApproved && (
            <button type="button" className="text-xs underline opacity-60 hover:opacity-100" disabled={off} title="Makes a different animation for this scene from the script." onClick={() => void animate("")}>
              Animate it differently
            </button>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm font-medium text-red-400">
          {error}
        </p>
      )}

      {zoomed && scene.animation && (
        <div role="dialog" aria-modal="true" aria-label={`Animation of scene ${index + 1}`} className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/85 p-6" onClick={() => setZoomed(false)}>
          <MotionPlayer video={video} scene={scene} className="aspect-[9/16] h-full max-h-full rounded-xl" />
          <button type="button" autoFocus className="absolute right-5 top-5 flex items-center gap-2 rounded-full border border-white/40 bg-black/60 px-4 py-2 text-sm font-medium text-white hover:border-white" onClick={() => setZoomed(false)}>
            <Icon d={ICONS.close} className="h-4 w-4" />
            Close
          </button>
        </div>
      )}
    </li>
  );
}
