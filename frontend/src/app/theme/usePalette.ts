import { useMantineColorScheme } from "@mantine/core";

import { getPalette, type Palette } from "@/app/theme/tokens";

/** Returns the token set for the active colour scheme, re-rendering on toggle. */
export function usePalette(): Palette {
  const { colorScheme } = useMantineColorScheme();
  return getPalette(colorScheme === "auto" ? "light" : colorScheme);
}
