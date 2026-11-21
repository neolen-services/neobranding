// Brand kit types and validation, shared by the main process and the UI.

export type ColorRole = "primary" | "secondary" | "accent" | "text" | "background";

export type VoiceTrait = { trait: string; description: string };
export type Pillar = { title: string; topic: string; description: string };
export type BrandColor = { role: ColorRole; name: string; hex: string };
export type PlatformProfile = { platform: string; handle: string; focus: string; bio: string };

export type BrandKit = {
  name: string;
  /** Subjects the brand covers, e.g. "Health", "AI". */
  topics: string[];
  /** What the user wants to achieve (picked from GOAL_OPTIONS). */
  goals: string[];
  /** What success looks like, in the user's own words. */
  goalDetails: string;
  audience: string;
  tagline: string;
  positioning: string;
  mission: string;
  bio: string;
  pillars: Pillar[];
  voice: VoiceTrait[];
  platforms: PlatformProfile[];
  colors: BrandColor[];
};

export type SaveResult = { ok: true; brand: BrandKit } | { ok: false; error: string };

export const GOAL_OPTIONS = [
  "Grow an audience",
  "Build authority and trust",
  "Educate people",
  "Build a community",
  "Earn income from content",
  "Attract clients or customers",
  "Land brand partnerships",
];

/** Bio / headline character limits per platform. */
export const BIO_LIMITS: Record<string, number> = {
  Instagram: 150,
  YouTube: 1000,
  LinkedIn: 220,
  "X (Twitter)": 160,
  Facebook: 101,
  TikTok: 80,
};

export const PLATFORM_OPTIONS = Object.keys(BIO_LIMITS);

export const DEFAULT_COLORS: BrandColor[] = [
  { role: "primary", name: "Vital Teal", hex: "#0F766E" },
  { role: "secondary", name: "Signal Indigo", hex: "#4F46E5" },
  { role: "accent", name: "Pulse Coral", hex: "#F9735B" },
  { role: "text", name: "Ink", hex: "#0F172A" },
  { role: "background", name: "Mist", hex: "#F1F5F9" },
];

export function emptyBrandKit(): BrandKit {
  return {
    name: "",
    topics: [],
    goals: [],
    goalDetails: "",
    audience: "",
    tagline: "",
    positioning: "",
    mission: "",
    bio: "",
    pillars: [],
    voice: [],
    platforms: [],
    colors: DEFAULT_COLORS.map((c) => ({ ...c })),
  };
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const strings = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(str).filter(Boolean))] : []);
const objects = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : [];

/** Validates and normalises untrusted input. Throws with a readable message. */
export function parseBrandKit(input: unknown): BrandKit {
  const i = (input ?? {}) as Record<string, unknown>;
  const name = str(i.name);
  if (!name) throw new Error("Your name is required.");

  const colors = DEFAULT_COLORS.map((fallback) => {
    const c = objects(i.colors).find((x) => x.role === fallback.role);
    const hex = str(c?.hex);
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
      throw new Error(`The ${fallback.role} colour must be a 6-digit hex value like #0F766E.`);
    }
    return { role: fallback.role, name: str(c?.name) || fallback.name, hex: hex.toUpperCase() };
  });

  return {
    name,
    topics: strings(i.topics),
    goals: strings(i.goals),
    goalDetails: str(i.goalDetails),
    audience: str(i.audience),
    tagline: str(i.tagline),
    positioning: str(i.positioning),
    mission: str(i.mission),
    bio: str(i.bio),
    pillars: objects(i.pillars)
      .map((p) => ({ title: str(p.title), topic: str(p.topic), description: str(p.description) }))
      .filter((p) => p.title),
    voice: objects(i.voice)
      .map((v) => ({ trait: str(v.trait), description: str(v.description) }))
      .filter((v) => v.trait),
    platforms: objects(i.platforms)
      .map((p) => ({
        platform: str(p.platform),
        handle: str(p.handle),
        focus: str(p.focus),
        bio: str(p.bio),
      }))
      .filter((p) => p.platform),
    colors,
  };
}
