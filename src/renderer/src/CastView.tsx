// Your characters: made once and reused in any video or series. (A video's cast is the characters its script uses.)
// The page is a wall of portraits; each character opens to its own page, where everything about it is changed.
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { BrandKit } from "@shared/brand";
import type { Character, Series, StudioResult, Video } from "@shared/studio";
import { api } from "./api";
import { readUpload, ServicePicker, useMediaChoices, useMediaKeys } from "./ServicePicker";
import { card, Chip, Dialog, fieldClass, Icon, ICONS, label, primaryButton, quietButton, smallButton } from "./studioUi";
import { VoiceChooser } from "./VoicePicker";

type TextField = "name" | "role" | "personality" | "speech" | "look";

/** What a character still needs before it can appear and speak in a scene. */
function missing(character: Character): string[] {
  return [!character.look.trim() && "a look", character.pictures.length === 0 && "a reference picture", !character.voice && "a voice"].filter((x): x is string => Boolean(x));
}

/** The videos and series a character is in. */
function appearances(character: Character, videos: Video[], series: Series[]) {
  return {
    videos: videos.filter((v) => v.scenes.some((s) => s.characters.includes(character.id) || s.lines.some((l) => l.speaker === character.id))),
    series: series.filter((s) => s.characterIds.includes(character.id)),
  };
}

export function CastView({ brand, onOpenSettings, onOpenBrand }: { brand: BrandKit; onOpenSettings: () => void; onOpenBrand: () => void }) {
  const [cast, setCast] = useState<Character[] | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [series, setSeries] = useState<Series[]>([]);
  /** The character whose page is open, or "". */
  const [openId, setOpenId] = useState("");
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [needsWork, setNeedsWork] = useState(false);

  useEffect(() => {
    api.listCast().then(setCast);
    api.listVideos().then(setVideos).catch(() => setVideos([]));
    api.listSeries().then(setSeries).catch(() => setSeries([]));
  }, []);

  if (!cast) return null;

  const put = (saved: Character) => setCast((list) => (list ?? []).some((c) => c.id === saved.id) ? (list ?? []).map((c) => (c.id === saved.id ? saved : c)) : [saved, ...(list ?? [])]);
  const open = cast.find((c) => c.id === openId);

  if (open) {
    return (
      <CharacterPage
        key={open.id}
        character={open}
        used={appearances(open, videos, series)}
        onBack={() => setOpenId("")}
        onChange={put}
        onDelete={async () => {
          await api.deleteCharacter(open.id);
          setCast((list) => (list ?? []).filter((c) => c.id !== open.id));
          setOpenId("");
        }}
        onOpenSettings={onOpenSettings}
      />
    );
  }

  const q = query.trim().toLowerCase();
  const shown = cast.filter((c) => (!q || [c.name, c.role, c.personality].some((t) => t.toLowerCase().includes(q))) && (!needsWork || missing(c).length > 0));
  const unfinished = cast.filter((c) => missing(c).length > 0).length;

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {cast.length > 6 && (
            <div className="relative w-64">
              <Icon d={ICONS.search} className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
              <input className={`${fieldClass} pl-9`} type="search" placeholder="Search your characters" aria-label="Search your characters" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          )}
          <p className="text-sm opacity-70">
            {cast.length} {cast.length === 1 ? "character" : "characters"}
            {unfinished > 0 && ` · ${unfinished} not ready for scenes yet`}
          </p>
          {unfinished > 0 && (
            <button
              type="button"
              aria-pressed={needsWork}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${needsWork ? "border-[var(--primary)] bg-[var(--tint)]" : "border-[var(--line)] opacity-80 hover:border-[var(--ink)]"}`}
              onClick={() => setNeedsWork(!needsWork)}
            >
              Only those not ready
            </button>
          )}
        </div>
        <button type="button" className={`${primaryButton} flex items-center gap-2`} onClick={() => setCreating(true)}>
          <Icon d={ICONS.plus} />
          New character
        </button>
      </div>

      {cast.length === 0 ? (
        <div className={`${card} flex flex-col items-center px-6 py-14 text-center`}>
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--tint)]">
            <Icon d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20a8 8 0 0 1 16 0" className="h-6 w-6" />
          </span>
          <h2 className="mt-4 font-display text-xl font-semibold">No characters yet</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed opacity-65">
            A character keeps its personality, way of talking, look and voice, so it stays the same from scene to scene. Add one here, or let a script or a season plan propose the ones it
            needs.
          </p>
          <button type="button" className={`${primaryButton} mt-5`} onClick={() => setCreating(true)}>
            New character
          </button>
        </div>
      ) : shown.length === 0 ? (
        <p className={`${card} text-center text-sm opacity-70`}>No character matches that.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {shown.map((character) => {
            const needs = missing(character);
            const used = appearances(character, videos, series);
            const count = used.videos.length + used.series.length;
            return (
              <li key={character.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(character.id)}
                  className="group flex h-full w-full flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] text-left shadow-sm hover:border-[var(--primary)]"
                >
                  <Portrait character={character} className="aspect-[4/5] w-full" />
                  <span className="flex flex-1 flex-col p-4">
                    <span className="font-display text-lg font-semibold leading-snug">{character.name}</span>
                    <span className="mt-0.5 line-clamp-2 text-sm opacity-60">{character.role || "No role written yet"}</span>
                    <span className="mt-auto flex flex-wrap gap-1.5 pt-3">
                      {needs.length === 0 ? <Chip tone="good">Ready for scenes</Chip> : needs.map((n) => <Chip key={n} tone="warn">{`Needs ${n}`}</Chip>)}
                      {count > 0 && <Chip>{`In ${count} ${count === 1 ? "place" : "places"}`}</Chip>}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Two voices are in every video without being characters. */}
      <section className={`${card} grid gap-4 text-sm sm:grid-cols-2`}>
        <div>
          <p className={label}>Always available</p>
          <p className="mt-2">
            <span className="font-medium">You, the host.</span> <span className="opacity-70">Your scenes are filmed, and you say your lines on camera.</span>
          </p>
        </div>
        <div className="sm:pt-6">
          <p>
            <span className="font-medium">Narrator.</span>{" "}
            <span className="opacity-70">A voice over a scene, in your brand's speaking voice{brand.speakingVoice ? ` (${brand.speakingVoice.name}).` : ". None is chosen yet."}</span>{" "}
            <button type="button" className="underline opacity-70 hover:opacity-100" onClick={onOpenBrand}>
              {brand.speakingVoice ? "Change it in the brand kit" : "Choose one in the brand kit"}
            </button>
          </p>
        </div>
      </section>

      {creating && (
        <NewCharacter
          onClose={() => setCreating(false)}
          onMade={(character) => {
            put(character);
            setCreating(false);
            setOpenId(character.id);
          }}
        />
      )}
    </div>
  );
}

/** A character's main reference picture, or its initial on a plain panel until it has one. */
function Portrait({ character, className }: { character: Character; className: string }) {
  const main = character.pictures[0];
  return main ? (
    <img src={api.studioFileUrl(main.file)} alt={`${character.name}'s reference picture`} className={`${className} bg-black object-cover object-top`} />
  ) : (
    <span aria-hidden className={`${className} flex items-center justify-center bg-[var(--tint)] font-display text-5xl font-semibold opacity-60`}>
      {character.name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** Starting a character takes a name; the rest is filled in on its own page. */
function NewCharacter({ onClose, onMade }: { onClose: () => void; onMade: (character: Character) => void }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Give the character a name.");
    setBusy(true);
    setError("");
    try {
      const result = await api.saveCharacter({ name: name.trim(), role: role.trim(), personality: "", speech: "", look: "" });
      if (result.ok) onMade(result.value);
      else setError(result.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The character could not be made.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Dialog
        title="New character"
        onClose={onClose}
        locked={busy}
        footer={
          <>
            <p role={error ? "alert" : undefined} className={`mr-auto min-w-0 flex-1 text-sm ${error ? "font-medium text-red-400" : "opacity-60"}`}>
              {error || "Next, on the character's page: personality, look, a reference picture and a voice."}
            </p>
            <button type="button" className={quietButton} disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={primaryButton} disabled={busy}>
              {busy ? "Making…" : "Make character"}
            </button>
          </>
        }
      >
        <label className="block text-sm">
          <span className="font-medium">Name</span>
          <input className={`${fieldClass} mt-1.5`} placeholder="What the character is called" autoFocus value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="font-medium">Role in the story</span> <span className="opacity-50">optional</span>
          <input className={`${fieldClass} mt-1.5`} placeholder="For example: the sceptical friend" value={role} disabled={busy} onChange={(e) => setRole(e.target.value)} />
        </label>
      </Dialog>
    </form>
  );
}

/** One character's own page: who they are, how they look, how they sound, and where they appear. Changes are saved as each box is left. */
function CharacterPage({
  character,
  used,
  onBack,
  onChange,
  onDelete,
  onOpenSettings,
}: {
  character: Character;
  used: { videos: Video[]; series: Series[] };
  onBack: () => void;
  onChange: (character: Character) => void;
  onDelete: () => Promise<void>;
  onOpenSettings: () => void;
}) {
  const [draft, setDraft] = useState<Record<TextField, string>>({ name: character.name, role: character.role, personality: character.personality, speech: character.speech, look: character.look });
  /** The box just saved, to show a tick beside it. */
  const [saved, setSaved] = useState<TextField | "">("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState("");
  const keys = useMediaKeys();
  const [choices, setChoice] = useMediaChoices();

  async function saveField(field: TextField) {
    const value = draft[field].trim();
    if (value === character[field]) return;
    // A character always has a name.
    if (field === "name" && !value) return setDraft({ ...draft, name: character.name });
    setError("");
    const result = await api.saveCharacter({ ...character, [field]: value });
    if (!result.ok) return setError(result.error);
    onChange(result.value);
    setSaved(field);
    setTimeout(() => setSaved((now) => (now === field ? "" : now)), 1800);
  }

  /** Runs one change to the reference pictures and shows the result. */
  async function pictures(what: string, work: () => Promise<StudioResult<Character>>) {
    setWorking(what);
    setError("");
    try {
      const result = await work();
      if (result.ok) onChange(result.value);
      else setError(result.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setWorking("");
    }
  }

  const needs = missing(character);
  const busy = working !== "";
  const field = (key: TextField, name: string, placeholder: string, rows = 0, help?: string) => (
    <label className="block text-sm">
      <span className="flex items-center gap-2 font-medium">
        {name}
        {saved === key && (
          <span className="flex items-center gap-1 text-xs font-normal text-emerald-400">
            <Icon d={ICONS.check} className="h-3 w-3" />
            Saved
          </span>
        )}
      </span>
      {rows ? (
        <textarea className={`${fieldClass} mt-1.5`} rows={rows} placeholder={placeholder} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} onBlur={() => void saveField(key)} />
      ) : (
        <input className={`${fieldClass} mt-1.5`} placeholder={placeholder} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} onBlur={() => void saveField(key)} />
      )}
      {help && <span className="mt-1 block text-xs opacity-55">{help}</span>}
    </label>
  );
  const section = (title: string, children: ReactNode) => (
    <section className={`${card} space-y-4`}>
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      {children}
    </section>
  );

  return (
    <div>
      <div className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--bg)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-6 py-4">
          <button type="button" aria-label="Back to your characters" title="All characters" className="rounded-full border border-[var(--line)] p-2 hover:border-[var(--ink)]" onClick={onBack}>
            <Icon d={ICONS.back} />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-xl font-semibold">{character.name}</h2>
            <p className="truncate text-sm opacity-60">{character.role || "Character"}</p>
          </div>
          <span className="flex flex-wrap gap-1.5">{needs.length === 0 ? <Chip tone="good">Ready for scenes</Chip> : needs.map((n) => <Chip key={n} tone="warn">{`Needs ${n}`}</Chip>)}</span>
          <DeleteButton name={character.name} onConfirm={onDelete} />
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

        <div className="grid gap-5 lg:grid-cols-[19rem_minmax(0,1fr)]">
          {/* How they look: the picture every scene starts from. */}
          <aside className="space-y-4 lg:sticky lg:top-28 lg:self-start">
            <section className={`${card} !p-4`}>
              <Portrait character={character} className="aspect-[9/16] w-full rounded-xl" />
              <p className="mt-3 text-xs leading-relaxed opacity-60">
                {character.pictures.length > 0
                  ? `Every scene with ${character.name} starts from this picture, so they look the same each time.`
                  : `No reference picture yet. Without one, ${character.name} can look different in every scene.`}
              </p>

              {character.pictures.length > 1 && (
                <div className="mt-3">
                  <p className="mb-1.5 text-xs opacity-55">All pictures · click one to make it the main one</p>
                  <ul className="flex flex-wrap gap-2">
                    {character.pictures.map((picture, i) => (
                      <li key={picture.id} className="group relative">
                        <button
                          type="button"
                          aria-pressed={i === 0}
                          aria-label={`Reference picture ${i + 1}${i === 0 ? " (the main one)" : ""}`}
                          title={i === 0 ? "The main picture" : "Make this the main picture"}
                          disabled={busy}
                          onClick={() => i !== 0 && pictures("Choosing", () => api.changeCharacterPicture(character.id, picture.id, "first"))}
                          className={`block aspect-[9/16] w-12 overflow-hidden rounded-md border-2 bg-black ${i === 0 ? "border-[var(--primary)]" : "border-transparent opacity-60 hover:opacity-100"}`}
                        >
                          <img src={api.studioFileUrl(picture.file)} alt="" className="h-full w-full object-cover" />
                        </button>
                        <span className="absolute -right-1.5 -top-1.5 hidden gap-0.5 group-focus-within:flex group-hover:flex">
                          <a
                            href={api.studioFileUrl(picture.file)}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Open reference picture ${i + 1}`}
                            title="Open full size"
                            className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface)] hover:border-[var(--ink)]"
                          >
                            <Icon d={ICONS.open} className="h-3 w-3" />
                          </a>
                          <button
                            type="button"
                            aria-label={`Remove reference picture ${i + 1}`}
                            title="Remove"
                            disabled={busy}
                            onClick={() => pictures("Removing", () => api.changeCharacterPicture(character.id, picture.id, "remove"))}
                            className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface)] hover:border-red-400 hover:text-red-400"
                          >
                            <Icon d={ICONS.close} className="h-3 w-3" />
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-4 space-y-2">
                <div className="rounded-xl border border-[var(--line)] p-2">
                  <p className="text-xs font-medium uppercase tracking-wide opacity-55">Character sheet</p>
                  {character.sheet ? (
                    <img src={api.studioFileUrl(character.sheet.file)} alt={`${character.name} from the front, from the back, and their face`} className="mt-1.5 aspect-video w-full rounded-lg bg-black object-cover" />
                  ) : (
                    <p className="mt-1 text-xs leading-snug opacity-60">Front, back and face in one picture. Storyboards and clips use it to keep {character.name} looking the same.</p>
                  )}
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      className={`${smallButton} flex-1`}
                      disabled={busy || !choices}
                      title={character.pictures.length || character.look.trim() ? "Drawn from their main picture, so it is the same person." : "Add a picture or write their look first."}
                      onClick={() => pictures("Sheet", () => api.makeCharacterSheet(character.id, choices?.picture))}
                    >
                      {working === "Sheet" ? "Making the sheet…" : character.sheet ? "Make it again" : "Make character sheet"}
                    </button>
                    {character.sheet && (
                      <button type="button" className={smallButton} disabled={busy} onClick={() => pictures("Removing", () => api.removeCharacterSheet(character.id))}>
                        Remove
                      </button>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className={`${character.pictures.length ? quietButton : primaryButton} w-full`}
                  disabled={busy || !choices}
                  title={character.look.trim() ? undefined : "Write their look first: the picture is made from it."}
                  onClick={() => choices && pictures("Making", () => api.makeCharacterPicture(character.id, choices.picture))}
                >
                  {working === "Making" ? "Making the picture…" : character.pictures.length ? "Make another picture" : "Make a reference picture"}
                </button>
                <div className="flex gap-2">
                  <label className={`${smallButton} flex-1 cursor-pointer text-center ${busy ? "pointer-events-none opacity-40" : ""}`}>
                    {working === "Adding" ? "Adding…" : "Add your own picture"}
                    <input
                      type="file"
                      hidden
                      accept="image/png,image/jpeg,image/webp"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) await pictures("Adding", async () => api.addCharacterPicture(character.id, await readUpload(file)));
                      }}
                    />
                  </label>
                  {character.pictures.length === 1 && (
                    <button type="button" className={smallButton} disabled={busy} onClick={() => pictures("Removing", () => api.changeCharacterPicture(character.id, character.pictures[0].id, "remove"))}>
                      Remove
                    </button>
                  )}
                </div>
                {choices && (
                  <div className="pt-1">
                    <ServicePicker task="picture" label="Pictures made with" value={choices.picture} keys={keys} onChange={(c) => setChoice("picture", c)} stacked />
                  </div>
                )}
              </div>
            </section>
          </aside>

          <div className="min-w-0 space-y-5">
            {section(
              "Who they are",
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  {field("name", "Name", "What the character is called")}
                  {field("role", "Role in the story", "For example: the sceptical friend")}
                </div>
                {field("personality", "Personality", "Two or three traits, and what they want", 3, "Scripts write this character's lines and actions to fit it.")}
                {field("speech", "How they talk", "Short sentences? Slang? A catchphrase?", 2)}
              </>,
            )}

            {section("How they look", field("look", "Look", "Age, build, hair, and one fixed colour or item of clothing", 3, "Their reference picture is made from this. One fixed colour or item of clothing helps them stay recognisable."))}

            {section(
              "How they sound",
              <VoiceChooser
                value={character.voice}
                onOpenSettings={onOpenSettings}
                emptyText={`No voice yet. ${character.name}'s lines cannot be spoken until you choose one.`}
                usedFor={`speaks ${character.name}'s lines`}
                onChoose={async (voice) => {
                  const result = await api.saveCharacter({ ...character, voice });
                  if (result.ok) onChange(result.value);
                  else setError(result.error);
                }}
              />,
            )}

            {section(
              "Where they appear",
              used.videos.length + used.series.length === 0 ? (
                <p className="text-sm opacity-60">Nowhere yet. A script uses {character.name} when the story needs them, and a series can keep them in its cast. To use them in a video, pick them on that video's Cast tab.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {used.series.map((s) => (
                    <li key={s.id} className="flex items-center gap-2.5">
                      <Chip>Series</Chip>
                      <span className="min-w-0 truncate">{s.title}</span>
                    </li>
                  ))}
                  {used.videos.map((v) => (
                    <li key={v.id} className="flex items-center gap-2.5">
                      <Chip>Video</Chip>
                      <span className="min-w-0 truncate">{v.title}</span>
                    </li>
                  ))}
                </ul>
              ),
            )}
          </div>
        </div>
      </div>
    </div>
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
