// One scene's storyboard: a sheet of four frames showing what happens in it, what the check said, and the ways to redo or approve it.
// Shown as one card in the Storyboard step's grid, beside every other scene's storyboard.
import { useEffect, useRef, useState } from "react";
import type { MediaChoice } from "@shared/media";
import { pickedPicture, storyboardApproved, type Scene, type TakeResult, type Video } from "@shared/studio";
import { api } from "./api";
import { readUpload } from "./ServicePicker";
import { card, Chip, Icon, ICONS, primaryButton, quietButton, smallButton } from "./studioUi";

const MAX_PICTURE = 30 * 1024 * 1024;

/** One scene of the storyboard: its sheet of frames, what the check said, and the ways to redo or approve it. */
export function Panel({
  video,
  scene,
  index,
  choice,
  disabled,
  drawing,
  onVideo,
  bare,
}: {
  video: Video;
  scene: Scene;
  index: number;
  /** The service that makes pictures on this page. */
  choice: MediaChoice;
  disabled: boolean;
  /** A batch started from the top of the page is making this scene's storyboard right now. */
  drawing: boolean;
  onVideo: (video: Video) => void;
  /** Shown inside a scene's own view, which already names the scene, says how it starts and shows its words. */
  bare?: boolean;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [zoomed, setZoomed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // The full-size view closes with Esc.
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

  const picture = pickedPicture(scene);
  const filmed = scene.madeBy === "me";
  const off = disabled || busy !== "";
  const makePicture = async (change = note) => (await run("Making", () => api.makeScenePicture(video.id, scene.id, choice, change))) && setNote("");
  const beforeHasPicture = index > 0 && Boolean(pickedPicture(video.scenes[index - 1]));
  const isApproved = !filmed && storyboardApproved(scene);
  // What the check said about the storyboard now in use; notes about an earlier one no longer apply.
  const review = picture && scene.review?.picture === picture.id ? scene.review : null;
  const making = drawing || busy === "Making";

  return (
    <div className={bare ? "grid items-start gap-4 sm:grid-cols-[11rem_minmax(0,1fr)]" : `${card} flex flex-col gap-3 !p-3 ${isApproved ? "border-[var(--primary)]/60" : ""}`}>
      {!bare && (<>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-xl font-semibold tabular-nums">{index + 1}</span>
        <span className="min-w-0 flex-1 truncate text-xs opacity-60" title={scene.place}>
          {scene.seconds}s{scene.place && ` · ${scene.place}`}
        </span>
        {filmed ? (
          <Chip tone="warn">You film</Chip>
        ) : isApproved ? (
          <Chip tone="good">Approved</Chip>
        ) : review ? (
          <Chip tone={review.ok ? "good" : "warn"}>{review.ok ? "Ready to approve" : "To fix"}</Chip>
        ) : picture ? (
          <Chip>Not checked</Chip>
        ) : null}
      </div>

      {index > 0 && !filmed ? (
        <div role="radiogroup" aria-label={`How scene ${index + 1} starts`} className="flex min-h-[1.875rem] rounded-full border border-[var(--line)] p-0.5 text-xs font-medium">
          {(
            [
              [true, "Carries on", `Scene ${index + 1} carries straight on from scene ${index} with no cut. Its storyboard is drawn from the storyboard before it.`],
              [false, "New shot", `Scene ${index + 1} is a new shot: a cut.`],
            ] as const
          ).map(([value, text, title]) => (
            <button
              key={text}
              type="button"
              role="radio"
              aria-checked={scene.continues === value}
              title={title}
              disabled={off}
              onClick={() => scene.continues !== value && void run("Changing", () => api.setSceneFlow(video.id, scene.id, value))}
              className={`flex-1 rounded-full px-2 py-1 ${scene.continues === value ? "bg-[var(--tint)]" : "opacity-55 hover:opacity-100"}`}
            >
              {text}
            </button>
          ))}
        </div>
      ) : (
        <p className="flex min-h-[1.875rem] items-center px-1 text-xs opacity-55">{index === 0 ? "Opening shot" : scene.continues ? `Carries on from scene ${index}` : "New shot"}</p>
      )}
      </>)}

      <div className="relative flex aspect-[9/16] w-full items-center justify-center overflow-hidden rounded-xl border border-[var(--line)] bg-black text-center text-xs text-white/60">
        {picture ? (
          <button type="button" title="Look at it full size" className="block h-full w-full cursor-zoom-in" onClick={() => setZoomed(true)}>
            <img src={api.studioFileUrl(picture.file)} alt={`Storyboard for scene ${index + 1}: ${scene.action}`} className="h-full w-full object-cover" />
          </button>
        ) : (
          <span className="flex flex-col items-center gap-2 px-4">
            <Icon d={filmed ? ICONS.camera : ICONS.ai} className="h-6 w-6 opacity-60" />
            {filmed ? "You film this scene." : "No storyboard yet"}
          </span>
        )}
        {making && <span className="absolute inset-0 flex items-center justify-center bg-black/70 px-4 text-sm text-white">Drawing the storyboard…</span>}
      </div>

      {!bare && (
        <div className="space-y-1">
          <p className="line-clamp-3 text-sm leading-relaxed" title={scene.action}>
            {scene.action}
          </p>
          {scene.lines[0] && <p className="line-clamp-2 text-sm italic opacity-60">“{scene.lines[0].text}”</p>}
        </div>
      )}

      {/* Beside the picture when shown in a scene's own view; in a card, these simply follow it. */}
      <div className={bare ? "min-w-0 space-y-3" : "contents"}>
      {bare && (
        <p className={`text-sm ${isApproved ? "text-emerald-400" : review && !review.ok ? "font-medium text-[var(--accent)]" : "opacity-70"}`}>
          {!picture ? (making ? "Drawing it now…" : "No storyboard yet.") : isApproved ? "Approved. Its clip follows it." : !review ? "Not checked yet." : review.ok ? "The check found nothing that would make the video wrong." : "The check found something that would make the video wrong."}
        </p>
      )}
      {review && !isApproved && (review.problems.length > 0 || review.minor.length > 0) && (
        <div className={`rounded-xl border px-3 py-2 text-sm ${review.ok ? "border-[var(--line)]" : "border-[var(--accent)]/50 bg-[var(--accent)]/10"}`}>
          {review.problems.length > 0 && (
            <>
              <p className="text-xs font-medium uppercase tracking-wide opacity-70">Would make the video wrong</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-4 leading-snug">
                {review.problems.map((problem, i) => (
                  <li key={i}>{problem}</li>
                ))}
              </ul>
            </>
          )}
          {review.problems.some((p) => /^not fixed/i.test(p.trim())) && (
            <p className="mt-2 rounded-lg bg-black/20 px-2.5 py-2 text-xs leading-relaxed">
              This has been tried and came back the same. Applying the fix again draws it afresh, but if it keeps failing, use a stronger picture model (Nano Banana Pro, in the video's settings: the gear at the top), or approve it if the video can live with it.
            </p>
          )}
          {review.fix && (
            <>
              <p className="mt-2 text-xs opacity-80">
                <span className="font-medium">Suggested fix:</span> {review.fix}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={bare ? smallButton : `${primaryButton} !px-3 !py-1 !text-xs`} disabled={off} onClick={() => void makePicture(review.fix)}>
                  {busy === "Making" ? "Making…" : "Apply this fix"}
                </button>
                <button type="button" className={smallButton} disabled={off} title="Puts the suggested fix in the box below, so you can change the words first." onClick={() => setNote(review.fix)}>
                  Edit it first
                </button>
              </div>
            </>
          )}
          {review.minor.length > 0 && (
            <details className={`text-xs opacity-70 ${review.problems.length > 0 ? "mt-2" : ""}`}>
              <summary className="cursor-pointer">
                {review.minor.length === 1 ? "1 small thing" : `${review.minor.length} small things`} a viewer would not notice
              </summary>
              <ul className="mt-1 list-disc space-y-1 pl-4 leading-snug">
                {review.minor.map((flaw, i) => (
                  <li key={i}>{flaw}</li>
                ))}
              </ul>
              <p className="mt-1">Making it again over these would only bring new ones.</p>
            </details>
          )}
        </div>
      )}

      {!filmed && (
        <div className={`space-y-2 ${bare ? "max-w-md" : "mt-auto"}`}>
          {picture && (
            <button
              type="button"
              className={bare ? (isApproved ? smallButton : `${quietButton} !py-1.5`) : `w-full ${isApproved ? smallButton : review && !review.ok ? `${quietButton} !py-1.5` : `${primaryButton} !py-1.5`}`}
              disabled={off}
              onClick={() => void run("Approving", () => api.approveStoryboard(video.id, scene.id, !isApproved))}
            >
              {isApproved ? "Approved · take it back" : review && !review.ok ? "Approve anyway" : "Approve"}
            </button>
          )}
          {!picture && (
            <button type="button" className={`${primaryButton} !py-1.5 ${bare ? "" : "w-full"}`} disabled={off} onClick={() => void makePicture("")}>
              {making ? "Drawing…" : "Draw this storyboard"}
            </button>
          )}
          {!picture && scene.continues && index > 0 && !beforeHasPicture && <p className="text-xs opacity-60">Scene {index}'s storyboard comes first: this one is drawn from it.</p>}

          {picture && !isApproved && (
            <div className="flex gap-2">
              <input
                className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-1.5 text-sm placeholder:opacity-50 focus:border-[var(--primary)] focus:outline-none"
                placeholder="What should change?"
                aria-label={`What should change in the storyboard for scene ${index + 1}`}
                value={note}
                disabled={off}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && note.trim() && !off && void makePicture()}
              />
              <button type="button" className={smallButton} disabled={off || !note.trim()} title="Makes this storyboard again with only that change." onClick={() => void makePicture()}>
                Change
              </button>
            </div>
          )}

          {picture && (
            <details className="text-xs">
              <summary className="cursor-pointer opacity-60 hover:opacity-100">More</summary>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={smallButton} disabled={off} title="Draws a different storyboard from the script, not an edit of this one." onClick={() => void makePicture("")}>
                  Draw a different one
                </button>
                <button type="button" className={smallButton} disabled={off} title="Claude looks at this storyboard and writes what is wrong with it. Uses your Claude credits." onClick={() => void run("Checking", () => api.reviewStoryboard(video.id, scene.id))}>
                  {busy === "Checking" ? "Checking…" : review ? "Check again" : "Check this one"}
                </button>
                <button type="button" className={smallButton} disabled={off} onClick={() => fileInput.current?.click()}>
                  {busy === "Adding" ? "Adding…" : "Add your own"}
                </button>
              </div>
              {scene.pictures.length > 1 && (
                <ul className="mt-2 flex flex-wrap gap-2" aria-label={`Storyboards made for scene ${index + 1}`}>
                  {scene.pictures.map((take, i) => {
                    const using = take.id === scene.picture;
                    const what = `Storyboard ${i + 1}${take.source === "upload" ? " · added by you" : take.madeWith ? ` · ${take.madeWith}` : ""}`;
                    return (
                      <li key={take.id} className="group relative">
                        <button
                          type="button"
                          aria-pressed={using}
                          aria-label={`${what}${using ? " (in use)" : ""}`}
                          title={`${what}${using ? " · in use" : " · click to use"}`}
                          disabled={off}
                          onClick={() => !using && run("Choosing", () => api.changeTake(video.id, scene.id, take.id, "use"))}
                          className={`block aspect-[9/16] w-9 overflow-hidden rounded-md border-2 bg-black ${using ? "border-[var(--primary)]" : "border-transparent opacity-60 hover:opacity-100"}`}
                        >
                          <img src={api.studioFileUrl(take.file)} alt="" className="h-full w-full object-cover" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${what}`}
                          title="Remove"
                          disabled={off}
                          onClick={() => run("Removing", () => api.changeTake(video.id, scene.id, take.id, "remove"))}
                          className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface)] hover:border-red-400 hover:text-red-400 group-focus-within:flex group-hover:flex"
                        >
                          <Icon d={ICONS.close} className="h-3 w-3" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </details>
          )}
          <input
            ref={fileInput}
            type="file"
            hidden
            accept="image/png,image/jpeg,image/webp"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (file.size > MAX_PICTURE) return setError("That picture is over 30 MB. Use a smaller one.");
              await run("Adding", async () => api.addSceneFile(video.id, scene.id, await readUpload(file)));
            }}
          />
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm font-medium text-red-400">
          {error}
        </p>
      )}

      {zoomed && picture && (
        <div role="dialog" aria-modal="true" aria-label={`Storyboard for scene ${index + 1}`} className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/85 p-6" onClick={() => setZoomed(false)}>
          <img src={api.studioFileUrl(picture.file)} alt={`Storyboard for scene ${index + 1}: ${scene.action}`} className="max-h-full max-w-full rounded-xl object-contain" />
          <button type="button" autoFocus className="absolute right-5 top-5 flex items-center gap-2 rounded-full border border-white/40 bg-black/60 px-4 py-2 text-sm font-medium text-white hover:border-white" onClick={() => setZoomed(false)}>
            <Icon d={ICONS.close} className="h-4 w-4" />
            Close
          </button>
        </div>
      )}
      </div>
    </div>
  );
}
