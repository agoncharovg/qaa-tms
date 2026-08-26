import {
  CONTRACT_VERSION,
  IconName,
  PluginId,
  PluginOrigin,
  TabId,
  TabTitle,
  ViewKey,
} from "@/constants";
import { definePlugin } from "@/core/plugins/definePlugin";
import { PluginKind } from "@/core/plugins/types";

import { NotebookSection } from "@/plugins/notebook/NotebookSection";

const NOTEBOOK_PLUGIN_ORDER = 28 as const;
const NOTEBOOK_PLUGIN_ROUTE = "/notebook" as const;

const notebookPlugin = definePlugin({
  contractVersion: CONTRACT_VERSION,
  id: PluginId.NOTEBOOK,
  icon: IconName.NOTEBOOK,
  kind: PluginKind.OPTIONAL,
  label: "Notebook",
  origin: PluginOrigin.BUILTIN,
  order: NOTEBOOK_PLUGIN_ORDER,
  requiresAgent: true,
  route: NOTEBOOK_PLUGIN_ROUTE,
  tabs: [
    {
      id: TabId.NOTEBOOK_BROWSE,
      title: TabTitle[TabId.NOTEBOOK_BROWSE],
      viewKey: ViewKey.NOTEBOOK_BROWSE,
      element: <NotebookSection mode={ViewKey.NOTEBOOK_BROWSE} />,
    },
    {
      id: TabId.NOTEBOOK_SEARCH,
      title: TabTitle[TabId.NOTEBOOK_SEARCH],
      viewKey: ViewKey.NOTEBOOK_SEARCH,
      element: <NotebookSection mode={ViewKey.NOTEBOOK_SEARCH} />,
    },
  ],
});

export default notebookPlugin;
