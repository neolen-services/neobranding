// The Cast stage of a video: everyone its script uses, set up on one page before the preview.
// The Cast page in the side menu is the whole cast across every video; this is only who is in this one.
import { useState } from "react";
import type { BrandKit } from "@shared/brand";
import type { Character, StudioResult, Video } from "@shared/studio";
import { api } from "./api";
import { readUpload, ServicePicker, useMediaChoices, useMediaKeys } from "./ServicePicker";
import { card, Chip, fieldClass, Icon, ICONS, label, primaryButton, quietButton, smallButton, videoCast, type CastMember } from "./studioUi";
import { VoiceChooser } from "./VoicePicker";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function CastStep({
  video,
  cast,
  brand,
  onCast,
  onVideo,
  onNext,
  onOpenSettings,
  onOpenBrand,
}: {
  video: Video;
  cast: Character[];
  brand: BrandKit;
  /** A character was changed here; the rest of Studio shows it at once. */
  onCast: (character: Character) => void;
  /** A role was given to another character, which changes the video. */
  onVideo: (video: Video) => void;
  onNext: () => void;
  onOpenSettings: () => void;
  onOpenBrand: () => void;
}) {
  const keys = useMediaKeys();
  const [choices, setChoice] = useMediaChoices();
  const info = videoCast(video, cast, brand);
  const nobody = info.members.length === 0 && info.narratorLines === 0;

  return (
    <div className="space-y-5">
      <section className={`${card} flex flex-wrap items-center justify-between gap-4`}>
        <div className="min-w-0">
          <h3 className="font-display text-lg font-semibold">The cast of this video</h3>
          <p className="mt-0.5 text-sm opacity-60">
            {nobody
              ? "No characters and no narrator: you say every line yourself, so there is nothing to set up."
              : info.unready === 0
                ? "Everyone in this script has what they need."
                : `${plural(info.unready, "cast member")} still ${info.unready === 1 ? "needs" : "need"} setting up. Without a voice a line cannot be spoken, and without a reference picture a character can look different in every scene.`}
          </p>
        </div>
        <button type="button" className={`${info.unready === 0 ? primaryButton : quietButton} flex items-center gap-2`} onClick={onNext}>
          On to the preview
          <Icon d={ICONS.arrow} />
        </button>
      </section>

      {(info.myLines > 0 || info.narratorLines > 0) && (
        <section className={`${card} grid gap-4 text-sm sm:grid-cols-2`}>
          {info.myLines > 0 && (
            <div>
              <p className={label}>You</p>
              <p className="mt-1.5">
                <span className="font-medium">{plural(info.myLines, "line")} on camera.</span> <span className="opacity-70">You film and say these yourself.</span>
              </p>
            </div>
          )}
          {info.narratorLines > 0 && (
            <div>
              <p className={`${label} flex items-center gap-2`}>
                Narrator
                {!info.narratorReady && <Chip tone="warn">Needs a voice</Chip>}
              </p>
              <p className="mt-1.5">
                <span className="font-medium">{plural(info.narratorLines, "line")} over the scenes,</span>{" "}
                <span className="opacity-70">in your brand's speaking voice{brand.speakingVoice ? ` (${brand.speakingVoice.name}).` : ". None is chosen yet."}</span>{" "}
                <button type="button" className="underline opacity-70 hover:opacity-100" onClick={onOpenBrand}>
                  {brand.speakingVoice ? "Change it in the brand kit" : "Choose one in the brand kit"}
                </button>
              </p>
            </div>
          )}
        </section>
      )}

      {info.members.length > 0 && choices && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="opacity-70">
            {plural(info.members.length, "role")} in this script. Give each one to a character you already have, so its voice and pictures are reused, or keep the new one the script made. What
            you change on a character carries to every video that uses them.
          </p>
          <ServicePicker task="picture" label="Reference pictures made with" value={choices.picture} keys={keys} onChange={(c) => setChoice("picture", c)} />
        </div>
      )}

      {info.members.map((member) => (
        <MemberCard
          key={member.character.id}
          member={member}
          video={video}
          others={cast.filter((c) => !info.members.some((m) => m.character.id === c.id))}
          onVideo={onVideo}
          onCast={onCast}
          onOpenSettings={onOpenSettings}
          makePicture={choices ? () => api.makeCharacterPicture(member.character.id, choices.picture) : undefined}
        />
      ))}
    </div>
  );
}

type TextField = "look" | "personality" | "speech";

/** One character of the video, with everything the video needs from them editable in place. Text is saved when the box is left. */
function MemberCard({
  member,
  video,
  others,
  onVideo,
  onCast,
  onOpenSettings,
  makePicture,
}: {
  member: CastMember;
  video: Video;
  /** Your other characters, not already in this script, who could take the role. */
  others: Character[];
  onVideo: (video: Video) => void;
  onCast: (character: Character) => void;
  onOpenSettings: () => void;
  /** Makes a reference picture with the service chosen above; missing until the choices have loaded. */
  makePicture?: () => Promise<StudioResult<Character>>;
}) {
  const { character } = member;
  const [draft, setDraft] = useState<Record<TextField, string>>({ look: character.look, personality: character.personality, speech: character.speech });
  const [saved, setSaved] = useState<TextField | "">("");
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const main = character.pictures[0];
  const busy = working !== "";

  async function run(what: string, work: () => Promise<StudioResult<Character>>) {
    setWorking(what);
    setError("");
    try {
      const result = await work();
      if (result.ok) onCast(result.value);
      else setError(result.error);
      return result.ok;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
      return false;
    } finally {
      setWorking("");
    }
  }

  /** Gives the role to another of your characters, or to a new one made for it. */
  async function recast(toId: string) {
    setWorking("Recasting");
    setError("");
    try {
      const result = await api.recastVideo(video.id, character.id, toId);
      if (result.ok) onVideo(result.value.video);
      else setError(result.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The role could not be given to that character.");
    } finally {
      setWorking("");
    }
  }
  const ready = (c: Character) => [c.voice ? "voice" : "", c.pictures.length ? "picture" : ""].filter(Boolean).join(" and ");

  async function saveField(field: TextField) {
    const value = draft[field].trim();
    if (value === character[field]) return;
    if (await run("", () => api.saveCharacter({ ...character, [field]: value }))) {
      setSaved(field);
      setTimeout(() => setSaved((now) => (now === field ? "" : now)), 1800);
    }
  }

  const box = (key: TextField, name: string, placeholder: string, rows: number) => (
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
      <textarea className={`${fieldClass} mt-1.5`} rows={rows} placeholder={placeholder} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} onBlur={() => void saveField(key)} />
    </label>
  );

  return (
    <section className={`${card} grid gap-5 md:grid-cols-[11rem_minmax(0,1fr)]`}>
      <div>
        {main ? (
          <img src={api.studioFileUrl(main.file)} alt={`${character.name}'s reference picture`} className="aspect-[9/16] w-full rounded-xl bg-black object-cover object-top" />
        ) : (
          <span aria-hidden className="flex aspect-[9/16] w-full items-center justify-center rounded-xl bg-[var(--tint)] font-display text-5xl font-semibold opacity-60">
            {character.name.trim().charAt(0).toUpperCase() || "?"}
          </span>
        )}
        <div className="mt-3 space-y-2">
          <button
            type="button"
            className={`${main ? smallButton : `${primaryButton} !px-3 !py-1.5 !text-xs`} w-full`}
            disabled={busy || !makePicture}
            title={character.look.trim() ? undefined : "Write their look first: the picture is made from it."}
            onClick={() => makePicture && void run("Making", makePicture)}
          >
            {working === "Making" ? "Making the picture…" : main ? "Make another picture" : "Make a reference picture"}
          </button>
          <label className={`${smallButton} block cursor-pointer text-center ${busy ? "pointer-events-none opacity-40" : ""}`}>
            {working === "Adding" ? "Adding…" : "Add your own picture"}
            <input
              type="file"
              hidden
              accept="image/png,image/jpeg,image/webp"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) await run("Adding", async () => api.addCharacterPicture(character.id, await readUpload(file)));
              }}
            />
          </label>
        </div>
      </div>

      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="font-display text-lg font-semibold leading-snug">{character.name}</h4>
            <p className="text-sm opacity-60">
              {[character.role, member.lines > 0 ? `speaks ${plural(member.lines, "line")}` : "does not speak", `in ${plural(member.scenes, "scene")}`].filter(Boolean).join(" · ")}
            </p>
          </div>
          <span className="flex flex-wrap gap-1.5">{member.needs.length === 0 ? <Chip tone="good">Ready</Chip> : member.needs.map((n) => <Chip key={n} tone="warn">{`Needs ${n}`}</Chip>)}</span>
        </div>

        <label className="block text-sm">
          <span className="font-medium">Played by</span>
          <select className={`${fieldClass} mt-1.5`} value={character.id} disabled={busy} aria-label={`Who plays ${character.name}`} onChange={(e) => e.target.value !== character.id && void recast(e.target.value)}>
            <option value={character.id}>
              {character.name}
              {ready(character) ? ` (has a ${ready(character)})` : " (new, not set up yet)"}
            </option>
            {others.length > 0 && (
              <optgroup label="Use one of your characters instead">
                {others.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.role ? `, ${c.role}` : ""}
                    {ready(c) ? ` (has a ${ready(c)})` : ""}
                  </option>
                ))}
              </optgroup>
            )}
            <option value="new">A new character for this role</option>
          </select>
          <span className="mt-1 block text-xs opacity-55">
            {working === "Recasting"
              ? "Giving the role to them…"
              : "Choosing another character reuses their voice and pictures. Their name replaces this one in the script, and lines already recorded for this role are recorded again."}
          </span>
        </label>

        {error && (
          <p role="alert" className="text-sm font-medium text-red-400">
            {error}
          </p>
        )}

        {box("look", "Look", "Age, build, hair, and one fixed colour or item of clothing", 2)}

        <div>
          <p className="mb-1.5 text-sm font-medium">Voice</p>
          <VoiceChooser
            value={character.voice}
            onOpenSettings={onOpenSettings}
            emptyText={member.lines > 0 ? `No voice yet. ${character.name}'s lines cannot be spoken until you choose one.` : `No voice yet. ${character.name} does not speak in this video, so none is needed here.`}
            usedFor={`speaks ${character.name}'s lines`}
            onChoose={async (voice) => {
              await run("", () => api.saveCharacter({ ...character, voice }));
            }}
          />
        </div>

        <details>
          <summary className="cursor-pointer text-sm font-medium opacity-70 hover:opacity-100">Personality and how they talk</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {box("personality", "Personality", "Two or three traits, and what they want", 3)}
            {box("speech", "How they talk", "Short sentences? Slang? A catchphrase?", 3)}
          </div>
          <p className="mt-2 text-xs opacity-55">These shape the next script that uses {character.name}. The lines already written stay as they are unless you ask for a rewrite.</p>
        </details>
      </div>
    </section>
  );
}
