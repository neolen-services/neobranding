import type { CSSProperties } from "react";
import type { BrandKit } from "@shared/brand";

/**
 * CSS variables that theme the app. Surfaces are a fixed warm dark scale;
 * the brand supplies the three accent colours. The brand's own text and
 * background colours are part of the kit but are not used for the app's chrome.
 */
export function brandVars(brand: BrandKit): CSSProperties {
  const color = (role: string) => brand.colors.find((c) => c.role === role)?.hex ?? "#888888";
  return {
    "--primary": color("primary"),
    "--secondary": color("secondary"),
    "--accent": color("accent"),
    // Brand colours lightened enough to read as text on dark surfaces.
    "--secondary-text": "color-mix(in srgb, var(--secondary) 55%, white)",
    "--frame": "#0A0908",
    "--bg": "#12100E",
    "--surface": "#1A1715",
    "--tint": "#24201D",
    "--line": "rgba(255, 255, 255, 0.1)",
    "--ink": "#F5F5F4",
    colorScheme: "dark",
  } as CSSProperties;
}
