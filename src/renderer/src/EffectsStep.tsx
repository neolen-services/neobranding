// The Effects step of a video: one workspace for how the finished video looks and sounds, and its cover. The video plays
// beside the controls with every effect on it, so each change shows at once. Six sections, one at a time: captions,
// motion and transitions (scene by scene), sound effects, the colour look, the end card, and the cover. Claude suggests
// them together so they fit each other; the creator changes anything by hand or says what to change, and Claude changes
// only that, until the creator approves.
import { useMemo, useState, type ReactNode } from "react";
import { CAPTION_STYLES, LOOK_LABELS, LOOKS, MOTION_LABELS, MOTIONS, TRANSITION_LABELS, TRANSITIONS, type Look } from "@shared/edit";
import { coverState, effectsState, pickedClip, pickedPicture, soundNeedsMaking, type Character, type SceneEffect, type Video, type VideoEffects } from "@shared/studio";
import { api } from "./api";
import { CoverPanel } from "./CoverPanel";
import { StyleCard, Swatches } from "./EditPanels";
import { LOOK_CSS } from "./EditPreview";
import { Player } from "./Player";
import { card, fieldClass, Icon, ICONS, NextBar, primaryButton, quietButton } from "./studioUi";

type Result = { ok: true; value: Video } | { ok: false; error: string };
type SectionId = "captions" | "motion" | "sound" | "look" | "end" | "cover";

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "captions", label: "Captions" },
  { id: "motion", label: "Motion" },
  { id: "sound", label: "Sound" },
  { id: "look", label: "Look" },
  { id: "end", label: "End card" },
  { id: "cover", label: "Cover" },
];

const CHIPS = ["Fewer sound effects", "Calmer, fewer transitions", "More energy in the opening", "Bigger, bolder captions"];

function Switch({ on, onChange, name }: { on: boolean; onChange: (v: boolean) => void; name: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={name} onClick={() => onChange(!on)} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-[var(--primary)]" : "bg-[var(--tint)]"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${on ? "left-[1.375rem]" : "left-0.5"}`} />
    </button>
  );
}

function Section({ title, note, on, onToggle, children }: { title: string; note: string; on: boolean; onToggle: (v: boolean) => void; children: ReactNode }) {
  return (
    <section className={`${card} space-y-4`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-semibold">{title}</p>
          <p className="text-sm opacity-60">{note}</p>
        </div>
        <Switch on={on} onChange={onToggle} name={`${title}: ${on ? "on" : "off"}`} />
      </div>
      {on && children}
    </section>
  );
}

export function EffectsStep({
  video,
  cast,
  setError,
  setNotice,
  onChange,
  onNext,
}: {
  video: Video;
  cast: Character[];
  setError: (message: string) => void;
  setNotice: (message: string) => void;
  onChange: (video: Video) => void;
  /** Opens the Export step. */
  onNext: () => void;
}) {
  const [doing, setDoing] = useState("");
  const [feedback, setFeedback] = useState("");
  const [section, setSection] = useState<SectionId>("captions");
  const [sceneIndex, setSceneIndex] = useState(0);
  const [compare, setCompare] = useState(false);
  const fx = video.effects;
  const state = effectsState(video);
  const cover = coverState(video);
  const toMake = fx?.sounds.on ? fx.sounds.items.filter(soundNeedsMaking).length : 0;
  // The same video with no effects, to compare with.
  const bare = useMemo(() => ({ ...video, effects: null }), [video]);

  async function run(what: string, work: () => Promise<Result>, done?: string) {
    setDoing(what);
    setError("");
    setNotice("");
    try {
      const result = await work();
      if (result.ok) {
        onChange(result.value);
        if (done) setNotice(done);
      } else {
        setError(result.error);
        // A plan can be saved even when making a sound then fails, so the video is read again to show it.
        const fresh = (await api.listVideos().catch(() => [])).find((v) => v.id === video.id);
        if (fresh) onChange(fresh);
      }
      return result.ok;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
      return false;
    } finally {
      setDoing("");
    }
  }

  /** The creator's own change: saved straight away, and it takes any approval back. */
  async function change(changes: Partial<VideoEffects>) {
    const result = await api.changeVideoEffects(video.id, changes).catch((e) => ({ ok: false as const, error: String(e?.message ?? e) }));
    if (result.ok) onChange(result.value);
    else setError(result.error);
  }

  const plan = () => run("Choosing the effects and making the sounds", () => api.effectsForVideo(video.id, ""), "Here are the effects, playing on the video. Change anything by hand, or say what to change.");
  const send = async () => {
    const said = feedback.trim();
    if (!said) return;
    if (await run("Changing the effects", () => api.effectsForVideo(video.id, said))) setFeedback("");
  };
  const approve = (value: boolean | "none") => run(value === false ? "Taking the approval back" : "Approving", () => api.approveVideoEffects(video.id, value), value === "none" ? "No effects for this video." : value ? "Effects approved." : undefined);

  /** Approves what is ready: the effects and a cover that has been made, in one go. */
  async function approveReady() {
    setDoing("Approving");
    setError("");
    setNotice("");
    try {
      if (state === "ready") {
        const r = await api.approveVideoEffects(video.id, true);
        if (!r.ok) return setError(r.error);
        onChange(r.value);
      }
      if (cover === "made") {
        const r = await api.approveVideoCover(video.id, true);
        if (!r.ok) return setError(r.error);
        onChange(r.value);
      }
      setNotice("Approved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setDoing("");
    }
  }

  const next =
    state === "none"
      ? { title: "Choose the effects", note: "Claude suggests captions, transitions and camera moves, sound effects and a colour look that fit each other, and keeps them sparing. You see them on the video as you go. A few cents of Claude, plus ElevenLabs credits for the sounds.", action: "Suggest effects", act: plan }
      : state === "stale"
        ? { title: "The script changed after the effects were planned", note: "The scenes are different now, so the effects are planned again for them.", action: "Plan them again", act: plan }
        : state === "unmade"
          ? { title: `Make ${toMake === 1 ? "1 sound effect" : `${toMake} sound effects`}`, note: "Made by ElevenLabs, using your ElevenLabs credits.", action: "Make them", act: () => run("Making the sound effects", () => api.makeVideoEffects(video.id)) }
          : cover === "approved"
            ? state === "ready"
              ? { title: "Look right? Approve the effects", note: "The cover is approved. Everything here can also be changed by hand.", action: "Approve the effects", act: () => approveReady() }
              : { title: "The effects and the cover are approved", note: "Next, watch the whole video and export it.", action: "Go to export", act: async () => onNext() }
            : cover === "made"
              ? { title: state === "ready" ? "Approve the effects and the cover" : "Approve the cover", note: "Look at the video on the left and at the cover, then approve.", action: state === "ready" ? "Approve both" : "Approve the cover", act: () => approveReady() }
              : { title: state === "ready" ? "Happy with the effects? Now choose the cover" : "Now choose the cover", note: "The cover is the picture people see before they watch. Claude picks the best moments; or choose to post without one.", action: "Choose the cover", act: async () => setSection("cover") };

  // A frame from the video to show the looks on: the first scene's storyboard.
  const frame = video.scenes.map((s) => pickedPicture(s)).find(Boolean);

  const moveOf = (k: number): SceneEffect => fx?.moves.scenes.find((m) => m.scene === k + 1) ?? { scene: k + 1, transition: "cut", motion: "none", look: "", why: "" };
  const lookOf = (k: number) => (fx?.look.on ? moveOf(k).look || fx.look.look : moveOf(k).look || "none") as Look;
  const status = (id: SectionId) =>
    !fx ? false : id === "captions" ? fx.captions.on : id === "motion" ? fx.moves.on : id === "sound" ? fx.sounds.on : id === "look" ? fx.look.on : id === "end" ? fx.endCard.on : cover === "approved" && !video.coverPlan?.skipped;

  const index = Math.min(sceneIndex, Math.max(video.scenes.length - 1, 0));
  const scene = video.scenes[index];
  const move = moveOf(index);
  const setMove = (changes: Partial<SceneEffect>) => {
    if (!fx) return;
    const scenes = video.scenes.map((_, k) => (k === index ? { ...move, ...changes } : moveOf(k)));
    void change({ moves: { ...fx.moves, scenes } });
  };
  const fixedCut = index === 0 || Boolean(scene?.continues);

  return (
    <div className="space-y-5">
      <NextBar title={doing ? `${doing}…` : next.title} note={doing ? "This can take a minute while each sound is made." : next.note} action={doing ? undefined : next.action} busy={doing !== ""} onAction={() => void next.act()}>
        {!doing && (state === "none" || state === "stale") && (
          <button type="button" className={quietButton} onClick={() => void approve("none")}>
            No effects
          </button>
        )}
      </NextBar>

      {fx && (
        <fieldset disabled={doing !== ""} className="min-w-0">
          <div className="grid items-start gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
            {/* The video, with every effect on it. */}
            <aside className="space-y-2 lg:sticky lg:top-4">
              <Player video={compare ? bare : video} cast={cast} inline />
              <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] px-3 py-2 text-sm">
                <span>
                  Compare without effects
                  <span className="block text-xs opacity-55">{compare ? "Showing the video as it is, with none of the effects." : "Showing the video with its effects."}</span>
                </span>
                <Switch on={compare} onChange={setCompare} name="Compare without effects" />
              </label>
              {fx.summary && <p className="px-1 text-xs leading-relaxed opacity-65">{fx.summary}</p>}
            </aside>

            <div className="min-w-0 space-y-4">
              <div role="tablist" aria-label="Effects" className="flex flex-wrap gap-1.5">
                {SECTIONS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={section === s.id}
                    onClick={() => setSection(s.id)}
                    className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium ${section === s.id ? "border-[var(--primary)] bg-[var(--primary)]/15" : "border-[var(--line)] opacity-75 hover:opacity-100"}`}
                  >
                    <span className={`h-2 w-2 rounded-full ${status(s.id) ? "bg-[var(--primary)]" : "border border-current opacity-50"}`} aria-hidden />
                    {s.label}
                    <span className="sr-only">{status(s.id) ? "(on)" : "(off)"}</span>
                  </button>
                ))}
              </div>

              {section === "captions" && (
                <Section title="Captions" note="The words as they are said, a few at a time." on={fx.captions.on} onToggle={(on) => void change({ captions: { ...fx.captions, on } })}>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {CAPTION_STYLES.map((n) => (
                      <StyleCard key={n} style={{ ...fx.captions.style, name: n }} active={fx.captions.style.name === n} onPick={() => void change({ captions: { ...fx.captions, style: { ...fx.captions.style, name: n } } })} />
                    ))}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Swatches name="Text colour" value={fx.captions.style.color} onChange={(color) => void change({ captions: { ...fx.captions, style: { ...fx.captions.style, color } } })} />
                    <Swatches name={fx.captions.style.name === "boxed" ? "Band colour" : "Highlight colour"} value={fx.captions.style.accent} onChange={(accent) => void change({ captions: { ...fx.captions, style: { ...fx.captions.style, accent } } })} />
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-sm">
                    <span className="flex items-center gap-1.5">
                      <span className="opacity-60">Words at a time</span>
                      {[1, 2, 3, 4].map((n) => (
                        <button key={n} type="button" aria-pressed={fx.captions.wordsAtATime === n} onClick={() => void change({ captions: { ...fx.captions, wordsAtATime: n } })} className={`h-7 w-7 rounded-full border text-xs ${fx.captions.wordsAtATime === n ? "border-[var(--primary)] bg-[var(--primary)]/15" : "border-[var(--line)]"}`}>
                          {n}
                        </button>
                      ))}
                    </span>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={fx.captions.style.upper} onChange={(e) => void change({ captions: { ...fx.captions, style: { ...fx.captions.style, upper: e.target.checked } } })} />
                      Capitals
                    </label>
                  </div>
                </Section>
              )}

              {section === "motion" && (
                <Section title="Motion and transitions" note="How each scene comes in and how the camera moves, scene by scene." on={fx.moves.on} onToggle={(on) => void change({ moves: { ...fx.moves, on } })}>
                  <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Scenes">
                    {video.scenes.map((s, i) => {
                      const thumb = pickedPicture(s);
                      const m = moveOf(i);
                      return (
                        <button key={s.id} type="button" aria-pressed={i === index} onClick={() => setSceneIndex(i)} className={`w-16 shrink-0 space-y-1 rounded-xl border-2 p-1 text-center ${i === index ? "border-[var(--primary)]" : "border-transparent hover:border-[var(--line)]"}`}>
                          <span className="flex aspect-[9/16] items-center justify-center overflow-hidden rounded-lg bg-black text-xs text-white/60">
                            {thumb ? <img src={api.studioFileUrl(thumb.file)} alt="" className="h-full w-full object-cover" style={{ filter: LOOK_CSS[lookOf(i)] }} /> : pickedClip(s) ? <Icon d={ICONS.film} /> : i + 1}
                          </span>
                          <span className="block truncate text-[0.7rem]">
                            {i + 1} · {TRANSITION_LABELS[m.transition]}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {scene && (
                    <div className="space-y-3 rounded-xl border border-[var(--line)] p-3">
                      <div>
                        <p className="text-sm">
                          <span className="font-semibold">Scene {index + 1}</span> <span className="opacity-60">· {scene.seconds}s{scene.place && ` · ${scene.place}`}</span>
                        </p>
                        <p className="line-clamp-2 text-xs opacity-60" title={scene.action}>
                          {scene.action}
                        </p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="block text-xs">
                          <span className="mb-1 block opacity-60">Comes in</span>
                          <select className={fieldClass} value={move.transition} disabled={fixedCut} title={fixedCut ? (index === 0 ? "The opening shot" : "It carries straight on from the scene before, so it stays a cut") : undefined} onChange={(e) => setMove({ transition: e.target.value as SceneEffect["transition"] })}>
                            {TRANSITIONS.map((t) => (
                              <option key={t} value={t}>
                                {TRANSITION_LABELS[t]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block text-xs">
                          <span className="mb-1 block opacity-60">Camera</span>
                          <select className={fieldClass} value={move.motion} onChange={(e) => setMove({ motion: e.target.value as SceneEffect["motion"] })}>
                            {MOTIONS.map((m) => (
                              <option key={m} value={m}>
                                {MOTION_LABELS[m]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block text-xs">
                          <span className="mb-1 block opacity-60">Own look</span>
                          <select className={fieldClass} value={move.look} onChange={(e) => setMove({ look: e.target.value as SceneEffect["look"] })}>
                            <option value="">Same as the video</option>
                            {LOOKS.map((l) => (
                              <option key={l} value={l}>
                                {LOOK_LABELS[l]}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      {move.why && <p className="text-xs italic opacity-55">{move.why}</p>}
                    </div>
                  )}
                </Section>
              )}

              {section === "sound" && (
                <Section title="Sound effects" note="A whoosh, a pop, a riser, or the sound of the place, where it helps." on={fx.sounds.on} onToggle={(on) => void change({ sounds: { ...fx.sounds, on } })}>
                  {fx.sounds.items.length === 0 ? (
                    <p className="text-sm opacity-65">No sound effects are planned. Ask Claude below to add some.</p>
                  ) : (
                    <ul className="space-y-2">
                      {[...fx.sounds.items]
                        .sort((a, b) => a.scene - b.scene || a.at - b.at)
                        .map((x) => (
                          <li key={x.id} className="flex items-center gap-3 rounded-xl border border-[var(--line)] px-3 py-2 text-sm" title={x.prompt}>
                            <Icon d={ICONS.speaker} className="h-4 w-4 shrink-0 opacity-60" />
                            <span className="min-w-0 flex-1">
                              <span className="font-medium">{x.label}</span>
                              <span className="block text-xs opacity-55">
                                Scene {x.scene} · at {x.at.toFixed(1)}s · {x.seconds.toFixed(1)}s long
                              </span>
                            </span>
                            {x.audioFile && !soundNeedsMaking(x) ? (
                              <button type="button" aria-label={`Play ${x.label}`} className="rounded-full p-1.5 hover:bg-[var(--tint)]" onClick={() => void new Audio(api.audioFileUrl(x.audioFile)).play().catch(() => undefined)}>
                                <Icon d={ICONS.play} className="h-3.5 w-3.5" />
                              </button>
                            ) : (
                              <span className="text-xs opacity-55">not made</span>
                            )}
                            <button type="button" aria-label={`Remove ${x.label}`} className="rounded-full p-1.5 opacity-60 hover:text-red-400 hover:opacity-100" onClick={() => void change({ sounds: { ...fx.sounds, items: fx.sounds.items.filter((y) => y.id !== x.id) } })}>
                              <Icon d={ICONS.close} className="h-3.5 w-3.5" />
                            </button>
                          </li>
                        ))}
                    </ul>
                  )}
                </Section>
              )}

              {section === "look" && (
                <Section title="Look" note="One colour look for the whole video. A scene can have its own under Motion." on={fx.look.on} onToggle={(on) => void change({ look: { ...fx.look, on } })}>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-7 lg:grid-cols-4 xl:grid-cols-7">
                    {LOOKS.map((l: Look) => (
                      <button key={l} type="button" aria-pressed={fx.look.look === l} onClick={() => void change({ look: { ...fx.look, look: l } })} className={`overflow-hidden rounded-lg border text-left ${fx.look.look === l ? "border-[var(--primary)] ring-2 ring-[var(--primary)]/40" : "border-[var(--line)] hover:border-[var(--ink)]"}`}>
                        {frame ? <img src={api.studioFileUrl(frame.file)} alt="" className="aspect-square w-full object-cover" style={{ filter: LOOK_CSS[l] }} /> : <span className="block aspect-square bg-neutral-600" style={{ filter: LOOK_CSS[l] }} />}
                        <span className="block truncate px-1.5 py-1 text-[0.7rem]">{LOOK_LABELS[l]}</span>
                      </button>
                    ))}
                  </div>
                  <label className="flex items-center justify-between text-sm">
                    On-screen text pops in
                    <input type="checkbox" checked={fx.textPop} onChange={(e) => void change({ textPop: e.target.checked })} />
                  </label>
                </Section>
              )}

              {section === "end" && (
                <Section title="End card" note="A call to action over the last seconds: follow, comment, or what to watch next." on={fx.endCard.on} onToggle={(on) => void change({ endCard: { ...fx.endCard, on, text: fx.endCard.text || "Follow for more" } })}>
                  <div className="flex flex-wrap items-end gap-4">
                    <label className="min-w-0 flex-1 text-sm">
                      <span className="mb-1 block opacity-60">Words</span>
                      <input
                        className={fieldClass}
                        maxLength={120}
                        defaultValue={fx.endCard.text}
                        key={fx.endCard.text}
                        placeholder="Follow for more"
                        onBlur={(e) => e.target.value.trim() !== fx.endCard.text && void change({ endCard: { ...fx.endCard, text: e.target.value.trim() } })}
                      />
                    </label>
                    <span className="flex items-center gap-1.5 text-sm">
                      <span className="opacity-60">Seconds</span>
                      {[2, 2.5, 3, 4].map((n) => (
                        <button key={n} type="button" aria-pressed={fx.endCard.seconds === n} onClick={() => void change({ endCard: { ...fx.endCard, seconds: n } })} className={`h-7 min-w-7 rounded-full border px-2 text-xs ${fx.endCard.seconds === n ? "border-[var(--primary)] bg-[var(--primary)]/15" : "border-[var(--line)]"}`}>
                          {n}
                        </button>
                      ))}
                    </span>
                  </div>
                </Section>
              )}

              {section === "cover" && <CoverPanel video={video} setError={setError} setNotice={setNotice} onChange={onChange} />}

              {/* The conversation about the effects. The cover has its own, for its picks. */}
              {section !== "cover" && (
                <section className={`${card} space-y-3`}>
                  <p className="font-display text-lg font-semibold">What should change?</p>
                  {fx.rounds.length > 0 && (
                    <ul className="space-y-2">
                      {fx.rounds.map((r, i) => (
                        <li key={i} className="space-y-1.5 text-sm">
                          <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-[var(--primary)]/15 px-3 py-1.5">{r.feedback}</p>
                          {r.reply && <p className="max-w-[85%] rounded-2xl rounded-bl-md border border-[var(--line)] px-3 py-1.5 opacity-85">{r.reply}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {CHIPS.map((c) => (
                      <button key={c} type="button" className="rounded-full border border-[var(--line)] px-3 py-1 text-xs opacity-80 hover:opacity-100" onClick={() => setFeedback(c)}>
                        {c}
                      </button>
                    ))}
                  </div>
                  <textarea
                    className={fieldClass}
                    rows={2}
                    placeholder="For example: fewer whooshes, captions in yellow, and a flash on the reveal"
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void send();
                    }}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className={primaryButton} disabled={!feedback.trim()} onClick={() => void send()}>
                      Change the effects
                    </button>
                    {state === "approved" && (
                      <button type="button" className={quietButton} onClick={() => void approve(false)}>
                        Take the approval back
                      </button>
                    )}
                    {state !== "approved" && (
                      <button type="button" className={quietButton} onClick={() => void approve("none")}>
                        Use no effects instead
                      </button>
                    )}
                  </div>
                  <p className="text-xs opacity-55">
                    Claude changes only what you ask for, and only changed sounds are made again (ElevenLabs credits). Any change takes back an approval.
                    {fx.costUsd > 0 ? ` Planning has cost about $${fx.costUsd.toFixed(2)} of Claude so far.` : ""}
                  </p>
                </section>
              )}
            </div>
          </div>
        </fieldset>
      )}
    </div>
  );
}
