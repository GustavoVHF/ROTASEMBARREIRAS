/**
 * Central de Acessibilidade — single source of truth for the visual/reading
 * settings and for the CSS classes that apply them.
 *
 * HOW IT WORKS: every setting maps to a plain class on the app container
 * (src/app/page.tsx). All the actual styling lives in src/app/globals.css,
 * so nothing is hardcoded per component and turning a setting off restores
 * the original design exactly — no inline styles are ever written to
 * elements. Persistence is the existing public.accessibility_preferences
 * row (see supabase/migrations_acessibilidade_central.sql), so the settings
 * follow the user across pages and sessions.
 */

export type FontScale = "normal" | "lg" | "xl";
/** Saturação das cores aplicada via filter no container do app. */
export type ColorSaturation = "normal" | "high" | "low" | "grayscale";
/** Espaçamento entre letras/palavras. "tight" reduz, "wide"/"wider" aumentam. */
export type TextSpacing = "tight" | "normal" | "wide" | "wider";
/** Altura da linha dos conteúdos textuais. */
export type LineHeightPref = "normal" | "relaxed" | "loose";

export interface AccessibilitySettings {
  highContrast: boolean;
  fontScale: FontScale;
  voiceReading: boolean;
  reduceMotion: boolean;
  saturation: ColorSaturation;
  textSpacing: TextSpacing;
  lineHeight: LineHeightPref;
  hideImages: boolean;
  dyslexiaMode: boolean;
}

export const DEFAULT_ACCESSIBILITY_SETTINGS: AccessibilitySettings = {
  highContrast: false,
  fontScale: "normal",
  voiceReading: false,
  reduceMotion: false,
  saturation: "normal",
  textSpacing: "normal",
  lineHeight: "normal",
  hideImages: false,
  dyslexiaMode: false,
};

export const FONT_SCALE_OPTIONS: Array<{ value: FontScale; label: string }> = [
  { value: "normal", label: "Padrão" },
  { value: "lg", label: "Grande" },
  { value: "xl", label: "Extra G." },
];

export const SATURATION_OPTIONS: Array<{ value: ColorSaturation; label: string }> = [
  { value: "normal", label: "Normal" },
  { value: "high", label: "Alta" },
  { value: "low", label: "Baixa" },
  { value: "grayscale", label: "Cinza" },
];

export const TEXT_SPACING_OPTIONS: Array<{ value: TextSpacing; label: string }> = [
  { value: "tight", label: "Compacto" },
  { value: "normal", label: "Padrão" },
  { value: "wide", label: "Amplo" },
  { value: "wider", label: "Extra" },
];

export const LINE_HEIGHT_OPTIONS: Array<{ value: LineHeightPref; label: string }> = [
  { value: "normal", label: "Padrão" },
  { value: "relaxed", label: "Média" },
  { value: "loose", label: "Alta" },
];

/**
 * Saturation and high contrast would fight each other: high contrast repaints
 * everything black/yellow, and a saturate()/grayscale() filter on top of that
 * either does nothing or destroys the yellow that carries the contrast. So
 * while high contrast is on, saturation is forced back to "normal" — the UI
 * says so instead of silently ignoring the choice.
 */
export function effectiveSaturation(settings: AccessibilitySettings): ColorSaturation {
  return settings.highContrast ? "normal" : settings.saturation;
}

/**
 * Builds the container className. Order in the string is irrelevant — the
 * cascade order that matters (dyslexia baseline first, explicit
 * spacing/line-height overrides after) is defined in globals.css.
 */
export function buildAccessibilityClassName(settings: AccessibilitySettings): string {
  const classes: string[] = [];

  if (settings.highContrast) classes.push("theme-high-contrast");
  if (settings.fontScale === "lg") classes.push("font-scale-lg");
  if (settings.fontScale === "xl") classes.push("font-scale-xl");
  if (settings.reduceMotion) classes.push("reduce-motion");

  const saturation = effectiveSaturation(settings);
  if (saturation !== "normal") classes.push(`saturation-${saturation}`);

  if (settings.textSpacing !== "normal") classes.push(`text-spacing-${settings.textSpacing}`);
  if (settings.lineHeight !== "normal") classes.push(`line-height-${settings.lineHeight}`);
  if (settings.hideImages) classes.push("hide-images");
  if (settings.dyslexiaMode) classes.push("dyslexia-mode");

  return classes.join(" ");
}
