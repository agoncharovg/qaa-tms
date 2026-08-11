import { PluginId, type TabId as TabIdType } from "@/constants";
import { useUiStore } from "@/store/uiStoreCore";

export function useActivateQaaGeneratorTab() {
  const openTab = useUiStore((state) => state.openTab);
  const switchTab = useUiStore((state) => state.switchTab);
  const pluginTabs = useUiStore((state) => state.tabsByPlugin[PluginId.QAA_GENERATOR]);

  return (tabId: TabIdType): void => {
    if (pluginTabs.tabIds.includes(tabId)) {
      switchTab(PluginId.QAA_GENERATOR, tabId);
      return;
    }

    openTab(PluginId.QAA_GENERATOR, tabId);
  };
}
