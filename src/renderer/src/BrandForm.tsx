import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { api } from "./api";
import { BIO_LIMITS, GOAL_OPTIONS, PLATFORM_OPTIONS, type BrandKit } from "@shared/brand";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600";

type Props = {
  /** "onboarding" shows one step at a time; "edit" shows everything on one page. */
  mode: "onboarding" | "edit";
  initial: BrandKit;
  onSaved: (brand: BrandKit) => void;
  onCancel?: () => void;
};

type ListKey = "pillars" | "voice" | "platforms" | "colors";

export function BrandForm({ mode, initial, onSaved, onCancel }: Props) {
  const [kit, setKit] = useState(initial);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof BrandKit>(key: K, value: BrandKit[K]) =>
    setKit((k) => ({ ...k, [key]: value }));

  function list<K extends ListKey>(key: K) {
    type Item = BrandKit[K][number];
    const items = kit[key] as Item[];
    return {
      update: (index: number, value: Item) =>
        set(key, items.map((x, i) => (i === index ? value : x)) as BrandKit[K]),
      remove: (index: number) => set(key, items.filter((_, i) => i !== index) as BrandKit[K]),
      add: (value: Item) => set(key, [...items, value] as BrandKit[K]),
    };
  }

  const pillars = list("pillars");
  const voice = list("voice");
  const platforms = list("platforms");
  const colors = list("colors");

  const toggleGoal = (goal: string) =>
    set("goals", kit.goals.includes(goal) ? kit.goals.filter((g) => g !== goal) : [...kit.goals, goal]);

  const togglePlatform = (platform: string) =>
    set(
      "platforms",
      kit.platforms.some((p) => p.platform === platform)
        ? kit.platforms.filter((p) => p.platform !== platform)
        : [...kit.platforms, { platform, handle: "", focus: "", bio: "" }],
    );

  const sections: { title: string; hint: string; body: ReactNode }[] = [
    {
      title: "About you",
      hint: "Who is this brand, and what is it about?",
      body: (
        <>
          <Field label="Your name or brand name">
            <input
              className={inputClass}
              autoFocus={mode === "onboarding"}
              value={kit.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
          <Field label="Topics you cover" help="Type a topic and press Enter. For example: Health, AI.">
            <TagInput values={kit.topics} onChange={(v) => set("topics", v)} />
          </Field>
        </>
      ),
    },
    {
      title: "Your goals",
      hint: "What do you want this brand to achieve? Pick all that apply.",
      body: (
        <>
          <div className="flex flex-wrap gap-2">
            {GOAL_OPTIONS.map((goal) => (
              <Chip key={goal} selected={kit.goals.includes(goal)} onClick={() => toggleGoal(goal)}>
                {goal}
              </Chip>
            ))}
          </div>
          <Field label="What does success look like for you?">
            <textarea
              className={inputClass}
              rows={4}
              placeholder="For example: 50,000 followers across platforms in a year, and being a trusted voice people turn to before making a health decision."
              value={kit.goalDetails}
              onChange={(e) => set("goalDetails", e.target.value)}
            />
          </Field>
        </>
      ),
    },
    {
      title: "Your audience",
      hint: "Who are you making content for?",
      body: (
        <Field label="Describe your ideal follower">
          <textarea
            className={inputClass}
            rows={4}
            placeholder="For example: health-curious adults aged 22 to 45 who track sleep or steps, are starting to use AI assistants, and want jargon-free guidance."
            value={kit.audience}
            onChange={(e) => set("audience", e.target.value)}
          />
        </Field>
      ),
    },
    {
      title: "Your message",
      hint: "How you describe yourself. Leave anything blank that you want to decide later.",
      body: (
        <>
          <Field label="Tagline">
            <input
              className={inputClass}
              placeholder="For example: Health, decoded. Powered by AI."
              value={kit.tagline}
              onChange={(e) => set("tagline", e.target.value)}
            />
          </Field>
          <Field label="Positioning statement" help="One sentence: who you help and how.">
            <textarea className={inputClass} rows={3} value={kit.positioning} onChange={(e) => set("positioning", e.target.value)} />
          </Field>
          <Field label="Mission" help="The change you want to make.">
            <textarea className={inputClass} rows={3} value={kit.mission} onChange={(e) => set("mission", e.target.value)} />
          </Field>
          <Field label="Bio" help="A short paragraph about you, including any credentials.">
            <textarea className={inputClass} rows={4} value={kit.bio} onChange={(e) => set("bio", e.target.value)} />
          </Field>
        </>
      ),
    },
    {
      title: "Content pillars",
      hint: "The three to five recurring themes your content will keep returning to.",
      body: (
        <>
          {kit.pillars.map((p, i) => (
            <Row key={i} onRemove={() => pillars.remove(i)}>
              <div className="flex gap-2">
                <input
                  className={inputClass}
                  placeholder="Pillar title, e.g. Myth vs. evidence"
                  value={p.title}
                  onChange={(e) => pillars.update(i, { ...p, title: e.target.value })}
                />
                {kit.topics.length > 0 && (
                  <select
                    className={`${inputClass} !w-40 shrink-0`}
                    aria-label="Topic"
                    value={p.topic}
                    onChange={(e) => pillars.update(i, { ...p, topic: e.target.value })}
                  >
                    <option value="">No topic</option>
                    {kit.topics.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                )}
              </div>
              <textarea
                className={inputClass}
                rows={2}
                placeholder="What this pillar covers"
                value={p.description}
                onChange={(e) => pillars.update(i, { ...p, description: e.target.value })}
              />
            </Row>
          ))}
          <AddButton onClick={() => pillars.add({ title: "", topic: "", description: "" })}>Add a pillar</AddButton>
        </>
      ),
    },
    {
      title: "Your voice",
      hint: "How you sound. A few traits and what each means in practice.",
      body: (
        <>
          {kit.voice.map((v, i) => (
            <Row key={i} onRemove={() => voice.remove(i)}>
              <input
                className={inputClass}
                placeholder="Trait, e.g. Clear, not clinical"
                value={v.trait}
                onChange={(e) => voice.update(i, { ...v, trait: e.target.value })}
              />
              <textarea
                className={inputClass}
                rows={2}
                placeholder="What it means in practice"
                value={v.description}
                onChange={(e) => voice.update(i, { ...v, description: e.target.value })}
              />
            </Row>
          ))}
          <AddButton onClick={() => voice.add({ trait: "", description: "" })}>Add a voice trait</AddButton>
        </>
      ),
    },
    {
      title: "Your platforms",
      hint: "Where you will post. Pick your platforms, then fill in each profile.",
      body: (
        <>
          <div className="flex flex-wrap gap-2">
            {PLATFORM_OPTIONS.map((name) => (
              <Chip key={name} selected={kit.platforms.some((p) => p.platform === name)} onClick={() => togglePlatform(name)}>
                {name}
              </Chip>
            ))}
          </div>
          {kit.platforms.map((p, i) => {
            const limit = BIO_LIMITS[p.platform];
            const length = [...p.bio].length;
            return (
              <div key={p.platform} className="space-y-2 rounded-xl bg-white p-4 shadow-sm">
                <p className="font-display font-semibold">{p.platform}</p>
                <input
                  className={inputClass}
                  placeholder="Handle or profile name"
                  value={p.handle}
                  onChange={(e) => platforms.update(i, { ...p, handle: e.target.value })}
                />
                <input
                  className={inputClass}
                  placeholder="What you will post here"
                  value={p.focus}
                  onChange={(e) => platforms.update(i, { ...p, focus: e.target.value })}
                />
                <textarea
                  className={inputClass}
                  rows={3}
                  placeholder="Profile bio"
                  value={p.bio}
                  onChange={(e) => platforms.update(i, { ...p, bio: e.target.value })}
                />
                {limit && (
                  <p className={`text-right text-xs ${length > limit ? "font-semibold text-red-600" : "text-slate-500"}`}>
                    {length} / {limit} characters
                  </p>
                )}
              </div>
            );
          })}
        </>
      ),
    },
    {
      title: "Your colours",
      hint: "A starting palette is filled in. Change any colour to make it yours.",
      body: (
        <>
          {kit.colors.map((c, i) => (
            <div key={c.role} className="flex items-center gap-3">
              <input
                type="color"
                aria-label={`${c.role} colour`}
                className="h-10 w-12 shrink-0 cursor-pointer rounded border border-slate-300 bg-white"
                value={/^#[0-9a-fA-F]{6}$/.test(c.hex) ? c.hex : "#000000"}
                onChange={(e) => colors.update(i, { ...c, hex: e.target.value.toUpperCase() })}
              />
              <span className="w-24 shrink-0 text-sm capitalize text-slate-600">{c.role}</span>
              <input
                className={`${inputClass} min-w-0 flex-1`}
                aria-label={`${c.role} colour name`}
                value={c.name}
                onChange={(e) => colors.update(i, { ...c, name: e.target.value })}
              />
              <input
                className={`${inputClass} !w-28 shrink-0 font-mono`}
                aria-label={`${c.role} hex value`}
                value={c.hex}
                onChange={(e) => colors.update(i, { ...c, hex: e.target.value })}
              />
            </div>
          ))}
        </>
      ),
    },
  ];

  const isLastStep = step === sections.length - 1;

  async function save() {
    setError("");
    setSaving(true);
    try {
      const result = await api.saveBrand(kit);
      if (result.ok) onSaved(result.brand);
      else setError(result.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the brand.");
    } finally {
      setSaving(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!kit.name.trim()) {
      setError("Please enter your name first.");
      if (mode === "onboarding") setStep(0);
      return;
    }
    if (mode === "onboarding" && !isLastStep) {
      setError("");
      setStep(step + 1);
      return;
    }
    save();
  }

  const primaryButton = (label: string) => (
    <button
      type="submit"
      disabled={saving}
      className="rounded-full bg-teal-700 px-6 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
    >
      {saving ? "Saving…" : label}
    </button>
  );
  const secondaryClass = "rounded-full px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-200";
  const errorNote = error && (
    <p role="alert" className="mr-auto text-sm font-medium text-red-600">
      {error}
    </p>
  );

  if (mode === "onboarding") {
    const current = sections[step];
    return (
      <form onSubmit={onSubmit} className="mx-auto flex min-h-full max-w-2xl flex-col px-6 py-10">
        <p className="text-sm font-semibold uppercase tracking-widest text-teal-700">
          Create your brand · Step {step + 1} of {sections.length}
        </p>
        <div className="mt-3 flex gap-1.5" aria-hidden>
          {sections.map((_, i) => (
            <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-teal-700" : "bg-slate-300"}`} />
          ))}
        </div>
        <h1 className="mt-8 font-display text-4xl font-bold">{current.title}</h1>
        <p className="mt-2 text-slate-600">{current.hint}</p>
        {/* key resets focus and scroll position per step */}
        <div key={step} className="mt-8 flex-1 space-y-5">
          {current.body}
        </div>
        <div className="mt-10 flex items-center justify-end gap-3">
          {errorNote}
          {step > 0 && (
            <button type="button" className={secondaryClass} onClick={() => { setError(""); setStep(step - 1); }}>
              Back
            </button>
          )}
          {primaryButton(isLastStep ? "Create my brand" : "Next")}
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-3xl px-6 pt-10">
      <h1 className="font-display text-3xl font-bold">Edit brand</h1>
      <div className="mt-8 space-y-12">
        {sections.map((s) => (
          <section key={s.title}>
            <h2 className="border-b border-slate-300 pb-2 font-display text-xl font-semibold">{s.title}</h2>
            <p className="mt-2 text-sm text-slate-600">{s.hint}</p>
            <div className="mt-4 space-y-4">{s.body}</div>
          </section>
        ))}
      </div>
      <div className="sticky bottom-0 -mx-6 mt-10 flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-100/95 px-6 py-4 backdrop-blur">
        {errorNote}
        <button type="button" className={secondaryClass} onClick={onCancel}>
          Cancel
        </button>
        {primaryButton("Save brand")}
      </div>
    </form>
  );
}

function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-slate-800">{label}</span>
      {help && <span className="block text-xs text-slate-500">{help}</span>}
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`rounded-full border px-4 py-2 text-sm font-medium ${
        selected
          ? "border-teal-700 bg-teal-700 text-white"
          : "border-slate-300 bg-white text-slate-700 hover:border-teal-600"
      }`}
    >
      {children}
    </button>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-xl border border-dashed border-slate-400 py-3 text-sm font-medium text-teal-700 hover:border-teal-600 hover:bg-white"
    >
      + {children}
    </button>
  );
}

function Row({ onRemove, children }: { onRemove: () => void; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl bg-white p-3 shadow-sm">
      <div className="min-w-0 flex-1 space-y-2">{children}</div>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove"
        className="shrink-0 rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
      >
        ✕
      </button>
    </div>
  );
}

/** Free-text tags: Enter or comma adds, Backspace on empty removes the last. */
function TagInput({ values, onChange }: { values: string[]; onChange: (values: string[]) => void }) {
  const [draft, setDraft] = useState("");

  /** Adds every comma-separated piece of the text as a tag. */
  const addTags = (text: string) => {
    const next = [...values];
    for (const tag of text.split(",").map((t) => t.trim())) {
      if (tag && !next.includes(tag)) next.push(tag);
    }
    if (next.length !== values.length) onChange(next);
    setDraft("");
  };

  // Commas can arrive by typing or pasting, so they are handled on change.
  const onDraftChange = (text: string) => (text.includes(",") ? addTags(text) : setDraft(text));

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && draft.trim()) {
      // Only swallow Enter when it adds a tag, so an empty Enter still submits the step.
      e.preventDefault();
      addTags(draft);
    } else if (e.key === "Backspace" && !draft && values.length) {
      onChange(values.slice(0, -1));
    }
  }

  return (
    <div className={`${inputClass} flex flex-wrap items-center gap-1.5`}>
      {values.map((v) => (
        <span key={v} className="flex items-center gap-1 rounded-full bg-teal-50 py-0.5 pl-2.5 pr-1 text-teal-800">
          {v}
          <button
            type="button"
            aria-label={`Remove ${v}`}
            onClick={() => onChange(values.filter((x) => x !== v))}
            className="rounded-full px-1 text-teal-600 hover:bg-teal-100"
          >
            ✕
          </button>
        </span>
      ))}
      <input
        className="min-w-24 flex-1 bg-transparent py-0.5 outline-none placeholder:text-slate-400"
        value={draft}
        placeholder={values.length ? "" : "Add a topic"}
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => addTags(draft)}
      />
    </div>
  );
}
