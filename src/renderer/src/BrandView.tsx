import type { CSSProperties, ReactNode } from "react";
import { BIO_LIMITS, type BrandKit } from "@shared/brand";

const TOPIC_COLORS = ["var(--secondary)", "var(--primary)", "var(--accent)"];

/**
 * Page surfaces. The brand's background colour is one surface among several,
 * not a blanket: bands alternate between white, the background colour, a
 * slightly deeper tint and one dark band, and cards always sit on the
 * opposite surface so they stay visible through a hairline border.
 */
type Tone = "white" | "paper" | "tint" | "dark";

const BAND: Record<Tone, string> = {
  white: "bg-white",
  paper: "bg-[var(--bg)]",
  tint: "bg-[var(--tint)]",
  dark: "bg-[var(--ink)] text-white",
};

const CARD: Record<Tone, string> = {
  white: "border border-[var(--line)] bg-[var(--bg)]",
  paper: "border border-[var(--line)] bg-white shadow-sm",
  tint: "border border-[var(--line)] bg-white shadow-sm",
  dark: "border border-white/10 bg-white/5",
};

export function BrandView({ brand, onEdit }: { brand: BrandKit; onEdit: () => void }) {
  const color = (role: string) => brand.colors.find((c) => c.role === role)?.hex ?? "#000000";
  const vars = {
    "--primary": color("primary"),
    "--secondary": color("secondary"),
    "--accent": color("accent"),
    "--ink": color("text"),
    "--bg": color("background"),
    "--tint": "color-mix(in srgb, var(--ink) 4%, var(--bg))",
    "--line": "color-mix(in srgb, var(--ink) 10%, var(--bg))",
  } as CSSProperties;

  const topicColor = (topic: string) =>
    TOPIC_COLORS[Math.max(brand.topics.indexOf(topic), 0) % TOPIC_COLORS.length];

  const bands: { title: string; tone: Tone; body: ReactNode }[] = [];

  if (brand.goals.length > 0 || brand.goalDetails) {
    bands.push({
      title: "What I want to achieve",
      tone: "white",
      body: (
        <>
          <div className="flex flex-wrap gap-2">
            {brand.goals.map((g) => (
              <span key={g} className={`rounded-full px-3 py-1 text-sm font-medium ${CARD.white}`}>
                {g}
              </span>
            ))}
          </div>
          {brand.goalDetails && (
            <p className="mt-5 max-w-3xl whitespace-pre-line text-lg leading-relaxed">{brand.goalDetails}</p>
          )}
        </>
      ),
    });
  }

  if (brand.mission || brand.audience || brand.bio) {
    bands.push({
      title: "Who I am",
      tone: "tint",
      body: (
        <div className="grid gap-4 md:grid-cols-2">
          {brand.mission && <TextCard tone="tint" title="Mission">{brand.mission}</TextCard>}
          {brand.audience && <TextCard tone="tint" title="Audience">{brand.audience}</TextCard>}
          {brand.bio && (
            <div className="md:col-span-2">
              <TextCard tone="tint" title="Bio">{brand.bio}</TextCard>
            </div>
          )}
        </div>
      ),
    });
  }

  if (brand.pillars.length > 0) {
    bands.push({
      title: "Content pillars",
      tone: "white",
      body: (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {brand.pillars.map((p, i) => (
            <div key={i} className={`rounded-2xl p-5 ${CARD.white}`}>
              {p.topic && (
                <span className="mb-3 flex items-center gap-2 font-mono text-xs uppercase tracking-widest opacity-70">
                  <span className="h-2 w-2 rounded-full" style={{ background: topicColor(p.topic) }} />
                  {p.topic}
                </span>
              )}
              <h3 className="font-display text-xl font-semibold">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed opacity-75">{p.description}</p>
            </div>
          ))}
        </div>
      ),
    });
  }

  if (brand.voice.length > 0) {
    bands.push({
      title: "Voice",
      tone: "dark",
      body: (
        <dl className="grid gap-4 md:grid-cols-2">
          {brand.voice.map((v, i) => (
            <div key={i} className={`rounded-2xl p-5 ${CARD.dark}`}>
              <dt className="font-display text-lg font-semibold">{v.trait}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-white/70">{v.description}</dd>
            </div>
          ))}
        </dl>
      ),
    });
  }

  if (brand.platforms.length > 0) {
    bands.push({
      title: "Platform profiles",
      tone: "paper",
      body: (
        <div className="grid gap-4 md:grid-cols-2">
          {brand.platforms.map((p) => {
            const limit = BIO_LIMITS[p.platform];
            const length = [...p.bio].length;
            return (
              <div key={p.platform} className={`rounded-2xl p-5 ${CARD.paper}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-display text-xl font-semibold">{p.platform}</h3>
                  <span className="truncate text-sm font-medium text-[var(--secondary)]">{p.handle}</span>
                </div>
                {p.focus && <p className="mt-1 text-sm opacity-70">{p.focus}</p>}
                {p.bio && (
                  <>
                    <p className="mt-4 whitespace-pre-line rounded-xl bg-[var(--tint)] p-3 text-sm leading-relaxed">
                      {p.bio}
                    </p>
                    {limit && (
                      <p
                        className={`mt-2 text-right font-mono text-xs ${
                          length > limit ? "font-semibold text-red-600" : "opacity-50"
                        }`}
                      >
                        {length} / {limit} characters
                      </p>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      ),
    });
  }

  bands.push({
    title: "Colour palette",
    tone: "white",
    body: (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {brand.colors.map((c) => (
          <div key={c.role} className={`overflow-hidden rounded-2xl ${CARD.white}`}>
            <div className="h-24 border-b border-[var(--line)]" style={{ background: c.hex }} />
            <div className="p-3">
              <p className="font-display font-semibold">{c.name}</p>
              <p className="font-mono text-xs uppercase tracking-wide opacity-60">{c.role}</p>
              <p className="mt-1 font-mono text-sm">{c.hex}</p>
            </div>
          </div>
        ))}
      </div>
    ),
  });

  return (
    <div style={vars} className="min-h-full bg-white text-[var(--ink)]">
      {/* Light hero: the background colour with two soft glows of brand colour. */}
      <header
        className="border-b border-[var(--line)]"
        style={{
          background: `
            radial-gradient(60% 70% at 100% 0, color-mix(in srgb, var(--accent) 16%, transparent), transparent 60%),
            radial-gradient(50% 60% at 0 10%, color-mix(in srgb, var(--secondary) 12%, transparent), transparent 60%),
            var(--bg)`,
        }}
      >
        <div className="mx-auto max-w-5xl px-6 py-16">
          <div className="flex items-start justify-between gap-4">
            <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest opacity-70">
              <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
              {brand.topics.join(" × ") || "Personal brand"}
            </p>
            <button
              type="button"
              onClick={onEdit}
              className="shrink-0 rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Edit brand
            </button>
          </div>
          <h1 className="mt-8 font-display text-6xl font-bold tracking-tight">{brand.name}</h1>
          {brand.tagline && (
            <p className="mt-3 font-display text-3xl text-[var(--primary)]">{brand.tagline}</p>
          )}
          {brand.positioning && (
            <p className="mt-6 max-w-2xl text-lg leading-relaxed opacity-75">{brand.positioning}</p>
          )}
        </div>
      </header>

      {bands.map((band, i) => (
        <section key={band.title} className={BAND[band.tone]}>
          <div className="mx-auto max-w-5xl px-6 py-14">
            <h2 className="mb-6 flex items-center gap-3 font-mono text-xs uppercase tracking-widest">
              <span className={band.tone === "dark" ? "text-[var(--accent)]" : "text-[var(--primary)]"}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="h-px w-8 bg-current opacity-30" />
              <span className="opacity-70">{band.title}</span>
            </h2>
            {band.body}
          </div>
        </section>
      ))}
    </div>
  );
}

function TextCard({ tone, title, children }: { tone: Tone; title: string; children: ReactNode }) {
  return (
    <div className={`h-full rounded-2xl p-6 ${CARD[tone]}`}>
      <h3 className="font-mono text-xs uppercase tracking-widest opacity-60">{title}</h3>
      <p className="mt-3 whitespace-pre-line text-lg leading-relaxed">{children}</p>
    </div>
  );
}
