// The Cast stage of a video: everyone its script uses, set up on one page before the storyboard.
// The Cast page in the side menu is the whole cast across every video; this is only who is in this one.
import { useState } from "react";
import type { BrandKit } from "@shared/brand";
import type { MediaChoice } from "@shared/media";
import { isMotion, styleLabel, suitsStyle, type Character, type StudioResult, type Video } from "@shared/studio";
import { api } from "./api";
import { CharacterLooks } from "./CharacterLooks";
import { ServicePicker, useMediaChoices, useMediaKeys } from "./ServicePicker";
import { card, Chip, fieldClass, Icon, ICONS, NextBar, primaryButton, quietButton, smallButton, videoCast, type CastMember } from "./studioUi";
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
      {info.unready === 0 ? (
        <NextBar title={nobody ? "Nobody to set up" : "Everyone is ready"} note={nobody ? "You say every line yourself." : "Each role has a voice and pictures, so they look and sound the same in every scene."} action="Go to storyboards" onAction={onNext} />
      ) : (
        <NextBar title={`Set up ${plural(info.unready, "cast member")}`} note="Each role needs a voice and a portrait, so it looks and sounds the same in every scene. Give a role to a character you already have and theirs are reused.">
          <button type="button" className={smallButton} onClick={onNext} title="Storyboards can be drawn now; lines without a voice wait.">
            Skip for now
          </button>
        </NextBar>
      )}
      {!nobody && <section className={`${card} space-y-4`}>
        {(
          <ul className="flex flex-wrap gap-2" aria-label="Who is in this video">
            {info.members.map((m) => (
              <li key={m.character.id}>
                <a href={`#role-${m.character.id}`} className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm hover:border-[var(--ink)] ${m.needs.length ? "border-[var(--accent)]/60" : "border-[var(--line)]"}`}>
                  <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[0.6rem] ${m.needs.length ? "border border-[var(--accent)] text-[var(--accent)]" : "bg-[var(--primary)] text-white"}`}>
                    {m.needs.length ? "!" : <Icon d={ICONS.check} className="h-2.5 w-2.5" />}
                  </span>
                  <span className="font-medium">{m.character.name}</span>
                  <span className="text-xs opacity-60">{m.needs.length ? `needs ${m.needs.join(" and ")}` : "ready"}</span>
                </a>
              </li>
            ))}
            {info.narratorLines > 0 && (
              <li>
                <button type="button" className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm hover:border-[var(--ink)] ${info.narratorReady ? "border-[var(--line)]" : "border-[var(--accent)]/60"}`} title={brand.speakingVoice ? "Change the narrator's voice in the brand kit" : "Choose the narrator's voice in the brand kit"} onClick={onOpenBrand}>
                  <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[0.6rem] ${info.narratorReady ? "bg-[var(--primary)] text-white" : "border border-[var(--accent)] text-[var(--accent)]"}`}>
                    {info.narratorReady ? <Icon d={ICONS.check} className="h-2.5 w-2.5" /> : "!"}
                  </span>
                  <span className="font-medium">Narrator</span>
                  <span className="text-xs opacity-60">
                    {plural(info.narratorLines, "line")} · {brand.speakingVoice ? brand.speakingVoice.name : "needs a voice in the brand kit"}
                  </span>
                </button>
              </li>
            )}
            {info.myLines > 0 && (
              <li className="flex items-center gap-2 rounded-full border border-[var(--line)] px-3 py-1.5 text-sm">
                <Icon d={ICONS.camera} className="h-3.5 w-3.5 opacity-70" />
                <span className="font-medium">You</span>
                <span className="text-xs opacity-60">{plural(info.myLines, "line")} on camera</span>
              </li>
            )}
          </ul>
        )}
      </section>}

      {info.members.map((member) => (
        <MemberCard
          key={member.character.id}
          member={member}
          video={video}
          others={cast.filter((c) => !info.members.some((m) => m.character.id === c.id)).sort((a, b) => Number(suitsStyle(b, video.style)) - Number(suitsStyle(a, video.style)))}
          onVideo={onVideo}
          onCast={onCast}
          onOpenSettings={onOpenSettings}
          pictureChoice={choices?.picture}
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
  pictureChoice,
}: {
  member: CastMember;
  video: Video;
  /** Your other characters, not already in this script, who could take the role. */
  others: Character[];
  onVideo: (video: Video) => void;
  onCast: (character: Character) => void;
  onOpenSettings: () => void;
  /** Makes a reference picture with the service chosen above; missing until the choices have loaded. */
  /** The service that makes pictures on this page. */
  pictureChoice?: MediaChoice;
}) {
  const { character } = member;
  const [draft, setDraft] = useState<Record<TextField, string>>({ look: character.look, personality: character.personality, speech: character.speech });
  const [saved, setSaved] = useState<TextField | "">("");
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
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
    <section id={`role-${character.id}`} className={`${card} grid scroll-mt-40 gap-5 md:grid-cols-[17rem_minmax(0,1fr)]`}>
      <CharacterLooks character={character} choice={pictureChoice} onChange={onCast} onError={setError} />

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
                    {c.style ? ` · ${styleLabel(c.style)}` : ""}
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

        {!isMotion(video) && video.style !== "" && !suitsStyle(character, video.style) && (
          <p className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              {character.name} is drawn as {styleLabel(character.style).toLowerCase()}, and this video is {styleLabel(video.style).toLowerCase()}. Storyboards will redraw them in the video's style, which can change how they look.
            </span>
            <button
              type="button"
              className="shrink-0 rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-medium hover:border-[var(--ink)] disabled:opacity-40"
              disabled={busy}
              title="Changes this character's style for every video. Draw their portrait and sheet again afterwards so the pictures match."
              onClick={() => void run("", () => api.saveCharacter({ ...character, style: video.style }))}
            >
              Make them {styleLabel(video.style).toLowerCase()}
            </button>
          </p>
        )}

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
