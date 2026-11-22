import { useEffect, useState, type FormEvent } from "react";
import type { BrandKit } from "@shared/brand";
import type { Character } from "@shared/studio";
import { api } from "./api";
import { VoiceChooser } from "./VoicePicker";
import { readUpload, ServicePicker, useMediaChoices, useMediaKeys } from "./ServicePicker";
import type { StudioResult } from "@shared/studio";

const fieldClass =
  "w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm placeholder:opacity-50 focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]";
const primaryButton = "rounded-full bg-[var(--primary)] px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50";
const quietButton = "rounded-full border border-[var(--line)] px-4 py-2 text-sm font-medium hover:border-[var(--ink)] disabled:opacity-50";

type Draft = Pick<Character, "name" | "role" | "personality" | "speech" | "look">;
const EMPTY: Draft = { name: "", role: "", personality: "", speech: "", look: "" };

const FIELDS: { key: keyof Draft; label: string; placeholder: string; long?: boolean }[] = [
  { key: "name", label: "Name", placeholder: "What the character is called" },
  { key: "role", label: "Role in the story", placeholder: "For example: the sceptical friend" },
  { key: "personality", label: "Personality", placeholder: "Two or three traits, and what they want", long: true },
  { key: "speech", label: "How they talk", placeholder: "Short sentences? Slang? A catchphrase?", long: true },
  { key: "look", label: "Look", placeholder: "Age, build, hair, and one fixed colour or item of clothing", long: true },
];

/**
 * The cast: characters made once and reused in any video or series. Each has
 * a personality, a way of talking, a look and an ElevenLabs voice.
 */
export function CastView({ brand, onOpenSettings, onOpenBrand }: { brand: BrandKit; onOpenSettings: () => void; onOpenBrand: () => void }) {
  const [cast, setCast] = useState<Character[] | null>(null);
  /** The character being edited: an id, "new", or "" for none. */
  const [editing, setEditing] = useState("");
  const [error, setError] = useState("");
  const keys = useMediaKeys();
  const [choices, setChoice] = useMediaChoices();
  /** The character a picture is being made or added for. */
  const [picturing, setPicturing] = useState("");

  useEffect(() => {
    api.listCast().then(setCast);
  }, []);

  /** Runs one change to a character's reference pictures and shows the result. */
  async function pictures(character: Character, work: () => Promise<StudioResult<Character>>) {
    setPicturing(character.id);
    setError("");
    try {
      const result = await work();
      if (result.ok) setCast((list) => (list ?? []).map((c) => (c.id === result.value.id ? result.value : c)));
      else setError(`${character.name}: ${result.error}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setPicturing("");
    }
  }

  if (!cast) return null;

  const put = (saved: Character) => setCast((list) => [saved, ...(list ?? []).filter((c) => c.id !== saved.id)]);

  async function save(character: Partial<Character>): Promise<string | void> {
    const result = await api.saveCharacter(character);
    if (!result.ok) return result.error;
    put(result.value);
  }

  async function remove(character: Character) {
    setError("");
    try {
      await api.deleteCharacter(character.id);
      setCast((list) => (list ?? []).filter((c) => c.id !== character.id));
    } catch {
      setError("The character could not be deleted.");
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm leading-relaxed opacity-70">
          Characters are made once and used in any video or series. Each one keeps its personality, way of talking,
          look and voice, so it stays the same from scene to scene.
        </p>
        {editing !== "new" && (
          <button type="button" className={primaryButton} onClick={() => setEditing("new")}>
            New character
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-red-400">
          {error}
        </p>
      )}

      {editing === "new" && (
        <CharacterForm
          title="New character"
          initial={EMPTY}
          onCancel={() => setEditing("")}
          onSave={async (draft) => {
            const problem = await save(draft);
            if (!problem) setEditing("");
            return problem;
          }}
        />
      )}

      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
        <h2 className="font-display text-lg font-semibold">Always in the cast</h2>
        <ul className="mt-3 space-y-3 text-sm">
          <li>
            <span className="font-medium">You.</span> <span className="opacity-70">The host. Your scenes are filmed, and you say your lines on camera.</span>
          </li>
          <li>
            <span className="font-medium">Narrator.</span>{" "}
            <span className="opacity-70">
              A voice over a scene, spoken in your brand's speaking voice
              {brand.speakingVoice ? ` (${brand.speakingVoice.name}).` : ". None is chosen yet."}
            </span>{" "}
            <button type="button" className="underline opacity-70 hover:opacity-100" onClick={onOpenBrand}>
              {brand.speakingVoice ? "Change it in the brand kit" : "Choose one in the brand kit"}
            </button>
          </li>
        </ul>
      </section>

      {cast.length === 0 && editing !== "new" && (
        <p className="text-sm opacity-60">
          No characters yet. Add one here, or let a script or a series plan propose the characters it needs; they appear
          here ready for you to give them a voice.
        </p>
      )}

      {cast.map((character) =>
        editing === character.id ? (
          <CharacterForm
            key={character.id}
            title={`Edit ${character.name}`}
            initial={character}
            onCancel={() => setEditing("")}
            onSave={async (draft) => {
              const problem = await save({ ...character, ...draft });
              if (!problem) setEditing("");
              return problem;
            }}
          />
        ) : (
          <section key={character.id} className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-display text-lg font-semibold">{character.name}</h2>
                {character.role && <p className="text-sm opacity-60">{character.role}</p>}
              </div>
              <div className="flex gap-2">
                <button type="button" className={quietButton} onClick={() => setEditing(character.id)}>
                  Edit
                </button>
                <DeleteButton name={character.name} onConfirm={() => remove(character)} />
              </div>
            </div>
            <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              {(["personality", "speech", "look"] as const).map((key) => (
                <div key={key}>
                  <dt className="text-xs font-medium uppercase tracking-wide opacity-55">{FIELDS.find((f) => f.key === key)!.label}</dt>
                  <dd className="mt-1 whitespace-pre-wrap leading-relaxed">{character[key] || <span className="opacity-50">Not written yet</span>}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 rounded-2xl border border-[var(--line)] p-4">
              <h3 className="text-sm font-semibold">Reference pictures</h3>
              <p className="mt-1 text-sm opacity-60">
                Every scene with {character.name} is made from the first picture here, so they look the same each time.
              </p>
              {character.pictures.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-3">
                  {character.pictures.map((picture, i) => (
                    <li key={picture.id} className="w-24 text-xs">
                      <a href={api.studioFileUrl(picture.file)} target="_blank" rel="noreferrer">
                        <img src={api.studioFileUrl(picture.file)} alt={`${character.name}, reference ${i + 1}`} className="aspect-[9/16] w-full rounded-lg border border-[var(--line)] object-cover" />
                      </a>
                      <p className="mt-1">
                        {i === 0 ? (
                          <span className="font-medium text-emerald-400">Main</span>
                        ) : (
                          <button type="button" className="underline opacity-70 hover:opacity-100" disabled={picturing !== ""} onClick={() => pictures(character, () => api.changeCharacterPicture(character.id, picture.id, "first"))}>
                            Make main
                          </button>
                        )}
                        <button type="button" className="ml-2 opacity-60 hover:text-red-400 hover:opacity-100" disabled={picturing !== ""} onClick={() => pictures(character, () => api.changeCharacterPicture(character.id, picture.id, "remove"))}>
                          Remove
                        </button>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button type="button" className={quietButton} disabled={picturing !== "" || !choices} onClick={() => choices && pictures(character, () => api.makeCharacterPicture(character.id, choices.picture))}>
                  {picturing === character.id ? "Working…" : character.pictures.length ? "Make another" : "Make a reference picture"}
                </button>
                <label className={`${quietButton} cursor-pointer`}>
                  Add your own picture
                  <input
                    type="file"
                    hidden
                    accept="image/png,image/jpeg,image/webp"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) await pictures(character, async () => api.addCharacterPicture(character.id, await readUpload(file)));
                    }}
                  />
                </label>
                {choices && <ServicePicker task="picture" label="Made with" value={choices.picture} keys={keys} onChange={(c) => setChoice("picture", c)} />}
              </div>
            </div>
            <div className="mt-4">
              <VoiceChooser
                value={character.voice}
                onOpenSettings={onOpenSettings}
                emptyText={`No voice yet. ${character.name}'s lines cannot be spoken until you choose one.`}
                usedFor={`speaks ${character.name}'s lines`}
                onChoose={(voice) => save({ ...character, voice })}
              />
            </div>
          </section>
        ),
      )}
    </div>
  );
}

function CharacterForm({
  title,
  initial,
  onSave,
  onCancel,
}: {
  title: string;
  initial: Draft;
  onSave: (draft: Draft) => Promise<string | void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>({ name: initial.name, role: initial.role, personality: initial.personality, speech: initial.speech, look: initial.look });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft.name.trim()) return setError("Give the character a name.");
    setBusy(true);
    setError("");
    const problem = await onSave(draft);
    setBusy(false);
    if (problem) setError(problem);
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-[var(--primary)] bg-[var(--surface)] p-5 shadow-sm">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <label key={field.key} className={`block text-sm ${field.long ? "sm:col-span-2" : ""}`}>
            <span className="font-medium">{field.label}</span>
            {field.long ? (
              <textarea
                rows={2}
                className={`${fieldClass} mt-1`}
                placeholder={field.placeholder}
                value={draft[field.key]}
                onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value })}
              />
            ) : (
              <input
                className={`${fieldClass} mt-1`}
                placeholder={field.placeholder}
                value={draft[field.key]}
                autoFocus={field.key === "name"}
                onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value })}
              />
            )}
          </label>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-400">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-3">
        <button type="submit" className={primaryButton} disabled={busy}>
          {busy ? "Saving…" : "Save character"}
        </button>
        <button type="button" className={quietButton} disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="mt-3 text-xs opacity-55">You choose the voice after saving.</p>
    </form>
  );
}

/** Asks once more before deleting, in place. */
export function DeleteButton({ name, onConfirm }: { name: string; onConfirm: () => void | Promise<void> }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className={`${quietButton} hover:border-red-400 hover:text-red-400`} onClick={() => setAsking(true)}>
        Delete
      </button>
    );
  }
  return (
    <span className="flex items-center gap-2 text-sm">
      <span className="opacity-70">Delete {name}?</span>
      <button type="button" className="rounded-full bg-red-500 px-3 py-1.5 font-semibold text-white hover:opacity-90" onClick={() => void onConfirm()}>
        Delete
      </button>
      <button type="button" className={quietButton} autoFocus onClick={() => setAsking(false)}>
        Keep
      </button>
    </span>
  );
}
