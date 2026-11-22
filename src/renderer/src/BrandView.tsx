import { useState, type ReactNode } from "react";
import { BIO_LIMITS, type BrandKit } from "@shared/brand";
import { VoicePicker } from "./VoicePicker";

/** The steps of the brand form, by position, so a section can open the form at the right place. */
export const FORM_SECTION = { about: 0, goals: 1, audience: 2, message: 3, pillars: 4, voice: 5, platforms: 6, colours: 7 } as const;

type Tab = "identity" | "content" | "voice" | "platforms" | "look";
const TABS: [Tab, string][] = [
  ["identity", "Identity"],
  ["content", "Content"],
  ["voice", "Voice"],
  ["platforms", "Platforms"],
  ["look", "Look"],
];

const TOPIC_COLORS = ["var(--secondary)", "var(--primary)", "var(--accent)"];
const card = "rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm";

/**
 * The brand kit as a reference you come back to: a short summary on top, then
 * one tab per kind of thing, each with its own Edit that opens only that part
 * of the form.
 */
export function BrandView({
  brand,
  onEdit,
  onChange,
  onOpenSettings,
}: {
  brand: BrandKit;
  /** Opens the form: at one section, or all of it when no section is given. */
  onEdit: (section?: number) => void;
  /** Called when something is changed on this page itself, such as the speaking voice. */
  onChange: (brand: BrandKit) => void;
  onOpenSettings: () => void;
}) {
  const [tab, setTab] = useState<Tab>("identity");

  // What a complete kit has, in the order worth filling in. Each missing item links to where it is set.
  const checks: { done: boolean; label: string; tab: Tab; section?: number }[] = [
    { done: brand.topics.length > 0, label: "Add the topics you cover", tab: "content", section: FORM_SECTION.about },
    { done: brand.audience !== "", label: "Describe your audience", tab: "identity", section: FORM_SECTION.audience },
    { done: brand.positioning !== "", label: "Write your positioning statement", tab: "identity", section: FORM_SECTION.message },
    { done: brand.tagline !== "", label: "Add a tagline", tab: "identity", section: FORM_SECTION.message },
    { done: brand.bio !== "", label: "Write your bio", tab: "identity", section: FORM_SECTION.message },
    { done: brand.goals.length > 0, label: "Choose your goals", tab: "identity", section: FORM_SECTION.goals },
    { done: brand.pillars.length >= 3, label: "Set at least three content pillars", tab: "content", section: FORM_SECTION.pillars },
    { done: brand.voice.length > 0, label: "Describe your tone of voice", tab: "voice", section: FORM_SECTION.voice },
    { done: brand.speakingVoice !== null, label: "Choose a speaking voice", tab: "voice" },
    { done: brand.platforms.some((p) => p.bio), label: "Write a bio for a platform", tab: "platforms", section: FORM_SECTION.platforms },
  ];
  const done = checks.filter((c) => c.done).length;
  const missing = checks.filter((c) => !c.done);

  const topicColor = (topic: string) => TOPIC_COLORS[Math.max(brand.topics.indexOf(topic), 0) % TOPIC_COLORS.length];

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-6 py-8 text-[var(--ink)]">
      {/* Who this is, at a glance. */}
      <header className={`${card} p-6`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-bold tracking-tight">{brand.name}</h1>
            {brand.tagline && <p className="mt-1 font-display text-xl text-[var(--accent)]">{brand.tagline}</p>}
          </div>
          <button
            type="button"
            onClick={() => onEdit()}
            className="shrink-0 rounded-full border border-[var(--line)] px-4 py-2 text-sm font-medium hover:border-[var(--primary)]"
          >
            Edit everything
          </button>
        </div>
        {brand.positioning && <p className="mt-4 max-w-3xl leading-relaxed opacity-80">{brand.positioning}</p>}
        {brand.topics.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {brand.topics.map((t) => (
              <span key={t} className="flex items-center gap-2 rounded-full bg-[var(--tint)] px-3 py-1 text-sm font-medium">
                <span className="h-2 w-2 rounded-full" style={{ background: topicColor(t) }} />
                {t}
              </span>
            ))}
          </div>
        )}

        <div className="mt-5 border-t border-[var(--line)] pt-4">
          <div className="flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--tint)]">
              <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${(done / checks.length) * 100}%` }} />
            </div>
            <p className="shrink-0 text-sm opacity-70">
              {missing.length === 0 ? "Brand kit complete" : `${done} of ${checks.length} done`}
            </p>
          </div>
          {missing.length > 0 && (
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="opacity-60">Next:</span>
              {missing.slice(0, 3).map((m) => (
                <button
                  key={m.label}
                  type="button"
                  className="rounded-full border border-[var(--line)] px-3 py-0.5 hover:border-[var(--primary)]"
                  onClick={() => (m.section === undefined ? setTab(m.tab) : onEdit(m.section))}
                >
                  {m.label}
                </button>
              ))}
            </p>
          )}
        </div>
      </header>

      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-[var(--line)]">
        {TABS.map(([name, text]) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className={`-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium ${
              tab === name ? "border-[var(--primary)]" : "border-transparent opacity-60 hover:opacity-100"
            }`}
          >
            {text}
          </button>
        ))}
      </div>

      {tab === "identity" && (
        <div className="space-y-5">
          <Section title="Message" hint="How you describe yourself. Copy these into profiles and pitches." onEdit={() => onEdit(FORM_SECTION.message)}>
            <dl className="divide-y divide-[var(--line)]">
              <Line label="Tagline" value={brand.tagline} />
              <Line label="Positioning" value={brand.positioning} />
              <Line label="Mission" value={brand.mission} />
              <Line label="Bio" value={brand.bio} />
            </dl>
          </Section>
          <div className="grid gap-5 md:grid-cols-2">
            <Section title="Audience" hint="Who you make content for." onEdit={() => onEdit(FORM_SECTION.audience)}>
              {brand.audience ? <p className="whitespace-pre-line leading-relaxed">{brand.audience}</p> : <Empty>No audience described yet.</Empty>}
            </Section>
            <Section title="Goals" hint="What you want this brand to achieve." onEdit={() => onEdit(FORM_SECTION.goals)}>
              {brand.goals.length === 0 && !brand.goalDetails && <Empty>No goals chosen yet.</Empty>}
              <div className="flex flex-wrap gap-2">
                {brand.goals.map((g) => (
                  <span key={g} className="rounded-full bg-[var(--tint)] px-3 py-1 text-sm font-medium">
                    {g}
                  </span>
                ))}
              </div>
              {brand.goalDetails && <p className="mt-3 whitespace-pre-line leading-relaxed opacity-85">{brand.goalDetails}</p>}
            </Section>
          </div>
        </div>
      )}

      {tab === "content" && (
        <div className="space-y-5">
          <Section title="Topics" hint="The subjects your brand covers." onEdit={() => onEdit(FORM_SECTION.about)}>
            {brand.topics.length === 0 ? (
              <Empty>No topics yet.</Empty>
            ) : (
              <div className="flex flex-wrap gap-2">
                {brand.topics.map((t) => (
                  <span key={t} className="flex items-center gap-2 rounded-full bg-[var(--tint)] px-3 py-1 text-sm font-medium">
                    <span className="h-2 w-2 rounded-full" style={{ background: topicColor(t) }} />
                    {t}
                  </span>
                ))}
              </div>
            )}
          </Section>
          <Section
            title="Content pillars"
            hint="The recurring themes your content keeps returning to. Ideas are written to fit them."
            onEdit={() => onEdit(FORM_SECTION.pillars)}
          >
            {brand.pillars.length === 0 ? (
              <Empty>No pillars yet. Three to five work best.</Empty>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {brand.pillars.map((p, i) => (
                  <div key={i} className="rounded-xl bg-[var(--bg)] p-4">
                    {p.topic && (
                      <span className="mb-2 flex items-center gap-2 font-mono text-xs uppercase tracking-widest opacity-70">
                        <span className="h-2 w-2 rounded-full" style={{ background: topicColor(p.topic) }} />
                        {p.topic}
                      </span>
                    )}
                    <h3 className="font-display text-lg font-semibold">{p.title}</h3>
                    {p.description && <p className="mt-1.5 text-sm leading-relaxed opacity-75">{p.description}</p>}
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      )}

      {tab === "voice" && (
        <div className="space-y-5">
          <Section title="Tone of voice" hint="How your writing and scripts should sound." onEdit={() => onEdit(FORM_SECTION.voice)}>
            {brand.voice.length === 0 ? (
              <Empty>No tone described yet.</Empty>
            ) : (
              <dl className="grid gap-3 md:grid-cols-2">
                {brand.voice.map((v, i) => (
                  <div key={i} className="rounded-xl bg-[var(--bg)] p-4">
                    <dt className="font-display text-lg font-semibold">{v.trait}</dt>
                    {v.description && <dd className="mt-1 text-sm leading-relaxed opacity-75">{v.description}</dd>}
                  </div>
                ))}
              </dl>
            )}
          </Section>
          <div>
            <SectionHeading title="Speaking voice" hint="The ElevenLabs voice used when the agent makes a voiceover." />
            <VoicePicker brand={brand} onChange={onChange} onOpenSettings={onOpenSettings} />
          </div>
        </div>
      )}

      {tab === "platforms" && (
        <Section title="Platform profiles" hint="Your handle, focus and bio on each platform." onEdit={() => onEdit(FORM_SECTION.platforms)} bare>
          {brand.platforms.length === 0 ? (
            <div className={card}>
              <Empty>No platforms added yet.</Empty>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {brand.platforms.map((p) => {
                const limit = BIO_LIMITS[p.platform];
                const length = [...p.bio].length;
                return (
                  <div key={p.platform} className={card}>
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="font-display text-xl font-semibold">{p.platform}</h3>
                      {p.handle && <span className="truncate text-sm font-medium text-[var(--secondary-text)]">{p.handle}</span>}
                    </div>
                    {p.focus && <p className="mt-1 text-sm opacity-70">{p.focus}</p>}
                    {p.bio ? (
                      <>
                        <p className="mt-4 whitespace-pre-line rounded-xl bg-[var(--bg)] p-3 text-sm leading-relaxed">{p.bio}</p>
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <CopyButton text={p.bio} label="Copy bio" />
                          {limit && (
                            <p className={`font-mono text-xs ${length > limit ? "font-semibold text-red-400" : "opacity-50"}`}>
                              {length} / {limit} characters
                            </p>
                          )}
                        </div>
                      </>
                    ) : (
                      <p className="mt-4 text-sm opacity-50">No bio written for this platform.</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      )}

      {tab === "look" && (
        <Section title="Colour palette" hint="Your brand colours. The first three also colour this app. Click a colour to copy its code." onEdit={() => onEdit(FORM_SECTION.colours)}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {brand.colors.map((c) => (
              <Swatch key={c.role} name={c.name} role={c.role} hex={c.hex} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function SectionHeading({ title, hint, onEdit }: { title: string; hint: string; onEdit?: () => void }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div>
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        <p className="text-sm opacity-60">{hint}</p>
      </div>
      {onEdit && (
        <button type="button" onClick={onEdit} className="shrink-0 text-sm font-medium text-[var(--accent)] hover:underline">
          Edit
        </button>
      )}
    </div>
  );
}

/** A titled block with its own Edit. `bare` leaves out the card, for sections that are a grid of cards. */
function Section({ title, hint, onEdit, bare = false, children }: { title: string; hint: string; onEdit: () => void; bare?: boolean; children: ReactNode }) {
  return (
    <section>
      <SectionHeading title={title} hint={hint} onEdit={onEdit} />
      {bare ? children : <div className={card}>{children}</div>}
    </section>
  );
}

/** One labelled piece of text with a copy button, or a note that it is not set. */
function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[8rem_1fr_auto] sm:gap-4">
      <dt className="text-sm opacity-60">{label}</dt>
      <dd className={`whitespace-pre-line leading-relaxed ${value ? "" : "opacity-40"}`}>{value || "Not set"}</dd>
      <div>{value && <CopyButton text={value} label="Copy" />}</div>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="text-xs underline opacity-60 hover:opacity-100"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

function Swatch({ name, role, hex }: { name: string; role: string; hex: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={`Copy ${hex}`}
      className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--bg)] text-left hover:border-[var(--primary)]"
      onClick={async () => {
        await navigator.clipboard.writeText(hex);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      <span className="block h-20 border-b border-[var(--line)]" style={{ background: hex }} />
      <span className="block p-3">
        <span className="block font-display font-semibold">{name}</span>
        <span className="block font-mono text-xs uppercase tracking-wide opacity-60">{role}</span>
        <span className="mt-1 block font-mono text-sm">{copied ? "Copied" : hex}</span>
      </span>
    </button>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm opacity-50">{children}</p>;
}
