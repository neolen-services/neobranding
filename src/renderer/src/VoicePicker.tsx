import { useEffect, useRef, useState } from "react";
import type { Voice } from "@shared/audio";
import type { BrandKit, SpeakingVoice } from "@shared/brand";
import { api } from "./api";

const OWN = ["cloned", "professional", "generated"];
const isOwn = (v: Voice) => OWN.includes(v.category);
const describe = (v: Voice) => [v.labels.accent, v.labels.gender, v.labels.age, v.labels.use_case].filter(Boolean).join(" · ");

/**
 * Lets the user choose the ElevenLabs voice their brand speaks with. The
 * choice is saved in the brand kit straight away, and the agent uses it for
 * voiceovers.
 */
export function VoicePicker({
  brand,
  onChange,
  onOpenSettings,
}: {
  brand: BrandKit;
  onChange: (brand: BrandKit) => void;
  onOpenSettings: () => void;
}) {
  return (
    <VoiceChooser
      value={brand.speakingVoice}
      onOpenSettings={onOpenSettings}
      emptyText="No voice chosen yet. Pick the ElevenLabs voice your brand speaks with; the agent will use it for voiceovers."
      usedFor="used for voiceovers"
      onChoose={async (voice) => {
        const result = await api.saveBrand({ ...brand, speakingVoice: voice });
        if (!result.ok) return result.error;
        onChange(result.brand);
      }}
    />
  );
}

/**
 * Chooses one ElevenLabs voice: search, listen to samples, pick. `onChoose`
 * saves the choice and returns a message if it could not.
 */
export function VoiceChooser({
  value,
  onChoose,
  onOpenSettings,
  emptyText,
  usedFor,
}: {
  value: SpeakingVoice | null;
  onChoose: (voice: SpeakingVoice | null) => Promise<string | void>;
  onOpenSettings: () => void;
  /** Shown when no voice is chosen. */
  emptyText: string;
  /** What the voice is for, e.g. "used for voiceovers". */
  usedFor: string;
}) {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("");
  /** The voice whose sample is loading or playing. */
  const [playing, setPlaying] = useState("");
  const player = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    api.hasApiKey("elevenlabs").then(setHasKey);
    return () => player.current?.pause();
  }, []);

  async function load() {
    setChoosing(true);
    if (voices) return;
    setError("");
    const result = await api.listVoices();
    if (result.ok) setVoices(result.voices);
    else setError(result.error);
  }

  async function choose(voice: Voice | null) {
    setError("");
    setSaving(voice?.id ?? "none");
    const problem = await onChoose(voice ? { id: voice.id, name: voice.name, category: voice.category } : null);
    setSaving("");
    if (problem) return setError(problem);
    setChoosing(false);
  }

  async function preview(voiceId: string) {
    player.current?.pause();
    if (playing === voiceId) return setPlaying("");
    setError("");
    setPlaying(voiceId);
    const sample = await api.voicePreview(voiceId);
    if (!sample.ok) {
      setPlaying("");
      return setError(sample.error);
    }
    // The sample arrives as data and is played from memory, so the page never loads a remote address.
    const bytes = Uint8Array.from(atob(sample.base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: sample.mimeType }));
    const audio = new Audio(url);
    player.current = audio;
    const done = () => {
      URL.revokeObjectURL(url);
      setPlaying((current) => (current === voiceId ? "" : current));
    };
    audio.addEventListener("ended", done, { once: true });
    audio.addEventListener("pause", done, { once: true });
    audio.play().catch(done);
  }

  const chosen = value;
  const button = "rounded-full border border-[var(--line)] px-4 py-1.5 text-sm font-medium hover:border-[var(--primary)] disabled:opacity-50";

  if (hasKey === null) return null;

  if (!hasKey) {
    return (
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
        <p className="leading-relaxed opacity-75">
          Voices come from your ElevenLabs account, and one can be your own cloned voice. Add your ElevenLabs API key
          in Settings to pick one.
        </p>
        <button type="button" className={`${button} mt-4`} onClick={onOpenSettings}>
          Open settings
        </button>
      </div>
    );
  }

  const matching = (voices ?? []).filter((v) => {
    const q = search.trim().toLowerCase();
    return !q || `${v.name} ${v.description} ${describe(v)}`.toLowerCase().includes(q);
  });
  const groups: [string, Voice[]][] = [
    ["Your voices", matching.filter(isOwn)],
    ["Ready-made voices", matching.filter((v) => !isOwn(v))],
  ];

  const row = (v: Voice) => (
    <li key={v.id} className="flex items-center gap-3 px-3 py-2">
      <button
        type="button"
        aria-label={playing === v.id ? `Stop the sample of ${v.name}` : `Play a sample of ${v.name}`}
        title={playing === v.id ? "Stop" : "Play a sample"}
        onClick={() => preview(v.id)}
        // A voice without a sample keeps its place in the row, so the names stay lined up.
        disabled={!v.hasPreview}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--line)] hover:border-[var(--primary)] disabled:invisible"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          {playing === v.id ? <path d="M6 5h4v14H6zM14 5h4v14h-4z" /> : <path d="M7 4l13 8-13 8z" />}
        </svg>
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {v.name}
          {chosen?.id === v.id && <span className="ml-2 text-xs font-normal text-[var(--accent)]">current</span>}
        </p>
        <p className="truncate text-xs opacity-60">{describe(v) || v.description || v.category}</p>
      </div>
      <button type="button" className={button} disabled={saving !== "" || chosen?.id === v.id} onClick={() => choose(v)}>
        {saving === v.id ? "Saving…" : chosen?.id === v.id ? "Chosen" : "Use this voice"}
      </button>
    </li>
  );

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        {chosen ? (
          <>
            <button
              type="button"
              aria-label={playing === chosen.id ? "Stop the sample" : "Play a sample"}
              title={playing === chosen.id ? "Stop" : "Play a sample"}
              onClick={() => preview(chosen.id)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-white hover:opacity-90"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                {playing === chosen.id ? <path d="M6 5h4v14H6zM14 5h4v14h-4z" /> : <path d="M7 4l13 8-13 8z" />}
              </svg>
            </button>
            <div className="min-w-0 flex-1">
              <p className="font-display text-xl font-semibold">{chosen.name}</p>
              <p className="text-sm opacity-60">
                {OWN.includes(chosen.category) ? "Your own voice" : "A ready-made ElevenLabs voice"} · {usedFor}
              </p>
            </div>
          </>
        ) : (
          <p className="min-w-0 flex-1 leading-relaxed opacity-75">
            {emptyText}
          </p>
        )}
        <button type="button" className={button} onClick={() => (choosing ? setChoosing(false) : load())}>
          {choosing ? "Close" : chosen ? "Change voice" : "Choose a voice"}
        </button>
        {chosen && !choosing && (
          <button type="button" className="text-sm underline opacity-60 hover:opacity-100" disabled={saving !== ""} onClick={() => choose(null)}>
            Remove
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-400">
          {error}
        </p>
      )}

      {choosing && (
        <div className="mt-4 border-t border-[var(--line)] pt-4">
          {!voices && !error && <p className="text-sm opacity-60">Loading your voices…</p>}
          {voices && (
            <>
              <input
                className="w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm placeholder:opacity-50 focus:border-[var(--primary)] focus:outline-none"
                placeholder="Search by name, accent or style"
                aria-label="Search voices"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="mt-3 max-h-96 overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--bg)]">
                {groups.map(
                  ([title, list]) =>
                    list.length > 0 && (
                      <div key={title}>
                        <p className="sticky top-0 bg-[var(--bg)] px-3 py-2 font-mono text-xs uppercase tracking-widest opacity-60">
                          {title} · {list.length}
                        </p>
                        <ul className="divide-y divide-[var(--line)]">{list.map(row)}</ul>
                      </div>
                    ),
                )}
                {matching.length === 0 && <p className="p-4 text-sm opacity-60">No voices match.</p>}
              </div>
              {voices.every((v) => !isOwn(v)) && (
                <p className="mt-3 text-xs opacity-55">
                  None of these is your own voice yet. Clone your voice on elevenlabs.io and it will appear here under “Your voices”.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
