// One video, worked on a step at a time: Script, Cast, Storyboard, Clips, Music, Effects, Export. Storyboard and Clips each show every scene at once.
// Each tab shows only what that stage needs, and the header always says what to do next.
import { useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { BrandKit } from "@shared/brand";
import type { Idea } from "@shared/ideas";
import type { ResearchItem } from "@shared/research";
import {
  approvalProblem,
  EVIDENCE_LABELS,
  effectsState, joinState, musicState, pickedClip, pickedPicture, POST_LIMITS, type FixStep,
  boardId,
  isMotion,
  storyboardApproved,
  productionLabel,
  styleLabel,
  platformLabel,
  scriptReviewState,
  SPEAKER_ME,
  speakerName,
  type Character,
  type Scene,
  type Series,
  type Video,
} from "@shared/studio";
import type { EditProject } from "@shared/edit";
import { api } from "./api";
import { overlayFrames } from "./EditDraw";
import { VideoAssets } from "./AssetsView";
import { CastStep } from "./CastStep";
import { DeleteButton } from "./CastView";
import { inOrder } from "./inOrder";
import { SceneMedia } from "./SceneMedia";
import { Player } from "./Player";
import { ClipsTab, StoryboardTab } from "./Scenes";
import { MusicStep } from "./MusicStep";
import { EffectsStep } from "./EffectsStep";
import { OpenEditorContext } from "./EditorView";
import { MotionBoard } from "./MotionBoard";
import { ServicePicker, useMediaChoices, useMediaKeys } from "./ServicePicker";
import { card, Chip, Dialog, fieldClass, Icon, ICONS, label, NextBar, postName, primaryButton, quietButton, SCRIPT_COST, smallButton, STAGES, videoCast, videoProgress, WORDS_PER_SECOND } from "./studioUi";

const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;
/** How many frames a scene's storyboard sheet holds: two across, two down. */
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
  /** A character was changed on the Cast step. */
  onCast: (character: Character) => void;
}) {
  const progress = videoProgress(video, cast, brand);
  const [tab, setTab] = useState(progress.tab);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  /** Whether the video's assets are shown in place of its steps, the whole video is playing, or its settings are open. */
  const [assets, setAssets] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [settings, setSettings] = useState(false);

  const written = video.scenes.length > 0;
  const approved = video.approvedAt !== "";
  const castInfo = videoCast(video, cast, brand);
  /** Why a step cannot be opened yet, or "" when it can. Only the script gates anything: the rest says what is missing in place. */
  const locked = (index: number) => (index === 0 ? "" : !written ? "Write the script first." : !approved ? "Approve the script first." : "");

  // A rewrite takes the approval back, which can close the step being looked at.
  useEffect(() => {
    if (locked(tab)) setTab(0);
  });
  // Messages belong to the step they were shown on.
  useEffect(() => {
    setError("");
    setNotice("");
  }, [tab]);

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
    video.format === "episode" ? `Episode ${video.episode ?? ""}${series ? ` of ${series.title}` : ""}` : "",
    productionLabel(video.production),
    video.production !== "me" && (video.style || series?.style) ? styleLabel(video.style || series?.style || "") : "",
    platformLabel(video.platform || series?.platform || ""),
    written ? `${seconds}s · ${plural(video.scenes.length, "scene")}` : "",
  ].filter(Boolean);
  const shared = { video, cast, brand, busy, run, save, setError, setNotice, onChange };
  /** A short note beside a step's name: what it still wants. */
  const badge = (i: number) =>
    i === 1 && approved && castInfo.unready > 0 ? `${castInfo.unready} to set up` : i >= 2 && i <= 5 && approved && progress.tab === i && progress.waiting ? progress.next.toLowerCase() : "";

  if (assets) return <VideoAssets video={video} onBack={() => setAssets(false)} />;

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
            {written && (
              <button type="button" className={`${quietButton} flex items-center gap-2`} title="Play the whole video as it stands: clips where they are made, the storyboard and voices elsewhere" onClick={() => setPlaying(true)}>
                <Icon d={ICONS.play} />
                Play
              </button>
            )}
            <button type="button" aria-label="Video settings" title="Style, look, and the services that make pictures and clips" className="rounded-full border border-[var(--line)] p-2 hover:border-[var(--ink)]" onClick={() => setSettings(true)}>
              <Icon d={ICONS.gear} />
            </button>
            <button type="button" aria-label="Assets" title="Every storyboard, clip and voice line made for this video, and the folder they are in" className="rounded-full border border-[var(--line)] p-2 hover:border-[var(--ink)]" onClick={() => setAssets(true)}>
              <Icon d={ICONS.film} />
            </button>
            <DeleteButton name="this video" onConfirm={onDelete} />
          </div>

          <div role="tablist" aria-label="Steps" className="-mb-px mt-4 flex gap-1 overflow-x-auto">
            {STAGES.map((name, i) => {
              const why = locked(i);
              const done = i < progress.done;
              const note = badge(i);
              return (
                <button
                  key={name}
                  type="button"
                  role="tab"
                  aria-selected={tab === i}
                  aria-disabled={why !== ""}
                  title={why || undefined}
                  onClick={() => (why ? setError(why) : setTab(i))}
                  className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium ${tab === i ? "border-[var(--primary)]" : "border-transparent opacity-65 hover:opacity-100"} ${why ? "cursor-not-allowed !opacity-35" : ""}`}
                >
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[0.7rem] font-semibold ${done ? "bg-[var(--primary)] text-white" : tab === i ? "border border-[var(--primary)]" : "border border-[var(--line)]"}`}>
                    {done ? <Icon d={ICONS.check} className="h-3 w-3" /> : i + 1}
                  </span>
                  {name}
                  {note && <span className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-xs font-medium text-[var(--accent)]">{note}</span>}
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

        {tab === 0 && !written && <WriteScript {...shared} ideas={ideas} posts={posts} series={series} />}
        {tab === 0 && written && <ScriptTab {...shared} ideas={ideas} posts={posts} series={series} onApproved={() => setTab(castInfo.unready > 0 ? 1 : 2)} />}
        {tab === 1 && approved && <CastStep video={video} cast={cast} brand={brand} onCast={onCast} onVideo={onChange} onNext={() => setTab(2)} onOpenSettings={onOpenSettings} onOpenBrand={onOpenBrand} />}
        {tab === 2 && approved && !isMotion(video) && <StoryboardTab {...shared} onNext={() => setTab(3)} />}
        {tab === 2 && approved && isMotion(video) && <MotionBoard video={video} busy={busy} save={save} setError={setError} setNotice={setNotice} onChange={onChange} onNext={() => setTab(3)} />}
        {tab === 3 && approved && !isMotion(video) && <ClipsTab {...shared} progress={progress} onOpenCast={() => setTab(1)} onStoryboards={() => setTab(2)} onNext={() => setTab(4)} />}
        {tab === 3 && approved && isMotion(video) && <MakeTab {...shared} progress={progress} onNext={() => setTab(4)} />}
        {tab === 4 && approved && <MusicStep video={video} setError={setError} setNotice={setNotice} onChange={onChange} onPlay={() => setPlaying(true)} onNext={() => setTab(5)} />}
        {tab === 5 && approved && <EffectsStep video={video} cast={cast} setError={setError} setNotice={setNotice} onChange={onChange} onNext={() => setTab(6)} />}
        {tab === 6 && approved && <ExportTab {...shared} onGoTo={setTab} />}
      </div>

      {playing && <Player video={video} cast={cast} onClose={() => setPlaying(false)} />}
      {settings && <VideoSettings video={video} series={series} save={save} onClose={() => setSettings(false)} />}
    </div>
  );
}

/** The video's settings in one place: the style and look of its AI scenes, and the services that make its pictures and clips. */
function VideoSettings({ video, series, save, onClose }: { video: Video; series?: Series; save: (changes: Partial<Video>, keepApproval?: boolean) => Promise<boolean>; onClose: () => void }) {
  const keys = useMediaKeys();
  const [choices, setChoice] = useMediaChoices();
  const [look, setLook] = useState(video.look);
  const close = async () => {
    const changes: Partial<Video> = {};
    if (look.trim() !== video.look) changes.look = look.trim();
    if (Object.keys(changes).length) await save(changes, true);
    onClose();
  };
  return (
    <Dialog
      title="Video settings"
      onClose={() => void close()}
      footer={
        <button type="button" className={primaryButton} onClick={() => void close()}>
          Done
        </button>
      }
    >
      {video.production !== "me" && !isMotion(video) && (
        <section className="space-y-3">
          <h3 className={label}>Look of the AI scenes</h3>
          <p className="text-sm opacity-70">Style: {styleLabel(video.style || series?.style || "")}, chosen when the video was started.</p>
          <label className="block text-sm">
            <span className="font-medium">Look every AI scene shares</span>
            <input className={`${fieldClass} mt-1.5`} placeholder="For example: warm evening light, shallow focus" value={look} onChange={(e) => setLook(e.target.value)} />
          </label>
          <p className="text-xs opacity-60">Used for what is drawn from now on. Storyboards already made keep their look until they are drawn again.</p>
        </section>
      )}
      {choices && (
        <section className="space-y-3">
          <h3 className={label}>Services</h3>
          <p className="text-xs opacity-60">These are your defaults for every video.</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <ServicePicker task="picture" value={choices.picture} keys={keys} onChange={(c) => setChoice("picture", c)} stacked />
            <ServicePicker task="clip" value={choices.clip} keys={keys} onChange={(c) => setChoice("clip", c)} stacked />
            <ServicePicker task="lipsync" value={choices.lipsync} keys={keys} onChange={(c) => setChoice("lipsync", c)} stacked />
          </div>
        </section>
      )}
    </Dialog>
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

// ---------- What it is about ----------

/** Where the video comes from and what it is about: the idea, and what the creator added for the script. */
function AboutVideo({ video, busy, save, ideas, posts, series }: Shared & { ideas: Idea[]; posts: ResearchItem[]; series?: Series }) {
  const [brief, setBrief] = useState(video.brief);
  const written = video.scenes.length > 0;
  const idea = ideas.find((i) => i.id === video.ideaIds[0]);
  const inspired = video.postIds.map((id) => posts.find((p) => p.id === id)).filter((p) => p !== undefined).map(postName);
  const source = [
    series && `Episode ${video.episode ?? ""} of ${series.title}`,
    video.source === "remake" && "Your own version of a saved post",
    inspired.length > 0 && `Inspired by ${inspired.join(" · ")}`,
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      {idea && (
        <div className="space-y-3">
          <p className="border-l-4 border-[var(--accent)] pl-3 font-display text-lg font-medium leading-snug">“{idea.hook}”</p>
          <div className="grid gap-x-8 gap-y-3 text-sm lg:grid-cols-2">
            <dl className="space-y-2">
              {idea.viewer && (
                <div>
                  <dt className={label}>Who it is for</dt>
                  <dd className="mt-0.5">{idea.viewer}</dd>
                </div>
              )}
              {idea.takeaway && (
                <div>
                  <dt className={label}>What they leave with</dt>
                  <dd className="mt-0.5">{idea.takeaway}</dd>
                </div>
              )}
            </dl>
            {idea.outline.length > 0 && (
              <div>
                <p className={label}>Outline</p>
                <ol className="mt-0.5 list-decimal space-y-0.5 pl-5 leading-relaxed">
                  {idea.outline.map((beat, i) => (
                    <li key={i}>{beat}</li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </div>
      )}
      <label className="block text-sm">
        <span className="font-medium">{idea ? "Anything to add for the script" : "What this video is about"}</span>
        <textarea
          className={`${fieldClass} mt-1.5`}
          rows={2}
          placeholder={idea ? "Optional. For example: keep it under 40 seconds, or let me say the closing line myself." : "The topic, who it is for, and anything it must include."}
          value={brief}
          disabled={busy !== ""}
          onChange={(e) => setBrief(e.target.value)}
          onBlur={() => brief.trim() !== video.brief && void save({ brief }, true)}
        />
      </label>
      {(source.length > 0 || written) && <p className="text-xs opacity-60">{[...source, written && "A change here is used the next time you ask for a rewrite."].filter(Boolean).join(" · ")}</p>}
    </div>
  );
}

/** The Script step before there is a script: what it is about, and writing it is the one thing to do. */
function WriteScript(props: Shared & { ideas: Idea[]; posts: ResearchItem[]; series?: Series }) {
  const { video, busy, run } = props;
  return (
    <div className="space-y-5">
      <NextBar
        title={busy === "Writing the script" ? "Writing the script… about 40 seconds" : "Write the script"}
        note="Every scene with its lines, the claim and its evidence, and a check against your rules. You approve it before anything costly is made."
        action={`Write it (${SCRIPT_COST})`}
        busy={busy !== ""}
        onAction={() => void run("Writing the script", () => api.writeVideo(video.id, ""))}
      />
      <section className={card}>
        <AboutVideo {...props} />
      </section>
    </div>
  );
}

// ---------- 2. Script ----------

function ScriptTab(props: Shared & { ideas: Idea[]; posts: ResearchItem[]; series?: Series; onApproved: () => void }) {
  const { video, cast, busy, run, save, onApproved } = props;
  const [note, setNote] = useState("");
  const [source, setSource] = useState(video.claim?.source ?? "");
  const [copied, setCopied] = useState(false);
  useEffect(() => setSource(video.claim?.source ?? ""), [video.claim?.source]);

  const approved = video.approvedAt !== "";
  const problem = approvalProblem(video);
  const continuity = scriptReviewState(video);
  const contradictions = video.scriptReview?.problems ?? [];
  const failed = video.checks.filter((c) => !c.ok);
  const needsSource = video.claim !== null && video.claim.evidence !== "none";
  const words = video.scenes.reduce((n, s) => n + s.lines.reduce((m, l) => m + countWords(l.text), 0), 0);
  const seconds = video.scenes.reduce((n, s) => n + s.seconds, 0);
  const editScene = (id: string, change: (scene: Scene) => Scene) => save({ scenes: video.scenes.map((s) => (s.id === id ? change(s) : s)) });

  const fixContinuity = () =>
    run("Fixing", () =>
      api.writeVideo(video.id, [`Fix these continuity problems and change nothing else:`, ...contradictions.map((p) => `- ${p.scene > 0 ? `Scene ${p.scene}: ` : ""}${p.problem}`), video.scriptReview?.fix ?? ""].filter(Boolean).join("\n")),
    );
  async function approve() {
    let done = false;
    await run("Approving", async () => {
      // Approving reads the script for continuity first; if that finds something, the problems show instead.
      if (continuity !== "passed") {
        const checked = await api.checkScript(video.id);
        if (!checked.ok || !checked.value.scriptReview?.ok) return checked;
      }
      const result = await api.approveVideo(video.id);
      done = result.ok;
      return result;
    });
    if (done) onApproved();
  }
  const working = busy === "Approving" ? (continuity === "passed" ? "Approving…" : "Checking continuity… about 30 seconds") : busy === "Fixing" ? "Rewriting and checking again… about a minute" : busy === "Rewriting" ? "Rewriting… about 40 seconds" : "";
  const next = approved
    ? { title: "Script approved", note: "Editing a line or asking for a rewrite takes the approval back.", action: "Go on", act: onApproved }
    : continuity === "failed"
      ? { title: `Fix ${plural(contradictions.length, "continuity problem")}`, note: "The script says different things from one scene to the next. The rewrite changes only those parts and is checked again.", action: `Fix with a rewrite (${SCRIPT_COST})`, act: () => void fixContinuity() }
      : problem
        ? { title: "Check the claim's source", note: "Claude cannot look things up. Confirm the source in the claim box, tick it, then approve.", action: undefined, act: undefined }
        : { title: "Read it through, then approve", note: continuity === "passed" ? "Every check passes. Nothing costly has been made yet." : "Approving first checks that no scene contradicts another (a few cents).", action: continuity === "passed" ? "Approve script" : "Check and approve", act: () => void approve() };

  const tick = (ok: boolean, text: ReactNode) => (
    <li className="flex items-start gap-2.5">
      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${ok ? "bg-emerald-500/20 text-emerald-400" : "border border-[var(--accent)] text-[var(--accent)]"}`}>
        {ok && <Icon d={ICONS.check} className="h-2.5 w-2.5" />}
      </span>
      <span className={ok ? "opacity-70" : "font-medium"}>{text}</span>
    </li>
  );

  return (
    <div className="space-y-5">
    <NextBar title={working || next.title} note={working ? undefined : next.note} action={working ? undefined : next.action} busy={busy !== ""} onAction={next.act} />
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-5">
        <details className={`${card} group`}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
            <span className={label}>What it is about</span>
            <span className="text-xs opacity-60 group-open:hidden">Show</span>
          </summary>
          <div className="mt-4">
            <AboutVideo {...props} />
          </div>
        </details>
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

        {video.sets.length > 0 && <PlacesCard video={video} disabled={busy !== ""} save={save} />}

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
        <section className={card}>
          <h3 className={label}>{approved ? "Approved" : "Ready to approve?"}</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {tick(!needsSource || video.claim!.checked, needsSource ? (video.claim!.checked ? "You checked the claim's source" : "Check the claim's source, below") : "No factual claim to check")}
            {tick(failed.length === 0, failed.length === 0 ? `All ${plural(video.checks.length, "rule")} pass` : `${plural(failed.length, "rule")} failed, below`)}
            {tick(
              continuity === "passed",
              continuity === "passed" ? "No scene contradicts another" : continuity === "failed" ? `${plural(contradictions.length, "continuity problem")}, below` : "Continuity is checked when you approve",
            )}
          </ul>
        </section>

        {video.scenes.length > 0 && (
          <section className={`${card} ${continuity === "failed" ? "border-[var(--accent)]" : ""}`}>
            <p className={label}>Continuity</p>
            {continuity === "failed" ? (
              <>
                <p className="mt-2 text-sm opacity-70">These would show as mistakes between shots:</p>
                <ul className="mt-3 space-y-2.5 text-sm">
                  {contradictions.map((p, i) => (
                    <li key={i} className="flex gap-2.5">
                      <span aria-hidden className="mt-0.5 shrink-0 font-bold text-red-400">!</span>
                      <span>
                        {p.scene > 0 && <span className="font-medium">Scene {p.scene}: </span>}
                        {p.problem}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : continuity === "stale" ? (
              <p className="mt-2 text-sm opacity-70">The script changed since it was last checked.{approved ? "" : " It is checked again when you approve."}</p>
            ) : continuity === "unchecked" ? (
              <p className="mt-2 text-sm opacity-70">
                Not checked yet. Claude looks for anything that changes between scenes, like a stool that becomes a table, and describes each place so every storyboard shows the same set.
                {approved ? " A problem it finds takes the approval back." : ""}
              </p>
            ) : (
              <p className="mt-2 text-sm opacity-70">Checked: nothing contradicts itself from scene to scene.</p>
            )}
            <button type="button" className={`${quietButton} mt-3 w-full`} disabled={busy !== ""} onClick={() => void run("Checking", () => api.checkScript(video.id))}>
              {busy === "Checking" ? "Checking… about 30 seconds" : `${continuity === "unchecked" ? "Check now" : "Check again"} (a few cents)`}
            </button>
          </section>
        )}

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
    </div>
  );
}

/** Each place the scenes happen in, as every storyboard and clip of it will show it. The creator can correct it. */
function PlacesCard({ video, disabled, save }: { video: Video; disabled: boolean; save: Shared["save"] }) {
  const [drafts, setDrafts] = useState(video.sets.map((s) => s.description));
  useEffect(() => setDrafts(video.sets.map((s) => s.description)), [video.sets]);
  return (
    <section className={card}>
      <p className={label}>Places</p>
      <p className="mt-1 text-sm opacity-60">Every storyboard and clip of a place is drawn from what is written here, so each shot shows the same set. Correct anything that is wrong.</p>
      <div className="mt-4 space-y-4">
        {video.sets.map((set, i) => (
          <label key={set.place} className="block text-sm">
            <span className="font-medium">{set.place}</span>
            <textarea
              className={`${fieldClass} mt-1.5`}
              rows={4}
              disabled={disabled}
              value={drafts[i] ?? ""}
              onChange={(e) => setDrafts(drafts.map((d, j) => (j === i ? e.target.value : d)))}
              onBlur={() => {
                const text = (drafts[i] ?? "").trim();
                if (text && text !== set.description) void save({ sets: video.sets.map((s, j) => (j === i ? { ...s, description: text } : s)) });
              }}
            />
          </label>
        ))}
      </div>
    </section>
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

type Progress = ReturnType<typeof videoProgress>;

// ---------- Clips of a motion graphics video ----------

/** The clips of a motion graphics video: each approved animation rendered on this computer, or filmed by the creator. */
function MakeTab({ video, busy, setError, setNotice, onChange, progress, onNext }: Shared & { progress: Progress; onNext: () => void }) {
  const onStoryboard = () => window.scrollTo({ top: 0, behavior: "smooth" });
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

// ---------- Export ----------

const FIX_TAB: Record<FixStep, number> = { script: 0, cast: 1, storyboard: 2, clips: 3, music: 4, effects: 5, export: 6 };
const FIX_LABEL: Record<FixStep, string> = { script: "Script", cast: "Cast", storyboard: "Storyboard", clips: "Clips", music: "Music", effects: "Effects", export: "Export" };
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * The last step: watch the whole video, export it, and get it ready to post. The export is built afresh from everything
 * Studio has (clips, voices, music, captions, effects and the end card) into one 1080×1920 MP4. After each export,
 * Claude checks the finished video and writes the posting kit; the creator picks a cover.
 */
function ExportTab({ video, cast, onChange, onGoTo }: Shared & { onGoTo: (tab: number) => void }) {
  const openEditor = useContext(OpenEditorContext);
  const [toEditor, setToEditor] = useState("");
  const [render, setRender] = useState<EditProject | null>(null);
  const [stage, setStage] = useState<"" | "building" | "drawing" | "making">("");
  const [share, setShare] = useState(0);
  const [failed, setFailed] = useState("");
  const [checking, setChecking] = useState(false);
  const [writing, setWriting] = useState(false);
  useEffect(() => {
    api.videoExportProject(video.id).then(setRender).catch(() => setRender(null));
  }, [video.id]);

  const refresh = async () => {
    const fresh = (await api.listVideos().catch(() => [])).find((v) => v.id === video.id);
    if (fresh) onChange(fresh);
  };

  async function edit() {
    setToEditor("Bringing it into the editor…");
    const made = await api.editFromVideo(video.id).catch((e) => ({ ok: false as const, error: String(e?.message ?? e) }));
    if (made.ok) openEditor(made.project.id);
    else setToEditor(made.error);
  }

  async function check() {
    setChecking(true);
    try {
      const result = await api.checkVideoExport(video.id);
      if (result.ok) onChange(result.value);
      else setFailed(result.error);
    } finally {
      setChecking(false);
    }
  }

  async function writeKit() {
    setWriting(true);
    try {
      const result = await api.writePostKit(video.id);
      if (result.ok) onChange(result.value);
      else setFailed(result.error);
    } finally {
      setWriting(false);
    }
  }

  async function exportIt() {
    setFailed("");
    setShare(0);
    try {
      setStage("building");
      const built = await api.buildVideoExport(video.id);
      if (!built.ok) return setFailed(built.error);
      setStage("drawing");
      // Captions and text are drawn here exactly as the player shows them, then laid over the video by FFmpeg.
      const frames = await overlayFrames(built.project);
      setStage("making");
      const timer = window.setInterval(async () => {
        const s = await api.editExportProgress(built.project.id);
        if (s !== null) setShare(s);
      }, 600);
      const made = await api.exportEdit(built.project.id, frames).finally(() => window.clearInterval(timer));
      if (!made.ok) return setFailed(made.error);
      setRender(made.project);
      await refresh();
    } catch (e) {
      return setFailed(e instanceof Error ? e.message : "The video could not be exported.");
    } finally {
      setStage("");
    }
    // Every export is checked, and the first one gets its posting kit.
    await Promise.all([check(), video.postKit ? Promise.resolve() : writeKit()]);
  }

  const last = render?.exports[0];
  const running = stage !== "";
  const stills = video.scenes.filter((s) => !pickedClip(s) && pickedPicture(s)).length;
  const empty = video.scenes.filter((s) => !pickedClip(s) && !pickedPicture(s)).length;
  const notes = [
    stills > 0 && `${plural(stills, "scene")} ${stills === 1 ? "has" : "have"} no clip yet, so ${stills === 1 ? "its" : "their"} storyboard is shown.`,
    empty > 0 && `${plural(empty, "scene")} ${empty === 1 ? "has" : "have"} nothing to show yet (to be filmed), so ${empty === 1 ? "it is" : "they are"} left out.`,
    musicState(video) !== "approved" && "The music is not approved yet: what is planned is used, or none.",
    effectsState(video) !== "approved" && "The effects are not approved yet: what is planned is used, or none.",
  ].filter((n): n is string => Boolean(n));
  // The cover made, unless the creator chose to post without one of their own.
  const cover = video.coverPlan?.skipped ? null : video.cover;
  const fc = video.finalCheck;
  const fcCurrent = Boolean(fc && last && fc.exportFile === last.file);

  return (
    <div className="space-y-5">
      <NextBar
        title={running ? (stage === "building" ? "Gathering the clips, voices, music and effects, and timing every word…" : stage === "drawing" ? "Drawing the captions and text…" : `Making the video… ${Math.round(share * 100)}%`) : last ? "Your video is exported" : "Export the video"}
        note={
          running
            ? "The video is made on your computer at no cost. Timing new voice lines uses a little Deepgram."
            : last
              ? `Exported ${new Date(last.createdAt).toLocaleString()}. Export again after any change; it replaces this one.`
              : "One 1080×1920 MP4: captions timed to every word and burned in, pauses tightened, music under the voices, sound levelled for the platforms. Then Claude checks it and writes your posting kit (a few cents)."
        }
        action={running ? undefined : last ? "Export again" : "Export"}
        busy={running || checking || writing}
        onAction={() => void exportIt()}
      >
        {!running && stills + empty > 0 && (
          <button type="button" className={smallButton} onClick={() => onGoTo(3)}>
            Go to clips
          </button>
        )}
      </NextBar>
      {running && (
        <div className="h-2 overflow-hidden rounded-full bg-[var(--tint)]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
          <div className="h-full rounded-full bg-[var(--primary)] transition-[width]" style={{ width: `${stage === "making" ? Math.max(share * 100, 5) : 3}%` }} />
        </div>
      )}
      {failed && (
        <p role="alert" className="rounded-xl border border-red-400/50 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-300">
          {failed}
        </p>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="space-y-5">
          <div className="space-y-2">
            <p className={label}>Watch it through</p>
            <Player video={video} cast={cast} inline />
          </div>
          {notes.length > 0 && (
            <section className={card}>
              <p className="font-display text-lg font-semibold">Before you export</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm opacity-75">
                {notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </section>
          )}
          <section className={card}>
            <p className="font-display text-lg font-semibold">Fine-tune in the editor</p>
            <p className="mt-1 text-sm opacity-65">Trim, reorder and change anything by hand or with the AI editor, then export from there. This export stays as it is.</p>
            <button type="button" className={`${quietButton} mt-3`} disabled={toEditor.endsWith("…")} onClick={() => void edit()}>
              {toEditor.endsWith("…") ? toEditor : "Open in the editor"}
            </button>
            {toEditor && !toEditor.endsWith("…") && <p className="mt-2 text-sm text-red-400">{toEditor}</p>}
          </section>
        </div>

        <div className="space-y-5">
          {last && render && (
            <section className={`${card} flex flex-wrap gap-4`}>
              <video key={last.file} controls src={api.studioFileUrl(last.file)} className="aspect-[9/16] w-36 rounded-xl bg-black object-cover" />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="font-display text-lg font-semibold">The exported video</p>
                <p className="text-sm opacity-65">{Math.round(last.seconds)}s · 1080×1920 MP4</p>
                <div className="flex flex-col gap-2">
                  <a className={`${primaryButton} text-center`} href={api.studioFileUrl(last.file)} download={`${video.title}.mp4`}>
                    Save a copy
                  </a>
                  {last.srt && (
                    <a className={`${quietButton} text-center`} href={api.studioFileUrl(last.srt)} download={`${video.title}.srt`}>
                      Captions file (.srt)
                    </a>
                  )}
                  <button type="button" className={quietButton} onClick={() => void api.openAssetsFolder("edits", render.id)}>
                    Show in folder
                  </button>
                </div>
              </div>
            </section>
          )}

          {last && (
            <section className={`${card} space-y-3`}>
              <div className="flex items-center gap-3">
                <p className="flex-1 font-display text-lg font-semibold">Final check</p>
                <button type="button" className={smallButton} disabled={checking || running} onClick={() => void check()}>
                  {checking ? "Checking…" : fc ? "Check again" : "Check it"}
                </button>
              </div>
              {checking ? (
                <p className="text-sm opacity-70">Claude is watching frames of the exported video and reading its captions…</p>
              ) : !fc ? (
                <p className="text-sm opacity-65">Claude looks at the finished video for what a viewer would notice: AI faults, a character who changes, captions over a face, a slow opening. A few cents.</p>
              ) : (
                <>
                  {!fcCurrent && <p className="text-xs font-medium text-[var(--accent)]">This check is of an earlier export. Check again.</p>}
                  <p className={`text-sm ${fc.ok ? "text-emerald-400" : "font-medium text-[var(--accent)]"}`}>{fc.ok ? "Ready to post. " : "Worth fixing before you post. "}<span className="font-normal text-[var(--ink)] opacity-80">{fc.summary}</span></p>
                  {fc.issues.length > 0 && (
                    <ul className="space-y-2">
                      {fc.issues.map((x, i) => (
                        <li key={i} className={`rounded-xl border px-3 py-2 text-sm ${x.serious ? "border-[var(--accent)]/50 bg-[var(--accent)]/10" : "border-[var(--line)]"}`}>
                          <p className="text-xs opacity-60">
                            {clock(x.time)}
                            {x.scene ? ` · scene ${x.scene}` : ""}
                            {x.serious ? " · would put viewers off" : ""}
                          </p>
                          <p className="leading-snug">{x.problem}</p>
                          {x.fix && <p className="mt-1 text-xs opacity-70">Fix: {x.fix}</p>}
                          {x.step !== "export" && (
                            <button type="button" className={`${smallButton} mt-2`} onClick={() => onGoTo(FIX_TAB[x.step])}>
                              Go to {FIX_LABEL[x.step]}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </section>
          )}

          <section className={`${card} flex flex-wrap items-center gap-4`}>
            {cover && <img src={api.studioFileUrl(cover.file)} alt="The cover" className="aspect-[9/16] w-20 rounded-xl object-cover" />}
            <div className="min-w-0 flex-1 space-y-2">
              <p className="font-display text-lg font-semibold">Cover</p>
              <p className="text-sm opacity-65">
                {cover ? "The picture in your profile grid. Upload it as the cover when you post." : video.coverPlan?.skipped ? "No cover of your own: the platform will use a frame of the video." : "No cover chosen yet."}
              </p>
              <div className="flex flex-wrap gap-2">
                {cover && (
                  <a className={smallButton} href={api.studioFileUrl(cover.file)} download={`${video.title} cover.jpg`}>
                    Save the cover
                  </a>
                )}
                <button type="button" className={smallButton} onClick={() => onGoTo(5)}>
                  {cover ? "Change the cover" : video.coverPlan?.skipped ? "Choose a cover after all" : "Choose a cover"}
                </button>
              </div>
            </div>
          </section>

          <PostKitCard video={video} writing={writing} onWrite={() => void writeKit()} />
        </div>
      </div>
    </div>
  );
}

const PLATFORM_TABS = [
  { id: "tiktok", name: "TikTok", label: "Turn on “AI-generated content” in the post's settings (under More options) before you post." },
  { id: "instagram", name: "Instagram", label: "Turn on “AI label” under Advanced settings before you share the reel." },
  { id: "youtube", name: "YouTube", label: "In the upload details, answer Yes to “Altered or synthetic content”." },
] as const;

/** What to post with the video on each platform, ready to copy. */
function PostKitCard({ video, writing, onWrite }: { video: Video; writing: boolean; onWrite: () => void }) {
  const [tab, setTab] = useState<(typeof PLATFORM_TABS)[number]["id"]>("tiktok");
  const [copied, setCopied] = useState("");
  const kit = video.postKit;
  const usesAi = video.scenes.some((s) => s.madeBy === "ai");
  const copy = (key: string, text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      window.setTimeout(() => setCopied(""), 1500);
    });
  };
  const tags = (list: string[]) => list.map((t) => `#${t}`).join(" ");
  const field = (key: string, name: string, text: string, limit: number) => (
    <div key={key} className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium opacity-70">{name}</span>
        <span className={`tabular-nums ${text.length > limit ? "text-red-400" : "opacity-50"}`}>
          {text.length}/{limit}
        </span>
      </div>
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 whitespace-pre-wrap rounded-lg bg-[var(--tint)] px-3 py-2 text-sm leading-relaxed">{text}</p>
        <button type="button" className={smallButton} onClick={() => copy(key, text)}>
          {copied === key ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
  const platform = PLATFORM_TABS.find((p) => p.id === tab)!;

  return (
    <section className={`${card} space-y-3`}>
      <div className="flex items-center gap-3">
        <p className="flex-1 font-display text-lg font-semibold">Posting kit</p>
        <button type="button" className={smallButton} disabled={writing} onClick={onWrite}>
          {writing ? "Writing…" : kit ? "Write it again" : "Write it"}
        </button>
      </div>
      {!kit ? (
        <p className="text-sm opacity-65">{writing ? "Claude is writing the caption, hashtags and titles for each platform…" : "The caption and hashtags for TikTok and Instagram, and the title and description for YouTube, each within that platform's limits. A few cents."}</p>
      ) : (
        <>
          <div role="tablist" className="flex gap-1 border-b border-[var(--line)]">
            {PLATFORM_TABS.map((p) => (
              <button key={p.id} type="button" role="tab" aria-selected={tab === p.id} onClick={() => setTab(p.id)} className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${tab === p.id ? "border-[var(--primary)] font-medium" : "border-transparent opacity-60 hover:opacity-100"}`}>
                {p.name}
              </button>
            ))}
          </div>
          {tab === "tiktok" && [field("tt", "Caption with hashtags", `${kit.tiktok.caption}\n\n${tags(kit.tiktok.hashtags)}`, POST_LIMITS.tiktokCaption)]}
          {tab === "instagram" && [field("ig", "Caption with hashtags", `${kit.instagram.caption}\n\n${tags(kit.instagram.hashtags)}`, POST_LIMITS.instagramCaption)]}
          {tab === "youtube" && [field("yt-title", "Title", kit.youtube.title, POST_LIMITS.youtubeTitle), field("yt-desc", "Description", `${kit.youtube.description}\n\n${tags(kit.youtube.hashtags)}`, POST_LIMITS.youtubeDescription)]}
          {usesAi && (
            <p className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs leading-relaxed">
              <span className="font-medium">Label it as AI-made.</span> This video has scenes made with AI, and {platform.name} asks for realistic AI content to be labelled. {platform.label} The setting's name can differ in your version of the app.
            </p>
          )}
        </>
      )}
    </section>
  );
}
