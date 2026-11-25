// The cover, a section of the Effects step. Claude looks at frames taken from every scene (with the video's look) and
// picks the three that would make people tap, each with a few words to lay over it. The creator picks one (or any other
// moment), changes the words, makes the cover, and says what to change until they approve it. The cover is the picture
// in a profile grid and in search.
import { useEffect, useState } from "react";
import { emptyProject } from "@shared/edit";
import { COVER_TITLE_MAX, coverLookKey, coverState, type Video } from "@shared/studio";
import { api } from "./api";
import { drawOverlay, fontsReady } from "./EditDraw";
import { card, fieldClass, primaryButton, quietButton, smallButton } from "./studioUi";

const CHIPS = ["A closer shot of the face", "Shorter words", "A question instead of a statement"];

/** A frame with the cover's words laid over it, as the finished cover will look. */
function Tile({ file, title, className = "" }: { file: string; title: string; className?: string }) {
  return (
    <div className={`relative aspect-[9/16] overflow-hidden rounded-xl bg-black ${className}`}>
      <img src={api.studioFileUrl(file)} alt="" draggable={false} className="h-full w-full object-cover" />
      {title.trim() && <p className="absolute inset-x-[6%] top-1/2 -translate-y-1/2 text-center font-display text-[0.8em] font-bold leading-tight text-white [text-shadow:0_1px_3px_#000,0_0_2px_#000]">{title}</p>}
    </div>
  );
}

export function CoverPanel({
  video,
  setError,
  setNotice,
  onChange,
}: {
  video: Video;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
  onChange: (video: Video) => void;
}) {
  const plan = video.coverPlan;
  const state = coverState(video);
  const frames = plan?.frames ?? [];
  const [doing, setDoing] = useState("");
  const [feedback, setFeedback] = useState("");
  const [picked, setPicked] = useState(0);
  const [title, setTitle] = useState("");

  // The cover already made shows its own frame and words; otherwise Claude's first pick is chosen.
  const planned = plan ? `${plan.scenesKey}|${frames.map((f) => f.file).join(",")}|${plan.rounds.length}|${plan.ideas.map((x) => x.frame).join(",")}` : "";
  useEffect(() => {
    if (!plan) return;
    const made = video.cover ? frames.findIndex((f) => f.scene === video.cover!.scene && Math.abs(f.time - video.cover!.time) < 0.01) : -1;
    if (made >= 0) {
      setPicked(made);
      setTitle(video.cover!.title);
    } else if (plan.ideas[0]) {
      setPicked(plan.ideas[0].frame);
      setTitle(plan.ideas[0].title);
    } else setPicked(0);
    // Only a new plan resets the choice, not every change to the video.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planned]);

  async function run(what: string, work: () => Promise<{ ok: true; value: Video } | { ok: false; error: string }>, done?: string) {
    setDoing(what);
    setError("");
    setNotice("");
    try {
      const result = await work();
      if (result.ok) {
        onChange(result.value);
        if (done) setNotice(done);
      } else setError(result.error);
      return result.ok;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
      return false;
    } finally {
      setDoing("");
    }
  }

  const find = () => run("Looking at the frames and choosing", () => api.planVideoCover(video.id, ""), "Here are Claude's picks. Choose one, change the words if you like, then make the cover.");
  const send = async () => {
    const said = feedback.trim();
    if (said && (await run("Changing the picks", () => api.planVideoCover(video.id, said)))) setFeedback("");
  };
  const approve = (value: boolean | "skip") => run(value === false ? "Taking the approval back" : "Approving", () => api.approveVideoCover(video.id, value), value === "skip" ? "This video will post without a cover of its own." : value ? "Cover approved." : undefined);

  async function make() {
    const frame = frames[picked];
    if (!frame) return;
    await run(
      "Making the cover",
      async () => {
        let overlay = "";
        if (title.trim()) {
          await fontsReady();
          const canvas = document.createElement("canvas");
          canvas.width = 1080;
          canvas.height = 1920;
          const p = { ...emptyProject("cover", "cover"), showCaptions: false, texts: [{ id: "t", text: title.trim(), start: 0, end: 1, position: "middle" as const, style: "title" as const }] };
          drawOverlay(canvas.getContext("2d")!, p, 0.5);
          overlay = canvas.toDataURL("image/png");
        }
        return api.makeVideoCover(video.id, frame.scene, frame.time, title.trim(), overlay);
      },
      "Here is the cover. Approve it, or choose another moment or other words and make it again.",
    );
  }

  const ready = plan && !plan.skipped && frames.length > 0;
  const lookChanged = Boolean(ready && plan.lookKey && plan.lookKey !== coverLookKey(video));
  const busy = doing !== "";

  return (
    <div className="space-y-4">
      <section className={`${card} space-y-3`}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg font-semibold">Cover</p>
            <p className="text-sm opacity-60">The picture people see in your profile grid and in search, with a few words over it.</p>
          </div>
          {state === "approved" && <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300">{plan?.skipped ? "Skipped" : "Approved"}</span>}
        </div>
        {busy && <p className="text-sm opacity-75">{doing}…</p>}
        {!busy && (state === "none" || state === "stale") && (
          <>
            <p className="text-sm opacity-70">
              {state === "stale"
                ? "The script changed after the frames were taken, so they are taken again."
                : "Claude looks at frames from every scene, with your look on them, and picks the three that would make people tap, each with a few words to lay over it. You choose, and can say what to change. A few cents of Claude."}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={primaryButton} onClick={() => void find()}>
                {state === "stale" ? "Find them again" : "Find cover ideas"}
              </button>
              {!plan?.skipped && (
                <button type="button" className={quietButton} onClick={() => void approve("skip")}>
                  No cover of my own
                </button>
              )}
            </div>
          </>
        )}
        {!busy && ready && state !== "approved" && (
          <button type="button" className={`${quietButton} w-fit`} onClick={() => void approve("skip")}>
            No cover of my own
          </button>
        )}
        {lookChanged && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--accent)]/50 bg-[var(--accent)]/10 px-3 py-2 text-sm">
            <p className="min-w-0 flex-1">The look changed after these frames were taken. Take them again so the cover matches the video. It costs nothing, and a cover you made needs making again.</p>
            <button type="button" className={smallButton} disabled={busy} onClick={() => void run("Taking the frames again", () => api.retakeVideoCoverFrames(video.id))}>
              Take the frames again
            </button>
          </div>
        )}
      </section>

      {ready && (
        <>
          <section className={`${card} space-y-3`}>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <p className="font-display text-lg font-semibold">Claude's picks</p>
              {plan.summary && <p className="text-sm opacity-65">{plan.summary}</p>}
            </div>
            <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {plan.ideas.map((idea, n) => {
                const frame = frames[idea.frame];
                const chosen = picked === idea.frame && title === idea.title;
                return (
                  <li key={`${idea.frame}-${n}`} className="space-y-2">
                    <button
                      type="button"
                      aria-pressed={chosen}
                      onClick={() => {
                        setPicked(idea.frame);
                        setTitle(idea.title);
                      }}
                      className={`block w-full rounded-xl border-2 p-0.5 text-left ${chosen ? "border-[var(--primary)]" : "border-transparent hover:border-[var(--line)]"}`}
                    >
                      <Tile file={frame.file} title={idea.title} className="text-lg" />
                    </button>
                    <p className="text-sm font-medium leading-snug">{idea.title || "No words"}</p>
                    <p className="text-xs leading-snug opacity-65">{idea.why}</p>
                    <p className="text-xs opacity-45">
                      Scene {frame.scene}, {frame.time.toFixed(1)}s
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className={`${card} space-y-4`}>
            <p className="font-display text-lg font-semibold">Make your cover</p>
            <div className="flex flex-wrap gap-5">
              {frames[picked] && <Tile file={frames[picked].file} title={title} className="w-40 text-base" />}
              <div className="min-w-0 flex-1 basis-60 space-y-3">
                <label className="block text-sm">
                  <span className="mb-1 flex justify-between">
                    <span className="opacity-60">Words on the cover (optional)</span>
                    <span className="text-xs tabular-nums opacity-45">
                      {title.length}/{COVER_TITLE_MAX}
                    </span>
                  </span>
                  <input className={fieldClass} maxLength={COVER_TITLE_MAX} value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} placeholder="A few words that make people tap" />
                </label>
                <div>
                  <p className="mb-1 text-sm opacity-60">Or another moment</p>
                  <div className="flex flex-wrap gap-1.5">
                    {frames.map((f, n) => (
                      <button key={f.file} type="button" title={`Scene ${f.scene}, ${f.time.toFixed(1)}s`} aria-label={`Moment ${n + 1}: scene ${f.scene}`} aria-pressed={picked === n} onClick={() => setPicked(n)} className={`rounded-md border-2 p-px ${picked === n ? "border-[var(--primary)]" : "border-transparent opacity-75 hover:opacity-100"}`}>
                        <img src={api.studioFileUrl(f.file)} alt="" draggable={false} className="aspect-[9/16] w-10 rounded object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={state === "made" ? quietButton : primaryButton} disabled={busy} onClick={() => void make()}>
                    {video.cover ? "Make it again" : "Make the cover"}
                  </button>
                  {state === "made" && (
                    <button type="button" className={primaryButton} disabled={busy} onClick={() => void approve(true)}>
                      Approve the cover
                    </button>
                  )}
                  {state === "approved" && (
                    <button type="button" className={quietButton} disabled={busy} onClick={() => void approve(false)}>
                      Take the approval back
                    </button>
                  )}
                </div>
              </div>
              {video.cover && (
                <div className="space-y-2">
                  <p className="text-sm opacity-60">Your cover{video.cover.approvedAt ? " · approved" : ""}</p>
                  <img src={api.studioFileUrl(video.cover.file)} alt="Your cover" className="aspect-[9/16] w-28 rounded-xl object-cover" />
                  <a className={`${smallButton} inline-block`} href={api.studioFileUrl(video.cover.file)} download={`${video.title} cover.jpg`}>
                    Save the cover
                  </a>
                </div>
              )}
            </div>
          </section>

          <section className={`${card} space-y-3`}>
            <p className="font-display text-lg font-semibold">What should change in the picks?</p>
            {plan.rounds.length > 0 && (
              <ul className="space-y-2">
                {plan.rounds.map((r, i) => (
                  <li key={i} className="space-y-1.5 text-sm">
                    <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-[var(--primary)]/15 px-3 py-1.5">{r.feedback}</p>
                    {r.reply && <p className="max-w-[85%] rounded-2xl rounded-bl-md border border-[var(--line)] px-3 py-1.5 opacity-85">{r.reply}</p>}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-1.5">
              {CHIPS.map((c) => (
                <button key={c} type="button" className="rounded-full border border-[var(--line)] px-3 py-1 text-xs opacity-80 hover:opacity-100" disabled={busy} onClick={() => setFeedback(c)}>
                  {c}
                </button>
              ))}
            </div>
            <textarea
              className={fieldClass}
              rows={2}
              placeholder="For example: a closer shot of the face, shorter words, or a question instead of a statement"
              value={feedback}
              disabled={busy}
              onChange={(e) => setFeedback(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void send();
              }}
            />
            <button type="button" className={primaryButton} disabled={busy || !feedback.trim()} onClick={() => void send()}>
              Change the picks
            </button>
            <p className="text-xs opacity-55">
              Claude looks at the same frames again and changes only what you ask for. Changing the picks takes back an approval.
              {plan.costUsd > 0 ? ` Choosing has cost about $${plan.costUsd.toFixed(2)} of Claude so far.` : ""}
            </p>
          </section>
        </>
      )}

      {/* A cover made before there was a plan (or without one) can still be seen, saved and approved. */}
      {!ready && !plan?.skipped && video.cover && (
        <section className={`${card} flex flex-wrap items-center gap-4`}>
          <img src={api.studioFileUrl(video.cover.file)} alt="Your cover" className="aspect-[9/16] w-28 rounded-xl object-cover" />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="font-display text-lg font-semibold">Your cover{video.cover.approvedAt ? " · approved" : ""}</p>
            <div className="flex flex-wrap gap-2">
              <a className={smallButton} href={api.studioFileUrl(video.cover.file)} download={`${video.title} cover.jpg`}>
                Save the cover
              </a>
              {state === "made" && (
                <button type="button" className={smallButton} disabled={busy} onClick={() => void approve(true)}>
                  Approve the cover
                </button>
              )}
              <button type="button" className={smallButton} disabled={busy} onClick={() => void find()}>
                Find cover ideas
              </button>
            </div>
          </div>
        </section>
      )}

      {plan?.skipped && (
        <section className={`${card} space-y-2`}>
          <p className="text-sm opacity-75">You chose to post without a cover of your own: the platform will use a frame of the video.</p>
          <button type="button" className={quietButton} disabled={busy} onClick={() => void approve(false)}>
            Choose a cover after all
          </button>
        </section>
      )}
    </div>
  );
}
