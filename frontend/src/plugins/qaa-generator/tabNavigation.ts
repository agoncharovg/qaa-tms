import { PluginId, type TabId as TabIdType } from "@/constants";
import { useUiStore } from "@/store/uiStoreCore";

export function useActivateQaaGeneratorTab() {
  const openTab = useUiStore((state) => state.openTab);

  // `openTab` opens the tab if it isn't open yet and always makes it active, so it
  // covers both cases. The previous switchTab branch relied on a render-captured
  // snapshot of the plugin's open tabs, and switchTab silently no-ops when that
  // tab is not present in the live state — which could drop the auto-switch to the
  // Live tab after starting a run. openTab has no such guard.
  return (tabId: TabIdType): void => {
    openTab(PluginId.QAA_GENERATOR, tabId);
  };
}
