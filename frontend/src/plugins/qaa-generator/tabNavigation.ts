import { flushSync } from "react-dom";

import { PluginId, type TabId as TabIdType } from "@/constants";
import { useUiStore } from "@/store/uiStoreCore";

export function useActivateQaaGeneratorTab() {
  const openTab = useUiStore((state) => state.openTab);

  // `openTab` opens the tab if it isn't open yet and always makes it active, so it
  // covers both cases. The previous switchTab branch relied on a render-captured
  // snapshot of the plugin's open tabs, and switchTab silently no-ops when that
  // tab is not present in the live state — which could drop the auto-switch to the
  // Live tab after starting a run. openTab has no such guard.
  //
  // flushSync forces the Zustand store update to produce a synchronous DOM commit.
  // Without it, the update can be held in the React 18 automatic-batching queue
  // when called from async contexts (React Query onSuccess, drawer close handlers),
  // so Workspace does not re-render and the active tab appears unchanged even
  // though the store holds the correct value.
  return (tabId: TabIdType): void => {
    flushSync(() => {
      openTab(PluginId.QAA_GENERATOR, tabId);
    });
  };
}
