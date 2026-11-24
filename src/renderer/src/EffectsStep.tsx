// The Effects step of a video, one step with four sections, each with its own switch: captions, transitions and
// motion, sound effects, and the look. Claude suggests them all together so they fit each other; the creator plays the
// video, changes anything by hand or says what to change, and Claude changes only that until the creator approves.
import { useState, type ReactNode } from "react";
import { CAPTION_STYLES, LOOK_LABELS, LOOKS, MOTION_LABELS, MOTIONS, TRANSITION_LABELS, TRANSITIONS, type Look } from "@shared/edit";
import { effectsState, pickedClip, pickedPicture, soundNeedsMaking, type SceneEffect, type Video, type VideoEffects } from "@shared/studio";
import { api } from "./api";
import { StyleCard, Swatches } from "./EditPanels";
import { LOOK_CSS } from "./EditPreview";
import { card, fieldClass, Icon, ICONS, NextBar, primaryButton, quietButton, smallButton } from "./studioUi";

type Result = { ok: true; value: Video } | { ok: false; error: string };

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
  setError,
  setNotice,
  onChange,
  onPlay,
  onNext,
}: {
  video: Video;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
  onChange: (video: Video) => void;
  /** Plays the whole video with its effects. */
  onPlay: () => void;
  /** Opens the Export step. */
  onNext: () => void;
}) {
  const [doing, setDoing] = useState("");
  const [feedback, setFeedback] = useState("");
  const fx = video.effects;
  const state = effectsState(video);
  const toMake = fx?.sounds.on ? fx.sounds.items.filter(soundNeedsMaking).length : 0;

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

  const plan = () => run("Choosing the effects and making the sounds", () => api.effectsForVideo(video.id, ""), "Here are the effects. Play the video to see them, change anything by hand, or say what to change.");
  const send = async () => {
    const said = feedback.trim();
    if (!said) return;
    if (await run("Changing the effects", () => api.effectsForVideo(video.id, said))) setFeedback("");
  };
  const approve = (value: boolean | "none") => run(value === false ? "Taking the approval back" : "Approving", () => api.approveVideoEffects(video.id, value), value === "none" ? "No effects for this video." : value ? "Effects approved." : undefined);

  const next =
    state === "none"
      ? { title: "Choose the effects", note: "Claude suggests captions, transitions and camera moves, sound effects and a colour look that fit each other, and keeps them sparing. A few cents of Claude, plus ElevenLabs credits for the sounds.", action: "Suggest effects", act: plan }
      : state === "stale"
        ? { title: "The script changed after the effects were planned", note: "The scenes are different now, so the effects are planned again for them.", action: "Plan them again", act: plan }
        : state === "unmade"
          ? { title: `Make ${toMake === 1 ? "1 sound effect" : `${toMake} sound effects`}`, note: "Made by ElevenLabs, using your ElevenLabs credits.", action: "Make them", act: () => run("Making the sound effects", () => api.makeVideoEffects(video.id)) }
          : state === "ready"
            ? { title: "Play it, then approve or say what to change", note: "Everything here can also be changed by hand below.", action: "Approve the effects", act: () => approve(true) }
            : { title: "The effects are approved", note: "Next, watch it through and export the finished video.", action: "Go to export", act: async () => onNext() };

  // A frame from the video to show the looks on: the first scene's clip poster or storyboard.
  const frame = video.scenes.map((s) => pickedPicture(s)).find(Boolean);

  return (
    <div className="space-y-5">
      <NextBar title={doing ? `${doing}…` : next.title} note={doing ? "This can take a minute while each sound is made." : next.note} action={doing ? undefined : next.action} busy={doing !== ""} onAction={() => void next.act()}>
        {!doing && fx && (
          <button type="button" className={`${smallButton} flex items-center gap-1.5`} onClick={onPlay}>
            <Icon d={ICONS.play} className="h-3.5 w-3.5" />
            Play with the effects
          </button>
        )}
        {!doing && (state === "none" || state === "stale") && (
          <button type="button" className={smallButton} onClick={() => void approve("none")}>
            No effects
          </button>
        )}
      </NextBar>

      {fx && (
        <fieldset disabled={doing !== ""} className="space-y-5">
          {fx.summary && <p className="text-sm opacity-70">{fx.summary}</p>}

          <div className="grid gap-5 lg:grid-cols-2">
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

            <Section title="Look" note="One colour look for the whole video." on={fx.look.on} onToggle={(on) => void change({ look: { ...fx.look, on } })}>
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
          </div>

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

          {/* Scene by scene: how each comes in, how the camera moves, its own look, and its sound effects. */}
          <section className={`${card} space-y-4`}>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <p className="flex-1 font-display text-lg font-semibold">Scene by scene</p>
              <label className="flex items-center gap-2 text-sm">
                Transitions and motion
                <Switch on={fx.moves.on} onChange={(on) => void change({ moves: { ...fx.moves, on } })} name="Transitions and motion" />
              </label>
              <label className="flex items-center gap-2 text-sm">
                Sound effects
                <Switch on={fx.sounds.on} onChange={(on) => void change({ sounds: { ...fx.sounds, on } })} name="Sound effects" />
              </label>
            </div>
            <ol className="divide-y divide-[var(--line)]">
              {video.scenes.map((s, i) => {
                const move: SceneEffect = fx.moves.scenes.find((m) => m.scene === i + 1) ?? { scene: i + 1, transition: "cut", motion: "none", look: "", why: "" };
                const setMove = (changes: Partial<SceneEffect>) => {
                  const scenes = video.scenes.map((_, k) => (k === i ? { ...move, ...changes } : (fx.moves.scenes.find((m) => m.scene === k + 1) ?? { scene: k + 1, transition: "cut" as const, motion: "none" as const, look: "" as const, why: "" })));
                  void change({ moves: { ...fx.moves, scenes } });
                };
                const sounds = fx.sounds.items.filter((x) => x.scene === i + 1);
                const thumb = pickedPicture(s);
                const fixedCut = i === 0 || s.continues;
                return (
                  <li key={s.id} className="flex flex-wrap gap-4 py-3">
                    <span className="flex aspect-[9/16] w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black text-xs text-white/60">
                      {thumb ? <img src={api.studioFileUrl(thumb.file)} alt="" className="h-full w-full object-cover" style={{ filter: LOOK_CSS[(fx.look.on ? move.look || fx.look.look : move.look || "none") as Look] }} /> : pickedClip(s) ? <Icon d={ICONS.film} /> : i + 1}
                    </span>
                    <div className="min-w-0 flex-1 space-y-2">
                      <p className="text-sm">
                        <span className="font-semibold">Scene {i + 1}</span> <span className="opacity-60">· {s.seconds}s{s.place && ` · ${s.place}`}</span>
                      </p>
                      <p className="line-clamp-1 text-xs opacity-60" title={s.action}>
                        {s.action}
                      </p>
                      {fx.moves.on && (
                        <div className="flex flex-wrap gap-2 text-xs">
                          <label className="flex items-center gap-1.5">
                            <span className="opacity-60">Comes in</span>
                            <select className={`${fieldClass} !w-auto !py-1 text-xs`} value={move.transition} disabled={fixedCut} title={fixedCut ? (i === 0 ? "The opening shot" : "It carries straight on from the scene before, so it stays a cut") : undefined} onChange={(e) => setMove({ transition: e.target.value as SceneEffect["transition"] })}>
                              {TRANSITIONS.map((t) => (
                                <option key={t} value={t}>
                                  {TRANSITION_LABELS[t]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="flex items-center gap-1.5">
                            <span className="opacity-60">Camera</span>
                            <select className={`${fieldClass} !w-auto !py-1 text-xs`} value={move.motion} onChange={(e) => setMove({ motion: e.target.value as SceneEffect["motion"] })}>
                              {MOTIONS.map((m) => (
                                <option key={m} value={m}>
                                  {MOTION_LABELS[m]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="flex items-center gap-1.5">
                            <span className="opacity-60">Own look</span>
                            <select className={`${fieldClass} !w-auto !py-1 text-xs`} value={move.look} onChange={(e) => setMove({ look: e.target.value as SceneEffect["look"] })}>
                              <option value="">Same as the video</option>
                              {LOOKS.map((l) => (
                                <option key={l} value={l}>
                                  {LOOK_LABELS[l]}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      )}
                      {fx.moves.on && move.why && <p className="text-xs italic opacity-55">{move.why}</p>}
                      {fx.sounds.on && sounds.length > 0 && (
                        <ul className="flex flex-wrap gap-2">
                          {sounds.map((x) => (
                            <li key={x.id} className="flex items-center gap-2 rounded-full border border-[var(--line)] py-1 pl-3 pr-1 text-xs" title={x.prompt}>
                              <Icon d={ICONS.speaker} className="h-3.5 w-3.5 opacity-60" />
                              {x.label} <span className="opacity-55">at {x.at.toFixed(1)}s</span>
                              {x.audioFile && !soundNeedsMaking(x) ? (
                                <button type="button" aria-label={`Play ${x.label}`} className="rounded-full p-1 hover:bg-[var(--tint)]" onClick={() => void new Audio(api.audioFileUrl(x.audioFile)).play().catch(() => undefined)}>
                                  <Icon d={ICONS.play} className="h-3 w-3" />
                                </button>
                              ) : (
                                <span className="opacity-55">not made</span>
                              )}
                              <button type="button" aria-label={`Remove ${x.label}`} className="rounded-full p-1 opacity-60 hover:text-red-400 hover:opacity-100" onClick={() => void change({ sounds: { ...fx.sounds, items: fx.sounds.items.filter((y) => y.id !== x.id) } })}>
                                <Icon d={ICONS.close} className="h-3 w-3" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

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
        </fieldset>
      )}
    </div>
  );
}
