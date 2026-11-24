// The Music step of a video. Claude suggests what music plays where (and where silence is better), ElevenLabs makes
// each piece, and the creator listens and says what to change. Claude changes only that and the changed pieces are made
// again, round after round, until the creator approves the music.
import { useState } from "react";
import { cueNeedsTrack, cueSeconds, musicState, type Video } from "@shared/studio";
import { api } from "./api";
import { card, fieldClass, Icon, ICONS, NextBar, primaryButton, quietButton, smallButton } from "./studioUi";

const showTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
/** One colour per piece of music, so a piece and its band over the scenes match. */
const TONES = ["bg-violet-500/70", "bg-sky-500/70", "bg-amber-500/70", "bg-emerald-500/70", "bg-rose-500/70"];

export function MusicStep({
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
  /** Plays the whole video with its music. */
  onPlay: () => void;
  /** Opens the Effects step. */
  onNext: () => void;
}) {
  const [doing, setDoing] = useState("");
  const [feedback, setFeedback] = useState("");
  const music = video.music;
  const state = musicState(video);
  const total = video.scenes.reduce((n, s) => n + s.seconds, 0) || 1;
  const toMake = music?.cues.filter(cueNeedsTrack).length ?? 0;

  async function run(what: string, work: () => Promise<{ ok: true; value: Video } | { ok: false; error: string }>, done?: string) {
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
        // A plan can be saved even when making a track then fails, so the video is read again to show it.
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

  const plan = () => run("Choosing and making the music", () => api.musicForVideo(video.id, ""), "Here is the music. Play the video to hear it with the scenes, then approve it or say what to change.");
  const send = async () => {
    const said = feedback.trim();
    if (!said) return;
    if (await run("Changing the music", () => api.musicForVideo(video.id, said))) setFeedback("");
  };
  const approve = (value: boolean | "none") => run(value === false ? "Taking the approval back" : "Approving", () => api.approveVideoMusic(video.id, value), value === "none" ? "No music for this video." : value ? "Music approved." : undefined);

  const next =
    state === "none"
      ? { title: "Choose the music", note: "Claude reads the script and suggests what music plays where, and where silence is better. Then ElevenLabs makes each piece. A few cents of Claude, plus ElevenLabs credits for the music.", action: "Suggest music", act: plan }
      : state === "stale"
        ? { title: "The script changed after the music was planned", note: "The scenes are different now, so the music is planned again for them.", action: "Plan it again", act: plan }
        : state === "unmade"
          ? { title: `Make ${toMake === 1 ? "1 piece" : `${toMake} pieces`} of music`, note: "Made by ElevenLabs, using your ElevenLabs credits.", action: "Make it", act: () => run("Making the music", () => api.makeVideoMusic(video.id)) }
          : state === "ready"
            ? { title: "Listen, then approve or say what to change", note: "Play the whole video to hear the music with the scenes and voices.", action: "Approve the music", act: () => approve(true) }
            : { title: music?.cues.length ? "The music is approved" : "This video has no music", note: "Next, the effects: captions, transitions, sound effects and the look.", action: "Go to effects", act: async () => onNext() };

  return (
    <div className="space-y-5">
      <NextBar title={doing ? `${doing}…` : next.title} note={doing ? "This can take a minute or two while each piece is made." : next.note} action={doing ? undefined : next.action} busy={doing !== ""} onAction={() => void next.act()}>
        {!doing && music && music.cues.length > 0 && (
          <button type="button" className={`${smallButton} flex items-center gap-1.5`} onClick={onPlay}>
            <Icon d={ICONS.play} className="h-3.5 w-3.5" />
            Play with the music
          </button>
        )}
        {!doing && (state === "none" || state === "stale") && (
          <button type="button" className={smallButton} onClick={() => void approve("none")}>
            No music
          </button>
        )}
      </NextBar>

      {music && (
        <>
          {/* Where each piece plays over the scenes. */}
          <section className={`${card} space-y-3`}>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <p className="font-display text-lg font-semibold">{music.cues.length ? "Where the music plays" : "No music"}</p>
              {music.summary && <p className="text-sm opacity-65">{music.summary}</p>}
            </div>
            <div className="space-y-1">
              <div className="relative h-7">
                {music.cues.map((c, i) => {
                  const start = video.scenes.slice(0, c.fromScene - 1).reduce((n, s) => n + s.seconds, 0);
                  return (
                    <span key={c.id} title={c.label} className={`absolute inset-y-0 flex items-center overflow-hidden rounded-md px-2 text-xs font-medium text-white ${TONES[i % TONES.length]}`} style={{ left: `${(start / total) * 100}%`, width: `calc(${(cueSeconds(video, c) / total) * 100}% - 2px)` }}>
                      <span className="truncate">{c.label}</span>
                    </span>
                  );
                })}
              </div>
              <div className="flex gap-0.5">
                {video.scenes.map((s, i) => {
                  const covered = music.cues.some((c) => i + 1 >= c.fromScene && i + 1 <= c.toScene);
                  return (
                    <span key={s.id} title={s.action} className={`flex h-8 items-center justify-center overflow-hidden rounded-md text-xs ${covered ? "bg-[var(--tint)]" : "border border-dashed border-[var(--line)] opacity-60"}`} style={{ flex: `${s.seconds} 0 0` }}>
                      {i + 1}
                      {!covered && <span className="ml-1 hidden sm:inline">· silence</span>}
                    </span>
                  );
                })}
              </div>
              <p className="text-xs opacity-55">Scenes, by length. {showTime(total)} in all.</p>
            </div>
          </section>

          {music.cues.length > 0 && (
            <ul className="grid gap-4 md:grid-cols-2">
              {music.cues.map((c, i) => {
                const start = video.scenes.slice(0, c.fromScene - 1).reduce((n, s) => n + s.seconds, 0);
                const remake = c.audioFile && c.madeFrom !== c.prompt;
                return (
                  <li key={c.id} className={`${card} space-y-3 !p-4`}>
                    <div className="flex items-start gap-3">
                      <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${TONES[i % TONES.length]}`} />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{c.label}</p>
                        <p className="text-xs opacity-60">
                          {c.fromScene === c.toScene ? `Scene ${c.fromScene}` : `Scenes ${c.fromScene} to ${c.toScene}`} · {showTime(start)} to {showTime(start + cueSeconds(video, c))} · volume {Math.round(c.volume * 100)}%
                        </p>
                      </div>
                    </div>
                    {c.why && <p className="text-sm leading-relaxed opacity-80">{c.why}</p>}
                    {c.audioFile && !remake ? (
                      <audio controls preload="none" src={api.audioFileUrl(c.audioFile)} className="w-full" />
                    ) : (
                      <p className="rounded-lg bg-[var(--tint)] px-3 py-2 text-xs opacity-70">{doing ? "Being made…" : remake ? "Changed: made again when you press Make it." : "Not made yet."}</p>
                    )}
                    <details className="text-xs">
                      <summary className="cursor-pointer opacity-60 hover:opacity-100">What the music service was asked for</summary>
                      <p className="mt-1.5 leading-relaxed opacity-75">{c.prompt}</p>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}

          {/* The conversation about the music: what the creator asked for and what changed. */}
          <section className={`${card} space-y-3`}>
            <p className="font-display text-lg font-semibold">What should change?</p>
            {music.rounds.length > 0 && (
              <ul className="space-y-2">
                {music.rounds.map((r, i) => (
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
              placeholder="For example: calmer under the opening, more energy from scene 3, and no music on the last scene"
              value={feedback}
              disabled={doing !== ""}
              onChange={(e) => setFeedback(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void send();
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={primaryButton} disabled={doing !== "" || !feedback.trim()} onClick={() => void send()}>
                Change the music
              </button>
              {state === "approved" && music.cues.length > 0 && (
                <button type="button" className={quietButton} disabled={doing !== ""} onClick={() => void approve(false)}>
                  Take the approval back
                </button>
              )}
              {music.cues.length > 0 && state !== "approved" && (
                <button type="button" className={quietButton} disabled={doing !== ""} onClick={() => void approve("none")}>
                  Use no music instead
                </button>
              )}
              {music.cues.length === 0 && (
                <button type="button" className={quietButton} disabled={doing !== ""} onClick={() => void plan()}>
                  Suggest music after all
                </button>
              )}
            </div>
            <p className="text-xs opacity-55">
              Claude changes only what you ask for, and only the changed pieces are made again (ElevenLabs credits). Changing it takes back an approval. Music is kept low wherever someone speaks.
              {music.costUsd > 0 ? ` Planning has cost about $${music.costUsd.toFixed(2)} of Claude so far.` : ""}
            </p>
          </section>
        </>
      )}
    </div>
  );
}
