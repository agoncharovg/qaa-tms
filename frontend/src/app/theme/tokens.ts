/**
 * Portal palettes — the shell (header / navbar / workspace) reads these tokens
 * through usePalette(), which picks light or dark from the active colour scheme.
 * The dark palette uses the deep-plum shades sampled from the pipeline deck.
 */
export type ColorScheme = "light" | "dark";

export interface Palette {
  accent: string;
  accentHover: string;
  accentSoft: string;
  ink: string;
  inkSoft: string;
  dim: string;
  faint: string;
  line: string;
  lineSoft: string;
  surface: string;
  page: string;
  chip: string;
  chipHover: string;
  infoBg: string;
  infoBorder: string;
  infoIcon: string;
}

export const lightPalette: Palette = {
  accent: "#ff5913",
  accentHover: "#e64e0c",
  accentSoft: "#fff2ec",
  ink: "#1b1b1f",
  inkSoft: "#3f434a",
  dim: "#6b7280",
  faint: "#9ca3af",
  line: "#e6e7eb",
  lineSoft: "#eef0f3",
  surface: "#ffffff",
  page: "#f5f6f8",
  chip: "#f4f5f7",
  chipHover: "#eceef1",
  infoBg: "#eaf3fb",
  infoBorder: "#cfe4f6",
  infoIcon: "#2b7fce",
};

export const darkPalette: Palette = {
  accent: "#ff6a2b",
  accentHover: "#ff824d",
  accentSoft: "rgba(255, 106, 43, 0.16)",
  ink: "#ece7f1",
  inkSoft: "#c4bacf",
  dim: "#9a8ea9",
  faint: "#6f6379",
  line: "#43324c",
  lineSoft: "#38283a",
  surface: "#38283a",
  page: "#2d1f2f",
  chip: "#3a2a3f",
  chipHover: "#453353",
  infoBg: "rgba(90, 151, 208, 0.14)",
  infoBorder: "rgba(90, 151, 208, 0.4)",
  infoIcon: "#5a97d0",
};

export function getPalette(scheme: ColorScheme): Palette {
  return scheme === "dark" ? darkPalette : lightPalette;
}

/** Mantine 10-shade brand ramp (orange). Index 6 is the primary accent. */
export const brandColors: [
  string, string, string, string, string, string, string, string, string, string,
] = [
  "#fff2ec",
  "#ffe0d2",
  "#ffbfa3",
  "#ff9c70",
  "#ff7e46",
  "#ff6a2b",
  "#ff5913",
  "#e64e0c",
  "#c14109",
  "#9c3406",
];

/**
 * Plum-tinted override of Mantine's `dark` ramp so built-in components
 * (Paper, Table, inputs) adopt the deck's eggplant surfaces in dark mode.
 * dark[7] is the page body, dark[6] the elevated surface, dark[0] the text.
 */
export const darkShades: [
  string, string, string, string, string, string, string, string, string, string,
] = [
  "#ece7f1",
  "#c4bacf",
  "#9a8ea9",
  "#7a6d88",
  "#5d4f6b",
  "#43324c",
  "#38283a",
  "#2d1f2f",
  "#241826",
  "#1a1019",
];
