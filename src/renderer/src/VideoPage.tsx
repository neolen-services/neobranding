// One video, worked on a stage at a time: Idea, Script, Cast, Storyboard, Preview, Make, Finish.
// Each tab shows only what that stage needs, and the header always says what to do next.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { BrandKit } from "@shared/brand";
import type { Idea } from "@shared/ideas";
import type { ResearchItem } from "@shared/research";
import {
  approvalProblem,
  EVIDENCE_LABELS,
  joinState, pickedClip,
  pickedPicture,
  boardId,
  isMotion,
  storyboardApproved,
  productionLabel,
  styleLabel,
  RESULT_COUNTS,
  SPEAKER_ME,
  speakerName,
  type Character,
  type Scene,
  type SceneLine,
  type Series,
  type Video,
  type VideoResults,
} from "@shared/studio";
import { api } from "./api";
import { CastStep } from "./CastStep";
import { DeleteButton } from "./CastView";
import { inOrder } from "./inOrder";
import { SceneMedia } from "./SceneMedia";
import { StoryboardTab } from "./Storyboard";
import { MotionBoard, MotionPlayer } from "./MotionBoard";
import { ServicePicker, useMediaChoices, useMediaKeys } from "./ServicePicker";
import { card, Chip, fieldClass, Icon, ICONS, label, PlayLine, postName, primaryButton, quietButton, SCRIPT_COST, smallButton, STAGES, videoProgress, WORDS_PER_SECOND } from "./studioUi";

const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;
/** How many frames a scene's storyboard sheet holds: two across, two down. */
const FRAMES = 4;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function VideoPage({
  video,
  cast,
  brand,
  ideas,
  posts,
  series,
  onBack,
  onChange,
  onDelete,
  onOpenSettings,
  onOpenBrand,
  onCast,
}: {
  video: Video;
  cast: Character[];
  brand: BrandKit;
  ideas: Idea[];
  posts: ResearchItem[];
  series?: Series;
  onBack: () => void;
  onChange: (video: Video) => void;
  onDelete: () => Promise<void>;
  onOpenSettings: () => void;
  onOpenBrand: () => void;
  /** A character was changed on the Cast tab. */
  onCast: (character: Character) => void;
}) {
  const progress = videoProgress(video, cast, brand);
  const [tab, setTab] = useState(progress.tab);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const written = video.scenes.length > 0;
  const approved = video.approvedAt !== "";
  /** Why a tab cannot be opened yet, or "" when it can. */
  const storyboardsApproved = video.scenes.every(storyboardApproved);
  const locked = (index: number) =>
    index <= 1 ? "" : !written ? "Write the script first." : !approved ? "Approve the script first." : index >= 4 && index <= 5 && !storyboardsApproved ? isMotion(video) ? "Approve every scene's animation first." : "Approve every scene's storyboard first." : "";

  // A rewrite takes the approval back, which can close the tab being looked at.
  useEffect(() => {
    if (locked(tab)) setTab(progress.tab);
  });

  /** Runs one action on the video, showing what it is doing and what went wrong. */
  async function run(what: string, work: () => Promise<{ ok: true; value: Video } | { ok: false; error: string }>) {
    setBusy(what);
    setError("");
    setNotice("");
    try {
      const result = await work();
      if (result.ok) onChange(result.value);
      else setError(result.error);
      return result.ok;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
      return false;
    } finally {
      setBusy("");
    }
  }

  /** Saves the creator's own edit. Changing the script after approval takes the approval back. */
  const save = (changes: Partial<Video>, keepApproval = false) =>
    run("Saving", () => api.saveVideo({ ...video, ...changes, approvedAt: keepApproval ? video.approvedAt : "" }));

  const seconds = video.scenes.reduce((n, s) => n + s.seconds, 0);
  const meta = [
    video.format === "episode" ? `Episode ${video.episode ?? ""}${series ? ` of ${series.title}` : ""}` : "Single video",
    video.source === "remake" ? "Remake of a saved post" : "",
    productionLabel(video.production),
    video.production !== "me" && (video.style || series?.style) ? styleLabel(video.style || series?.style || "") : "",
    written ? `${seconds} seconds · ${plural(video.scenes.length, "scene")}` : "",
  ].filter(Boolean);
  const shared = { video, cast, brand, busy, run, save, setError, setNotice, onChange };

  return (
    <div>
      <div className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--bg)]">
        <div className="mx-auto max-w-6xl px-6 pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" aria-label={series ? `Back to ${series.title}` : "Back to all videos"} title={series ? series.title : "All videos"} className="rounded-full border border-[var(--line)] p-2 hover:border-[var(--ink)]" onClick={onBack}>
              <Icon d={ICONS.back} />
            </button>
            <div className="min-w-0 flex-1">
              <h2 className="truncate font-display text-xl font-semibold">{video.title}</h2>
              <p className="truncate text-sm opacity-60">{meta.join(" · ")}</p>
            </div>
            {progress.waiting && tab !== progress.tab && (
              <button type="button" className={`${primaryButton} flex items-center gap-2`} onClick={() => setTab(progress.tab)}>
                Next: {progress.next}
                <Icon d={ICONS.arrow} />
              </button>
            )}
            <DeleteButton name="this video" onConfirm={onDelete} />
          </div>

          <div role="tablist" aria-label="Stages" className="-mb-px mt-4 flex gap-1 overflow-x-auto">
            {STAGES.map((name, i) => {
              const why = locked(i);
              const done = i < progress.done;
              return (
                <button
                  key={name}
                  type="button"
                  role="tab"
                  aria-selected={tab === i}
                  disabled={why !== ""}
                  title={why || undefined}
                  onClick={() => setTab(i)}
                  className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium ${
                    tab === i ? "border-[var(--primary)]" : "border-transparent opacity-65 hover:opacity-100"
                  } disabled:cursor-not-allowed disabled:opacity-35`}
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[0.7rem] font-semibold ${
                      done ? "bg-[var(--primary)] text-white" : tab === i ? "border border-[var(--primary)]" : "border border-[var(--line)]"
                    }`}
                  >
                    {why ? <Icon d={ICONS.lock} className="h-3 w-3" /> : done ? <Icon d={ICONS.check} className="h-3 w-3" /> : i + 1}
                  </span>
                  {name}
                  {progress.waiting && progress.tab === i && tab !== i && <span aria-label="next step is here" className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-5 p-6">
        {error && (
          <p role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-red-400/50 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-300">
            {error}
            <button type="button" aria-label="Dismiss" className="opacity-70 hover:opacity-100" onClick={() => setError("")}>
              <Icon d={ICONS.close} />
            </button>
          </p>
        )}
        {notice && (
          <p role="status" className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-300">
            {notice}
          </p>
        )}

        {tab === 0 && <IdeaTab {...shared} ideas={ideas} posts={posts} series={series} onNext={() => setTab(1)} />}
        {tab === 1 && !written && <WriteScript {...shared} />}
        {tab === 1 && written && <ScriptTab {...shared} onApproved={() => setTab(2)} />}
        {tab === 2 && approved && <CastStep video={video} cast={cast} brand={brand} onCast={onCast} onVideo={onChange} onNext={() => setTab(3)} onOpenSettings={onOpenSettings} onOpenBrand={onOpenBrand} />}
        {tab === 3 && approved && !isMotion(video) && <StoryboardTab video={video} busy={busy} save={save} setError={setError} setNotice={setNotice} onChange={onChange} onNext={() => setTab(4)} />}
        {tab === 3 && approved && isMotion(video) && <MotionBoard video={video} busy={busy} save={save} setError={setError} setNotice={setNotice} onChange={onChange} onNext={() => setTab(4)} />}
        {tab === 4 && approved && <PreviewTab {...shared} progress={progress} onOpenCast={() => setTab(2)} onOpenSettings={onOpenSettings} onStoryboard={() => setTab(3)} onNext={() => setTab(5)} />}
        {tab === 5 && approved && <MakeTab {...shared} progress={progress} onStoryboard={() => setTab(3)} onNext={() => setTab(6)} />}
        {tab === 6 && approved && <FinishTab {...shared} />}
      </div>
    </div>
  );
}

type Shared = {
  video: Video;
  cast: Character[];
  brand: BrandKit;
  /** What is being done right now, or "". */
  busy: string;
  run: (what: string, work: () => Promise<{ ok: true; value: Video } | { ok: false; error: string }>) => Promise<boolean>;
  save: (changes: Partial<Video>, keepApproval?: boolean) => Promise<boolean>;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
  onChange: (video: Video) => void;
};

// ---------- 1. Idea ----------

function IdeaTab({ video, busy, save, ideas, posts, series, onNext }: Shared & { ideas: Idea[]; posts: ResearchItem[]; series?: Series; onNext: () => void }) {
  const [brief, setBrief] = useState(video.brief);
  const written = video.scenes.length > 0;
  const idea = ideas.find((i) => i.id === video.ideaIds[0]);
  const inspired = video.postIds.map((id) => posts.find((p) => p.id === id)).filter((p) => p !== undefined).map(postName);
  const source = [
    series && `Episode ${video.episode ?? ""} of ${series.title}`,
    video.source === "remake" && "Your own version of a saved post",
    inspired.length > 0 && `Inspired by ${inspired.length === 1 ? "a saved post" : `${inspired.length} saved posts`}: ${inspired.join(" · ")}`,
  ].filter(Boolean);

  return (
    <div className="space-y-5">
      {idea && (
        <section className={`${card} space-y-4`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className={label}>The idea this video comes from</p>
            <span className="flex flex-wrap gap-1.5">
              <Chip>{productionLabel(video.production)}</Chip>
              {video.production !== "me" && (video.style || series?.style) && <Chip>{styleLabel(video.style || series?.style || "")}</Chip>}
              {idea.pillar && <Chip>{idea.pillar}</Chip>}
            </span>
          </div>
          <h3 className="font-display text-xl font-semibold leading-snug">{idea.title}</h3>
          <p className="border-l-4 border-[var(--accent)] pl-3 font-display text-lg font-medium leading-snug">“{idea.hook}”</p>
          <div className="grid gap-x-8 gap-y-4 text-sm lg:grid-cols-2">
            <dl className="space-y-3">
              {idea.viewer && (
                <div>
                  <dt className={label}>Who it is for</dt>
                  <dd className="mt-1">{idea.viewer}</dd>
                </div>
              )}
              {idea.takeaway && (
                <div>
                  <dt className={label}>What they leave with</dt>
                  <dd className="mt-1">{idea.takeaway}</dd>
                </div>
              )}
              {idea.cta && (
                <div>
                  <dt className={label}>Closing ask</dt>
                  <dd className="mt-1">{idea.cta}</dd>
                </div>
              )}
            </dl>
            <div>
              <p className={label}>Outline</p>
              <ol className="mt-1 list-decimal space-y-1 pl-5 leading-relaxed">
                {idea.outline.map((beat, i) => (
                  <li key={i}>{beat}</li>
                ))}
              </ol>
            </div>
          </div>
        </section>
      )}

      <section className={`${card} space-y-3`}>
        <h3 className="font-display text-lg font-semibold">{idea ? "Anything to add for the script?" : "What this video is about"}</h3>
        <textarea
          className={fieldClass}
          rows={3}
          aria-label={idea ? "Anything to add for the script" : "What the video is about"}
          placeholder={idea ? "Optional. For example: keep it under 40 seconds, or let me say the closing line myself." : "The topic, who it is for, and anything it must include."}
          value={brief}
          disabled={busy !== ""}
          onChange={(e) => setBrief(e.target.value)}
          onBlur={() => brief.trim() !== video.brief && void save({ brief }, true)}
        />
        {(source.length > 0 || !idea) && <p className="text-sm opacity-60">{[...source, !idea && `Made: ${productionLabel(video.production).toLowerCase()}`].filter(Boolean).join(" · ")}</p>}
        {written && <p className="text-sm opacity-60">The script is already written. What you change here is used the next time you ask for a rewrite.</p>}
        <div className="border-t border-[var(--line)] pt-4">
          <button type="button" className={`${primaryButton} flex items-center gap-2`} onClick={onNext}>
            {written ? "Go to the script" : "On to the script"}
            <Icon d={ICONS.arrow} />
          </button>
        </div>
      </section>
    </div>
  );
}

/** The Script tab before there is a script: the idea is settled, and writing it is the one thing to do. */
function WriteScript({ video, busy, run }: Shared) {
  return (
    <section className={`${card} mx-auto flex max-w-2xl flex-col items-center px-6 py-10 text-center`}>
      <h3 className="font-display text-xl font-semibold">Write the script</h3>
      <p className="mt-2 text-sm leading-relaxed opacity-70">{video.ideaIds.length > 0 ? `From your idea “${video.title}”.` : "From what is written on the Idea tab."}</p>
      <button type="button" className={`${primaryButton} mt-5`} disabled={busy !== ""} onClick={() => void run("Writing the script", () => api.writeVideo(video.id, ""))}>
        {busy === "Writing the script" ? "Writing the script… about 40 seconds" : `Write the script (${SCRIPT_COST})`}
      </button>
      <p className="mt-4 max-w-md text-xs leading-relaxed opacity-60">
        You get the claim and its evidence, three opening lines, every scene with its lines, and a check against your rules. You read and approve it before anything else is made.
      </p>
    </section>
  );
}

// ---------- 2. Script ----------

function ScriptTab({ video, cast, busy, run, save, onApproved }: Shared & { onApproved: () => void }) {
  const [note, setNote] = useState("");
  const [source, setSource] = useState(video.claim?.source ?? "");
  const [copied, setCopied] = useState(false);
  useEffect(() => setSource(video.claim?.source ?? ""), [video.claim?.source]);

  const approved = video.approvedAt !== "";
  const problem = approvalProblem(video);
  const failed = video.checks.filter((c) => !c.ok);
  const needsSource = video.claim !== null && video.claim.evidence !== "none";
  const words = video.scenes.reduce((n, s) => n + s.lines.reduce((m, l) => m + countWords(l.text), 0), 0);
  const seconds = video.scenes.reduce((n, s) => n + s.seconds, 0);
  const editScene = (id: string, change: (scene: Scene) => Scene) => save({ scenes: video.scenes.map((s) => (s.id === id ? change(s) : s)) });

  const tick = (ok: boolean, text: ReactNode) => (
    <li className="flex items-start gap-2.5">
      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${ok ? "bg-emerald-500/20 text-emerald-400" : "border border-[var(--accent)] text-[var(--accent)]"}`}>
        {ok && <Icon d={ICONS.check} className="h-2.5 w-2.5" />}
      </span>
      <span className={ok ? "opacity-70" : "font-medium"}>{text}</span>
    </li>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-5">
        <section className={card}>
          <p className={label}>Opening line</p>
          <p className="mt-2 border-l-4 border-[var(--accent)] pl-4 font-display text-xl font-semibold leading-snug">“{video.hooks[0]}”</p>
          {video.overlay && (
            <p className="mt-3 text-sm">
              <span className="opacity-60">On screen: </span>“{video.overlay}”
            </p>
          )}
          {video.hooks.length > 1 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer opacity-60 hover:opacity-100">{plural(video.hooks.length - 1, "other opening")} considered</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 opacity-80">
                {video.hooks.slice(1).map((hook, i) => (
                  <li key={i}>{hook}</li>
                ))}
              </ul>
              <p className="mt-2 opacity-60">To use one of these, ask for it in “Ask for changes”.</p>
            </details>
          )}
        </section>

        <section className={`${card} !p-0`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--line)] px-5 py-4">
            <h3 className="font-display text-lg font-semibold">Scenes</h3>
            <p className="text-sm opacity-60">
              {seconds} seconds · {plural(video.scenes.length, "scene")} · about {words} spoken words
            </p>
          </div>
          <ol className="divide-y divide-[var(--line)]">
            {video.scenes.map((scene, index) => (
              <ScriptScene
                key={scene.id}
                scene={scene}
                index={index}
                cast={cast}
                disabled={busy !== ""}
                onMadeBy={(madeBy) => void editScene(scene.id, (s) => ({ ...s, madeBy }))}
                onLine={(lineIndex, text) =>
                  void editScene(scene.id, (s) => ({
                    ...s,
                    // Changed words need a new recording.
                    lines: s.lines.map((l, i) => (i === lineIndex ? { speaker: l.speaker, delivery: l.delivery, text } : l)),
                  }))
                }
              />
            ))}
          </ol>
        </section>

        {video.caption && (
          <section className={card}>
            <div className="flex items-center justify-between gap-3">
              <p className={label}>Caption</p>
              <CopyButton text={video.caption} copied={copied} onCopied={setCopied} />
            </div>
            <p className="mt-2 whitespace-pre-wrap leading-relaxed">{video.caption}</p>
          </section>
        )}
      </div>

      <aside className="space-y-5 lg:sticky lg:top-36 lg:max-h-[calc(100vh-11rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
        <section className={`${card} ${approved ? "" : "border-[var(--primary)]"}`}>
          {approved ? (
            <>
              <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--primary)] text-white">
                  <Icon d={ICONS.check} className="h-3.5 w-3.5" />
                </span>
                Script approved
              </h3>
              <p className="mt-2 text-sm opacity-70">Editing a line or asking for a rewrite takes the approval back.</p>
              <button type="button" className={`${primaryButton} mt-4 flex w-full items-center justify-center gap-2`} onClick={onApproved}>
                Go to the cast
                <Icon d={ICONS.arrow} />
              </button>
            </>
          ) : (
            <>
              <h3 className="font-display text-lg font-semibold">Your decision</h3>
              <ul className="mt-3 space-y-2 text-sm">
                {tick(!needsSource || video.claim!.checked, needsSource ? (video.claim!.checked ? "You checked the claim's source" : "Check the claim's source, below") : "No factual claim to check")}
                {tick(failed.length === 0, failed.length === 0 ? `All ${plural(video.checks.length, "rule")} pass` : `${plural(failed.length, "rule")} failed, below`)}
              </ul>
              <button
                type="button"
                className={`${primaryButton} mt-4 w-full`}
                disabled={busy !== "" || problem !== ""}
                onClick={async () => {
                  if (await run("Approving", () => api.approveVideo(video.id))) onApproved();
                }}
              >
                {busy === "Approving" ? "Approving…" : "Approve script"}
              </button>
              <p className="mt-2 text-center text-xs opacity-60">Nothing costly has been made yet.</p>
            </>
          )}
        </section>

        {video.claim && (
          <section className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className={label}>The claim</p>
              <Chip tone={video.claim.evidence === "strong" ? "good" : video.claim.evidence === "none" ? "plain" : "warn"}>{EVIDENCE_LABELS[video.claim.evidence]}</Chip>
            </div>
            <p className="mt-2 font-medium leading-relaxed">{video.claim.fact || "This video makes no factual claim."}</p>
            {video.claim.action && (
              <p className="mt-2 text-sm">
                <span className="opacity-60">The viewer should: </span>
                {video.claim.action}
              </p>
            )}
            {needsSource && (
              <div className="mt-4 border-t border-[var(--line)] pt-4">
                <label className="block text-sm">
                  <span className="font-medium">Source</span>
                  <span className="mt-0.5 block text-xs opacity-60">Claude cannot look things up. Replace this with what you found.</span>
                  <textarea
                    className={`${fieldClass} mt-2`}
                    rows={3}
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    onBlur={() => source.trim() !== video.claim!.source && void save({ claim: { ...video.claim!, source: source.trim() } }, true)}
                  />
                </label>
                <label className={`mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-sm ${video.claim.checked ? "border-emerald-400/40 bg-emerald-500/10" : "border-[var(--accent)]"}`}>
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={video.claim.checked}
                    disabled={busy !== ""}
                    onChange={(e) => void save({ claim: { ...video.claim!, source: source.trim(), checked: e.target.checked } }, true)}
                  />
                  <span>I have checked this source myself and the claim is right.</span>
                </label>
              </div>
            )}
          </section>
        )}

        {video.checks.length > 0 && (
          <section className={card}>
            <p className={label}>Checked against your rules</p>
            <ul className="mt-3 space-y-3 text-sm">
              {[...failed, ...video.checks.filter((c) => c.ok)].map((c, i) => (
                <li key={i} className="flex gap-2.5">
                  <span aria-hidden className={`mt-0.5 shrink-0 font-bold ${c.ok ? "text-emerald-400" : "text-red-400"}`}>
                    {c.ok ? "✓" : "!"}
                  </span>
                  <span>
                    <span className={c.ok ? "opacity-70" : "font-medium"}>{c.rule}</span>
                    {c.note && <span className="mt-0.5 block text-xs opacity-60">{c.note}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {video.source === "remake" && (video.kept.length > 0 || video.changed.length > 0) && (
          <section className={`${card} space-y-4`}>
            {(
              [
                ["Kept from the original", video.kept],
                ["New in your version", video.changed],
              ] as const
            ).map(([heading, list]) => (
              <div key={heading}>
                <p className={label}>{heading}</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                  {list.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        )}

        <section className={card}>
          <label className="block text-sm">
            <span className={label}>Ask for changes</span>
            <textarea
              className={`${fieldClass} mt-2`}
              rows={3}
              placeholder="For example: make the last line sharper, and let me say the closing line myself."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button
            type="button"
            className={`${quietButton} mt-3 w-full`}
            disabled={busy !== "" || !note.trim()}
            onClick={async () => {
              if (await run("Rewriting", () => api.writeVideo(video.id, note))) setNote("");
            }}
          >
            {busy === "Rewriting" ? "Rewriting… about 40 seconds" : `Rewrite (${SCRIPT_COST})`}
          </button>
          {approved && <p className="mt-2 text-xs opacity-60">A rewrite needs your approval again, and changed lines need new voices.</p>}
        </section>
      </aside>
    </div>
  );
}

function CopyButton({ text, copied, onCopied }: { text: string; copied: boolean; onCopied: (copied: boolean) => void }) {
  return (
    <button
      type="button"
      className={`${smallButton} flex items-center gap-1.5`}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        onCopied(true);
        setTimeout(() => onCopied(false), 1500);
      }}
    >
      <Icon d={copied ? ICONS.check : ICONS.copy} className="h-3.5 w-3.5" />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** One scene of the script, read like a page of a screenplay: number and length on the left, what happens and what is said on the right. */
function ScriptScene({
  scene,
  index,
  cast,
  disabled,
  onMadeBy,
  onLine,
}: {
  scene: Scene;
  index: number;
  cast: Character[];
  disabled: boolean;
  onMadeBy: (madeBy: "ai" | "me") => void;
  onLine: (lineIndex: number, text: string) => void;
}) {
  const words = scene.lines.reduce((n, l) => n + countWords(l.text), 0);
  const tooLong = words > Math.ceil(scene.seconds * WORDS_PER_SECOND) + 1;
  const seen = scene.characters.map((id) => cast.find((c) => c.id === id)?.name).filter(Boolean);
  const details = [scene.camera, scene.text && `On screen: “${scene.text}”`, scene.sound && `Sound: ${scene.sound}`, seen.length > 0 && `In the shot: ${seen.join(", ")}`].filter(Boolean);
  return (
    <li className="grid gap-x-5 gap-y-3 px-5 py-5 sm:grid-cols-[3.5rem_minmax(0,1fr)]">
      <div className="flex items-baseline gap-2 sm:block">
        <p className="font-display text-2xl font-semibold tabular-nums opacity-50">{index + 1}</p>
        <p className="text-xs opacity-60">{scene.seconds}s</p>
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide opacity-55">
            {scene.place || "No place given"}
            {scene.continues && index > 0 && <span className="normal-case tracking-normal"> · carries on from scene {index}, no cut</span>}
          </p>
          <div role="radiogroup" aria-label={`Who makes scene ${index + 1}`} className="inline-flex rounded-full border border-[var(--line)] p-0.5 text-xs font-medium">
            {(
              [
                ["ai", "AI makes it", ICONS.ai],
                ["me", "You film it", ICONS.camera],
              ] as const
            ).map(([id, text, icon]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={scene.madeBy === id}
                disabled={disabled}
                onClick={() => scene.madeBy !== id && onMadeBy(id)}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${scene.madeBy === id ? (id === "me" ? "bg-[var(--accent)] text-black" : "bg-[var(--tint)]") : "opacity-55 hover:opacity-100"}`}
              >
                <Icon d={icon} className="h-3 w-3" />
                {text}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-2 leading-relaxed">{scene.action}</p>
        {details.length > 0 && <p className="mt-1 text-sm opacity-55">{details.join(" · ")}</p>}

        {scene.lines.length > 0 && (
          <ul className="mt-3 space-y-2">
            {scene.lines.map((line, i) => (
              <li key={i} className="rounded-xl bg-[var(--bg)] px-3 pb-1 pt-2">
                <p className="flex items-center gap-2 text-xs">
                  <span className={`font-semibold uppercase tracking-wide ${line.speaker === SPEAKER_ME ? "text-[var(--accent)]" : ""}`}>{speakerName(line.speaker, cast)}</span>
                  {line.delivery && <span className="opacity-55">{line.delivery}</span>}
                </p>
                <LineText text={line.text} disabled={disabled} onSave={(text) => onLine(i, text)} />
              </li>
            ))}
          </ul>
        )}
        {tooLong && (
          <p className="mt-2 text-sm text-[var(--accent)]">
            {words} words is a lot for {scene.seconds} seconds. Trim a line or it will sound rushed.
          </p>
        )}
      </div>
    </li>
  );
}

/** A spoken line that can be edited in place; saved when you click away. */
function LineText({ text, disabled, onSave }: { text: string; disabled: boolean; onSave: (text: string) => void }) {
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);
  const box = useRef<HTMLTextAreaElement>(null);

  // The box is as tall as its words, however they wrap, so the whole line is always in view.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight + 2}px`;
    };
    fit();
    // A narrower or wider column wraps the words differently.
    const watcher = new ResizeObserver(fit);
    watcher.observe(el.parentElement ?? el);
    return () => watcher.disconnect();
  }, [draft]);

  return (
    <textarea
      ref={box}
      rows={1}
      aria-label="Line"
      title="Click to edit. Saved when you click away."
      disabled={disabled}
      className="-mx-1.5 mt-0.5 block w-[calc(100%+0.75rem)] resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-1.5 py-1 leading-relaxed hover:border-[var(--line)] focus:border-[var(--primary)] focus:bg-[var(--surface)] focus:outline-none"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = draft.trim();
        if (next && next !== text) onSave(next);
        else setDraft(text);
      }}
    />
  );
}

// ---------- Preview ----------

type Progress = ReturnType<typeof videoProgress>;

/**
 * Plays the script the way the video will run: one scene at a time, each line
 * in its voice where one has been made, with the on-screen text and captions.
 * A scene shows its picture once it has one.
 */
function PreviewTab({
  video,
  cast,
  busy,
  setError,
  setNotice,
  onChange,
  progress,
  onOpenCast,
  onOpenSettings,
  onStoryboard,
  onNext,
}: Shared & { progress: Progress; onOpenCast: () => void; onOpenSettings: () => void; onStoryboard: () => void; onNext: () => void }) {
  // One step per spoken line, or one for a scene nobody speaks in.
  const steps = useMemo(
    () =>
      video.scenes.flatMap((scene, sceneIndex): { scene: Scene; sceneIndex: number; line: SceneLine | null }[] =>
        scene.lines.length ? scene.lines.map((line) => ({ scene, sceneIndex, line })) : [{ scene, sceneIndex, line: null }],
      ),
    [video],
  );
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [voicing, setVoicing] = useState(false);
  const step = steps[Math.min(at, steps.length - 1)];

  // A storyboard is a sheet of four frames. Each line of a scene gets its share of them, in order,
  // and while it plays the frames in that share are stepped through.
  const inScene = steps.filter((s) => s.scene.id === step?.scene.id);
  const place = step ? inScene.indexOf(step) : 0;
  const firstFrame = Math.floor((place * FRAMES) / Math.max(inScene.length, 1));
  const lastFrame = Math.max(firstFrame, Math.floor(((place + 1) * FRAMES) / Math.max(inScene.length, 1)) - 1);
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    setFrame(firstFrame);
    if (!playing || !step || lastFrame === firstFrame) return;
    const seconds = step.line ? Math.max(countWords(step.line.text) / WORDS_PER_SECOND, 1.2) : step.scene.seconds;
    const timer = setInterval(() => setFrame((f) => Math.min(f + 1, lastFrame)), (seconds * 1000) / (lastFrame - firstFrame + 1));
    return () => clearInterval(timer);
  }, [at, playing, firstFrame, lastFrame]);

  useEffect(() => {
    if (!playing) return;
    const current = steps[at];
    if (!current) return setPlaying(false);
    const next = () => (at + 1 < steps.length ? setAt(at + 1) : setPlaying(false));
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
    // No recording (your own line, or a voice not made yet): hold it for as long as it takes to say.
    const words = current.line ? countWords(current.line.text) : 0;
    const timer = setTimeout(next, (current.line ? Math.max(words / WORDS_PER_SECOND, 1.2) : current.scene.seconds) * 1000);
    return () => clearTimeout(timer);
  }, [playing, at, steps]);

  async function makeVoices() {
    setVoicing(true);
    setError("");
    setNotice("");
    try {
      const result = await api.voiceVideo(video.id);
      if (!result.ok) return setError(result.error);
      onChange(result.video);
      setNotice(`${plural(result.made, "line")} spoken.${result.skipped.length ? ` Not done: ${result.skipped.join(", ")}.` : ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The voices could not be made.");
    } finally {
      setVoicing(false);
    }
  }

  if (!step) return null;
  const picture = pickedPicture(step.scene);
  const voiced = progress.aiLines - progress.unvoiced;
  const round = "flex h-10 w-10 items-center justify-center rounded-full border border-[var(--line)] hover:border-[var(--ink)] disabled:opacity-35";

  return (
    <div className="grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)]">
      <div className="mx-auto w-72">
        <div className="relative flex aspect-[9/16] w-full flex-col overflow-hidden rounded-[2rem] border border-[var(--line)] bg-black p-5 text-white shadow-xl">
          {step.scene.animation && <MotionPlayer key={step.scene.animation.id} video={video} scene={step.scene} className="absolute inset-0 h-full w-full" />}
          {picture && !step.scene.animation && (
            // The sheet is shown at twice the size and moved so that only the current frame fills the screen.
            <img
              src={api.studioFileUrl(picture.file)}
              alt={`Storyboard frame ${frame + 1} of scene ${step.sceneIndex + 1}`}
              className="absolute h-[200%] w-[200%] max-w-none object-fill"
              style={{ left: `${-(frame % 2) * 100}%`, top: `${-Math.floor(frame / 2) * 100}%` }}
            />
          )}
          <p className="relative w-fit rounded-full bg-black/55 px-2 py-0.5 text-xs">
            Scene {step.sceneIndex + 1} of {video.scenes.length} · {step.scene.madeBy === "me" ? "you film this" : step.scene.animation ? "animation" : picture ? `frame ${frame + 1} of ${FRAMES}` : "no storyboard"}
          </p>
          {step.scene.text && <p className="relative mt-4 text-center text-xl font-bold leading-tight [text-shadow:0_1px_4px_#000]">{step.scene.text}</p>}
          <p className="relative my-auto text-center text-sm italic leading-relaxed opacity-70">{picture || step.scene.animation ? "" : step.scene.action}</p>
          {step.line && (
            <p className="relative rounded-xl bg-black/65 px-3 py-2 text-center text-sm font-medium leading-snug">
              <span className="block text-[0.7rem] font-normal uppercase tracking-wide opacity-70">{speakerName(step.line.speaker, cast)}</span>
              {step.line.text}
            </p>
          )}
        </div>

        <div className="mt-3 flex gap-1" aria-hidden>
          {steps.map((_, i) => (
            <span key={i} className={`h-1 flex-1 rounded-full ${i <= at ? "bg-[var(--primary)]" : "bg-[var(--tint)]"}`} />
          ))}
        </div>
        <div className="mt-3 flex items-center justify-center gap-3">
          <button type="button" aria-label="Previous line" className={round} disabled={at === 0} onClick={() => setAt(at - 1)}>
            <Icon d={ICONS.back} />
          </button>
          <button
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--primary)] text-white hover:opacity-90"
            onClick={() => {
              if (!playing && at >= steps.length - 1) setAt(0);
              setPlaying(!playing);
            }}
          >
            <Icon d={playing ? ICONS.pause : ICONS.play} className="h-5 w-5" />
          </button>
          <button type="button" aria-label="Next line" className={round} disabled={at >= steps.length - 1} onClick={() => setAt(at + 1)}>
            <Icon d="M9 5l7 7-7 7" />
          </button>
        </div>
      </div>

      <div className="min-w-0 space-y-5">
        <section className={card}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-lg font-semibold">Voices</h3>
              <p className="mt-0.5 text-sm opacity-60">
                {progress.aiLines === 0 ? "No AI lines: you say everything on camera." : `${voiced} of ${plural(progress.aiLines, "AI line")} recorded.`}
              </p>
            </div>
            {progress.unvoiced > 0 ? (
              <button type="button" className={primaryButton} disabled={busy !== "" || voicing} onClick={makeVoices}>
                {voicing ? "Making the voices…" : `Make ${plural(progress.unvoiced, "voice line")}`}
              </button>
            ) : (
              <button type="button" className={`${primaryButton} flex items-center gap-2`} onClick={onNext}>
                On to the clips
                <Icon d={ICONS.arrow} />
              </button>
            )}
          </div>
          {progress.unvoiced > 0 && (
            <p className="mt-2 text-xs opacity-60">
              Uses your ElevenLabs credits.{" "}
              <button type="button" className="underline" onClick={onOpenSettings}>
                Key in Settings
              </button>
            </p>
          )}
          {progress.voiceless.length > 0 && (
            <p className="mt-3 rounded-lg border border-[var(--accent)] px-3 py-2 text-sm">
              No voice chosen for {progress.voiceless.join(", ")}, so their lines cannot be spoken.{" "}
              <button type="button" className="font-medium underline" onClick={onOpenCast}>
                Go to the Cast tab
              </button>
            </p>
          )}
        </section>

        <section className={`${card} !p-0`}>
          <p className={`${label} px-5 pt-4`}>Line by line</p>
          <ol className="mt-2 divide-y divide-[var(--line)]">
            {steps.map((s, i) => (
              <li key={i} className={`flex items-center gap-3 px-5 py-2.5 text-sm ${i === at ? "bg-[var(--tint)]" : ""}`}>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setAt(i)} title="Show this line in the preview">
                  <span className="text-xs opacity-55">
                    Scene {s.sceneIndex + 1}
                    {s.line && ` · ${speakerName(s.line.speaker, cast)}`}
                  </span>
                  <span className="block truncate">{s.line ? s.line.text : <span className="italic opacity-70">{s.scene.action}</span>}</span>
                </button>
                {s.line?.audioFile ? (
                  <PlayLine file={s.line.audioFile} label={`line ${i + 1}`} />
                ) : (
                  <span className="shrink-0 text-xs opacity-55">{!s.line ? "no words" : s.line.speaker === SPEAKER_ME ? "you say this" : "no voice yet"}</span>
                )}
              </li>
            ))}
          </ol>
        </section>

        <p className="text-sm leading-relaxed opacity-60">
          This is the video as it stands: the storyboard, frame by frame, with the voices. Would the right viewer stop in the first two seconds, and does it leave them
          one thing to do? If a picture is off,{" "}
          <button type="button" className="underline" onClick={onStoryboard}>
            redo it on the Storyboard tab
          </button>
          ; if the words are off, go back to Script. It costs far less to fix now than after the clips are made.
        </p>
      </div>
    </div>
  );
}

// ---------- Make ----------

/** The clips: one for each scene, made to follow its storyboard or filmed by the creator. */
function MakeTab({ video, busy, setError, setNotice, onChange, progress, onStoryboard, onNext }: Shared & { progress: Progress; onStoryboard: () => void; onNext: () => void }) {
  const [making, setMaking] = useState("");
  const keys = useMediaKeys();
  const [choices, setChoice] = useMediaChoices();
  const ai = video.scenes.filter((s) => s.madeBy === "ai");
  const motion = isMotion(video);
  const noPicture = ai.filter((s) => !boardId(s)).length;
  /** Whether a scene's clip is still to make: it has its storyboard, and no clip or one that no longer joins the clip before it. */
  const toMake = (scenes: Scene[], i: number) => scenes[i].madeBy === "ai" && boardId(scenes[i]) !== "" && storyboardApproved(scenes[i]) && (!pickedClip(scenes[i]) || joinState(scenes, i) === "stale" || (motion && pickedClip(scenes[i])?.from !== boardId(scenes[i])));
  const waiting = video.scenes.filter((_, i) => toMake(video.scenes, i)).length;
  const stale = video.scenes.filter((_, i) => joinState(video.scenes, i) === "stale").length;

  /**
   * Makes every clip that is still to make. A scene that carries on opens on the last frame of the clip before it,
   * so it waits for that clip; scenes that start a new shot are made side by side. Stops at the first that fails.
   */
  async function makeClips() {
    if (!choices) return;
    setError("");
    setNotice("");
    const scenes = video.scenes;
    // A clip that is remade leaves the clip of the scene carrying on from it out of date, so that one is made again too.
    const which: number[] = [];
    for (let i = 0; i < scenes.length; i++) {
      const follows = i > 0 && scenes[i].continues && scenes[i].madeBy === "ai" && boardId(scenes[i]) !== "" && which.includes(i - 1);
      if (toMake(scenes, i) || follows) which.push(i);
    }
    let running = 0;
    const show = () => setMaking(running > 0 ? `Making ${plural(running, "clip")}` : "Making clips");
    show();
    const made = await inOrder(
      which,
      (i) => (scenes[i].continues ? i - 1 : undefined),
      async (i) => {
        running++;
        show();
        try {
          const result = await api.makeSceneClip(video.id, scenes[i].id, choices.clip);
          if (!result.ok) setError(`Scene ${i + 1}: ${result.error}`);
          else onChange(result.video);
          return result.ok;
        } catch (e) {
          setError(e instanceof Error ? e.message : "The clip could not be made.");
          return false;
        } finally {
          running--;
          show();
        }
      },
    );
    if (made > 0) setNotice(`${plural(made, "clip")} made.`);
    setMaking("");
  }

  if (!choices) return null;
  const off = busy !== "" || making !== "";
  const filmedScenes = video.scenes.length - ai.length;
  const clipsMade = ai.filter((s) => pickedClip(s)).length;
  const filmedAdded = filmedScenes - progress.needFilming;
  const total = video.scenes.length;
  const ready = clipsMade - stale + filmedAdded;
  const allDone = total > 0 && waiting === 0 && noPicture === 0 && progress.needFilming === 0;
  // The three counts that say where the clips stand.
  const tiles = [
    ai.length > 0 && { name: "AI clips", count: `${clipsMade} of ${ai.length}`, done: clipsMade === ai.length },
    stale > 0 && { name: "To remake", count: `${plural(stale, "clip")} no longer joined`, done: false },
    filmedScenes > 0 && { name: "Filmed by you", count: `${filmedAdded} of ${filmedScenes} added`, done: progress.needFilming === 0 },
  ].filter((t): t is { name: string; count: string; done: boolean } => Boolean(t));

  return (
    <div className="space-y-5">
      <section className={`${card} space-y-4`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="font-display text-lg font-semibold">Make the clips</h3>
            <p className="mt-0.5 max-w-2xl text-sm opacity-60">
              {motion
                ? "Each approved animation is rendered to a clip on this computer. It costs nothing and uses no video service."
                : "Each clip follows its scene's storyboard as one continuous shot. A scene that carries on opens on the last frame of the clip before it, so the two play as one take."}
            </p>
          </div>
          <div className="text-right">
            {waiting > 0 ? (
              <button type="button" className={primaryButton} disabled={off} onClick={makeClips}>
                {making ? `${making}…` : `${motion ? "Render" : "Make"} ${plural(waiting, "clip")}`}
              </button>
            ) : (
              <button type="button" className={`${allDone ? primaryButton : quietButton} inline-flex items-center gap-2`} disabled={off} onClick={onNext}>
                Next: finish
                <Icon d={ICONS.arrow} />
              </button>
            )}
            <p className="mt-1.5 max-w-xs text-xs opacity-55">
              {waiting > 0
                ? making
                  ? "This can take minutes. New shots are made at the same time; a scene that carries on waits for the one before it."
                  : motion
                    ? "Free: rendered on this computer, a few seconds for each second of video."
                    : "The costly step: each clip is charged by the service you chose."
                : allDone
                  ? "Every scene has its clip."
                  : progress.needFilming > 0
                    ? `${plural(progress.needFilming, "scene")} still to film and add below.`
                    : ""}
            </p>
          </div>
        </div>

        {total > 0 && (
          <div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--tint)]" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={ready} aria-label="Scenes with a finished clip">
              <div className="h-full rounded-full bg-[var(--primary)] transition-all" style={{ width: `${(Math.max(ready, 0) / total) * 100}%` }} />
            </div>
            <ul className="mt-3 grid gap-2 sm:grid-cols-3">
              {tiles.map((tile) => (
                <li key={tile.name} className="flex items-center gap-2.5 rounded-xl border border-[var(--line)] px-3 py-2">
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-semibold ${tile.done ? "bg-[var(--primary)] text-white" : "border border-[var(--line)]"}`}>
                    {tile.done ? <Icon d={ICONS.check} className="h-3 w-3" /> : ""}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium leading-tight">{tile.name}</span>
                    <span className="block truncate text-xs opacity-60">{tile.count}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {noPicture > 0 && (
          <p className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-4 py-3 text-sm">
            <span className="min-w-0 flex-1">
              {plural(noPicture, "scene")} {noPicture === 1 ? "has" : "have"} no {motion ? "animation" : "storyboard"} yet, so {noPicture === 1 ? "its clip" : "their clips"} cannot be made.
            </span>
            <button type="button" className={smallButton} onClick={onStoryboard}>
              {motion ? "Open the animations" : "Open the storyboard"}
            </button>
          </p>
        )}
        {ai.length > 0 && !motion && (
          <details className="border-t border-[var(--line)] pt-3 text-sm">
            <summary className="cursor-pointer text-xs opacity-60 hover:opacity-100">Clip and lip-sync services</summary>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <ServicePicker task="clip" value={choices.clip} keys={keys} onChange={(c) => setChoice("clip", c)} stacked />
              <ServicePicker task="lipsync" value={choices.lipsync} keys={keys} onChange={(c) => setChoice("lipsync", c)} stacked />
            </div>
          </details>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        {video.scenes.map((scene, index) => (
          <SceneMedia key={scene.id} video={video} scene={scene} index={index} choices={choices} disabled={off} onVideo={onChange} onStoryboard={onStoryboard} />
        ))}
      </div>
    </div>
  );
}

// ---------- Finish ----------

function FinishTab({ video, busy, run }: Shared) {
  const [copied, setCopied] = useState(false);
  const withClip = video.scenes.filter((s) => pickedClip(s)).length;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="space-y-5">
        <section className={card}>
          <h3 className="font-display text-lg font-semibold">Put it together</h3>
          <p className="mt-2 text-sm leading-relaxed opacity-70">
            {withClip} of {plural(video.scenes.length, "scene")} {withClip === 1 ? "has" : "have"} a clip. Joining them into one finished video is not built yet: for now, open each clip from the Make tab and
            join them in your editor.
          </p>
        </section>
        {video.caption && (
          <section className={card}>
            <div className="flex items-center justify-between gap-3">
              <p className={label}>Caption to post with it</p>
              <CopyButton text={video.caption} copied={copied} onCopied={setCopied} />
            </div>
            <p className="mt-2 whitespace-pre-wrap leading-relaxed">{video.caption}</p>
          </section>
        )}
      </div>
      <ResultsForm results={video.results} disabled={busy !== ""} onSave={(results) => run("Saving the results", () => api.recordVideoResults(video.id, results))} />
    </div>
  );
}

/** How a posted video did, typed in a few days later. These numbers shape the hooks of later scripts. */
function ResultsForm({ results, disabled, onSave }: { results: VideoResults | null; disabled: boolean; onSave: (results: VideoResults) => Promise<boolean> }) {
  const blank = { postedOn: "", url: "", views: "", saves: "", shares: "", follows: "", comments: "", note: "" };
  const [draft, setDraft] = useState(() =>
    results
      ? { ...blank, postedOn: results.postedOn, url: results.url, note: results.note, ...Object.fromEntries(RESULT_COUNTS.map((k) => [k, results[k]?.toString() ?? ""])) }
      : blank,
  );
  const [saved, setSaved] = useState(false);
  const set = (key: keyof typeof blank, value: string) => {
    setSaved(false);
    setDraft({ ...draft, [key]: value });
  };

  return (
    <form
      className={`${card} h-fit`}
      onSubmit={async (e) => {
        e.preventDefault();
        // Empty boxes are saved as "not recorded", never as zero.
        const ok = await onSave({ ...draft, ...Object.fromEntries(RESULT_COUNTS.map((k) => [k, draft[k].trim() === "" ? null : Number(draft[k])])) } as unknown as VideoResults);
        setSaved(ok);
      }}
    >
      <h3 className="font-display text-lg font-semibold">How did it do?</h3>
      <p className="mt-1 text-sm opacity-60">Fill this in a few days after posting. Later scripts learn from the openings that found your kind of viewer.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium">Posted on</span>
          <input type="date" className={`${fieldClass} mt-1`} value={draft.postedOn} onChange={(e) => set("postedOn", e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="font-medium">Link</span>
          <input className={`${fieldClass} mt-1`} placeholder="https://…" value={draft.url} onChange={(e) => set("url", e.target.value)} />
        </label>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {RESULT_COUNTS.map((key) => (
          <label key={key} className="block text-sm">
            <span className="font-medium capitalize">{key}</span>
            <input type="number" min={0} inputMode="numeric" className={`${fieldClass} mt-1`} value={draft[key]} onChange={(e) => set(key, e.target.value)} />
          </label>
        ))}
      </div>
      <label className="mt-4 block text-sm">
        <span className="font-medium">Where did people stop watching? Anything else to remember?</span>
        <textarea className={`${fieldClass} mt-1`} rows={2} value={draft.note} onChange={(e) => set("note", e.target.value)} />
      </label>
      <div className="mt-4 flex items-center gap-3">
        <button type="submit" className={primaryButton} disabled={disabled}>
          Save results
        </button>
        {saved && <span className="text-sm font-medium text-emerald-400">Saved.</span>}
      </div>
    </form>
  );
}
