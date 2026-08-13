/**
 * Portal palette — the Gcore-like light theme, centralised so the shell
 * (header / navbar / workspace) and, later, plugin surfaces share one source.
 * Swap these values (or wire them to Mantine CSS variables) to re-skin the app.
 */
export const palette = {
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
} as const;

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
