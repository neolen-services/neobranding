// The first step of every video and series: Claude suggests five ideas, each a story in four parts,
// and the creator approves one, asks for a change to one, or asks for five new ones.
import { useEffect, useState, type ReactNode } from "react";
import { approvedConcept, CONCEPT_COUNT, STORY_PARTS, type Concept, type Series, type Video } from "@shared/studio";
import { api } from "./api";
import { card, Chip, fieldClass, Icon, ICONS, label, primaryButton, quietButton, smallButton } from "./studioUi";

const COST = "a few cents";
/** Videos and series whose first set of ideas has been asked for, so it is only asked once however often the screen is drawn. */
const asked = new Set<string>();

export function IdeaStage({
  kind,
  item,
  settled,
  autoStart,
  onChange,
  next,
}: {
  kind: "video" | "series";
  item: Video | Series;
  /** The idea is decided: one was approved, or the work has already moved past this step. */
  settled: boolean;
  /** Ask for ideas on arrival, when there are none yet. */
  autoStart?: boolean;
  onChange: (item: Video | Series) => void;
  /** What to do once the idea is settled (a button), shown beside the approved idea. */
  next: ReactNode;
}) {
  /** "" when idle, "all" while a new set is being written, or the id of the one idea being changed or approved. */
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [changing, setChanging] = useState("");
  const [change, setChange] = useState("");
  const [note, setNote] = useState("");

  async function run(what: string, work: () => Promise<{ ok: true; value: Video | Series } | { ok: false; error: string }>) {
    setBusy(what);
    setError("");
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
  const suggest = (text: string) => run("all", () => api.suggestIdeas(kind, item.id, text));
  const approve = (conceptId: string) => run(conceptId || "own", () => api.approveIdea(kind, item.id, conceptId));

  useEffect(() => {
    if (!autoStart || settled || item.concepts.length > 0 || asked.has(item.id)) return;
    asked.add(item.id);
    void suggest("");
    // Only on arrival: what comes back is drawn from the item itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chosen = approvedConcept(item);
  const off = busy !== "";
  const thing = kind === "series" ? "series" : "video";

  return (
    <div className="space-y-5">
      {settled && (
        <section className={`${card} flex flex-wrap items-center gap-4 border-[var(--primary)]`}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-white">
            <Icon d={ICONS.check} />
          </span>
          <div className="min-w-0 flex-1">
            <p className={label}>Idea approved</p>
            <p className="mt-0.5 font-display text-lg font-semibold leading-snug">{chosen ? chosen.title : "Your own words, as you wrote them"}</p>
          </div>
          {next}
        </section>
      )}

      {error && (
        <p role="alert" className="rounded-xl border border-red-400/50 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-300">
          {error}
        </p>
      )}

      {item.concepts.length === 0 &&
        (busy === "all" ? (
          <section aria-busy className="space-y-4">
            <p className="text-sm font-medium">Claude is working out different ways to make this {thing} and picking the best {CONCEPT_COUNT}. About 30 seconds.</p>
            <div className="grid gap-4 lg:grid-cols-2">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className={`${card} h-56 animate-pulse`}>
                  <div className="h-5 w-2/3 rounded bg-[var(--tint)]" />
                  <div className="mt-4 h-3 w-full rounded bg-[var(--tint)]" />
                  <div className="mt-2 h-3 w-5/6 rounded bg-[var(--tint)]" />
                  <div className="mt-6 h-3 w-1/2 rounded bg-[var(--tint)]" />
                </div>
              ))}
            </div>
          </section>
        ) : (
          !settled && (
            <section className={`${card} flex flex-col items-center px-6 py-10 text-center`}>
              <h3 className="font-display text-lg font-semibold">Settle the idea first</h3>
              <p className="mt-2 max-w-lg text-sm leading-relaxed opacity-65">
                Claude works out different ways to make this {thing} and shows you the best {CONCEPT_COUNT}. Each one is a story: characters you care about, rising tension, a moment of
                victory and an ending you did not expect. You approve one before anything is written.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-3">
                <button type="button" className={primaryButton} disabled={off} onClick={() => void suggest("")}>
                  Suggest {CONCEPT_COUNT} ideas ({COST})
                </button>
                <button type="button" className={quietButton} disabled={off} onClick={() => void approve("")}>
                  {busy === "own" ? "Saving…" : "Keep my own words"}
                </button>
              </div>
            </section>
          )
        ))}

      {item.concepts.length > 0 && (
        <>
          {!settled && (
            <p className="text-sm opacity-70">
              {item.concepts.length === 1 ? "One idea" : `${item.concepts.length} ideas`}, strongest first. Approve one, or ask for a change to it.
            </p>
          )}
          <ol className="grid gap-4 lg:grid-cols-2">
            {item.concepts.map((concept, index) => (
              <ConceptCard
                key={concept.id}
                concept={concept}
                index={index}
                kind={kind}
                approved={concept.id === item.conceptId && item.ideaApprovedAt !== ""}
                dimmed={chosen !== undefined && concept.id !== chosen.id}
                busy={busy}
                changing={changing === concept.id}
                change={changing === concept.id ? change : ""}
                onApprove={() => void approve(concept.id)}
                onToggleChange={() => {
                  setChanging(changing === concept.id ? "" : concept.id);
                  setChange("");
                }}
                onChangeText={setChange}
                onSubmitChange={async () => {
                  if (await run(concept.id, () => api.suggestIdeas(kind, item.id, change, concept.id))) {
                    setChanging("");
                    setChange("");
                  }
                }}
              />
            ))}
          </ol>

          <section className={card}>
            <label className="block text-sm">
              <span className="font-display text-base font-semibold">None of these?</span>
              <span className="mt-0.5 block opacity-60">Say what you want instead and Claude suggests {CONCEPT_COUNT} new ones. These are replaced.</span>
              <textarea
                className={`${fieldClass} mt-3`}
                rows={2}
                placeholder="For example: less comedy, make me the one who gets it wrong, and end on a number."
                value={note}
                disabled={off}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className={quietButton}
                disabled={off}
                onClick={async () => {
                  if (await suggest(note)) setNote("");
                }}
              >
                {busy === "all" ? "Working out new ideas… about 30 seconds" : `Suggest ${CONCEPT_COUNT} new ideas (${COST})`}
              </button>
              {!settled && (
                <button type="button" className="text-sm underline opacity-60 hover:opacity-100 disabled:opacity-30" disabled={off} onClick={() => void approve("")}>
                  Skip these and keep my own words
                </button>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function ConceptCard({
  concept,
  index,
  kind,
  approved,
  dimmed,
  busy,
  changing,
  change,
  onApprove,
  onToggleChange,
  onChangeText,
  onSubmitChange,
}: {
  concept: Concept;
  index: number;
  kind: "video" | "series";
  approved: boolean;
  /** Another idea was approved, so this one steps back. */
  dimmed: boolean;
  busy: string;
  changing: boolean;
  change: string;
  onApprove: () => void;
  onToggleChange: () => void;
  onChangeText: (text: string) => void;
  onSubmitChange: () => void;
}) {
  const mine = busy === concept.id;
  const off = busy !== "";
  return (
    <li className={`${card} flex flex-col ${approved ? "border-[var(--primary)] ring-1 ring-[var(--primary)]" : ""} ${dimmed ? "opacity-60 hover:opacity-100" : ""}`}>
      <div className="flex items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--tint)] font-display text-sm font-semibold">{index + 1}</span>
        <div className="min-w-0 flex-1">
          <h4 className="font-display text-lg font-semibold leading-snug">{concept.title}</h4>
          <p className="mt-1 text-sm leading-relaxed opacity-70">{concept.angle}</p>
        </div>
        {approved ? <Chip tone="strong">Approved</Chip> : index === 0 && <Chip tone="good">Strongest</Chip>}
      </div>

      <p className="mt-4 border-l-4 border-[var(--accent)] pl-3 font-medium leading-snug">
        <span className={`${label} mb-1 block`}>{kind === "series" ? "Running question" : "Opening line"}</span>“{concept.hook}”
      </p>

      <ol className="mt-4 space-y-3">
        {STORY_PARTS.map(([key, name], i) => (
          <li key={key} className="flex gap-3 text-sm">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--line)] text-[0.7rem] font-semibold opacity-70">{i + 1}</span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold uppercase tracking-wide opacity-55">{name}</span>
              <span className="mt-0.5 block leading-relaxed">{concept[key]}</span>
            </span>
          </li>
        ))}
      </ol>

      <dl className="mt-4 space-y-1 border-t border-[var(--line)] pt-3 text-sm">
        {(
          [
            ["For", concept.viewer],
            ["They leave with", concept.takeaway],
            ["Why it could work", concept.why],
          ] as const
        ).map(
          ([name, value]) =>
            value && (
              <div key={name}>
                <dt className="inline opacity-55">{name}: </dt>
                <dd className="inline">{value}</dd>
              </div>
            ),
        )}
      </dl>

      {changing && (
        <div className="mt-4">
          <textarea
            className={fieldClass}
            rows={2}
            autoFocus
            aria-label={`What should change in idea ${index + 1}`}
            placeholder="What should change? For example: make the ending about the cost, not the taste."
            value={change}
            disabled={off}
            onChange={(e) => onChangeText(e.target.value)}
          />
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        {changing ? (
          <>
            <button type="button" className={`${primaryButton} !px-4 !py-1.5`} disabled={off || !change.trim()} onClick={onSubmitChange}>
              {mine ? "Changing it… about 20 seconds" : `Change this idea (${COST})`}
            </button>
            <button type="button" className={smallButton} disabled={off} onClick={onToggleChange}>
              Cancel
            </button>
          </>
        ) : (
          <>
            {!approved && (
              <button type="button" className={`${primaryButton} !px-4 !py-1.5`} disabled={off} onClick={onApprove}>
                {mine ? "Approving…" : "Approve this idea"}
              </button>
            )}
            <button type="button" className={smallButton} disabled={off} onClick={onToggleChange}>
              Ask for a change
            </button>
          </>
        )}
      </div>
    </li>
  );
}
