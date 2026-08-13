import { getPalette, type Palette } from "@/app/theme/tokens";
import { useUiStore } from "@/store/uiStoreCore";

/** Returns the token set for the active colour scheme, re-rendering on toggle. */
export function usePalette(): Palette {
  const colorScheme = useUiStore((state) => state.colorScheme);
  return getPalette(colorScheme);
}
