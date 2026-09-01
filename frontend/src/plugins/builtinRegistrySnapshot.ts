import type { WorkspaceTabDefinition } from "@/api/types";
import {
  ContentType,
  PluginId,
  TabId,
  TabTitle,
  ViewKey,
  type PluginId as PluginIdType,
  type TabId as TabIdType,
} from "@/constants";

export const BUILTIN_PLUGIN_IDS: PluginIdType[] = [
  PluginId.STAGINGS,
  PluginId.KUBER,
  PluginId.QAA_GENERATOR,
  PluginId.JENKINS,
  PluginId.LEONID,
  PluginId.NOTIFICATOR,
  PluginId.STATISTICS,
  PluginId.ADMIN,
  PluginId.PROFILE,
];

export const BUILTIN_OPTIONAL_PLUGIN_IDS: PluginIdType[] = [
  PluginId.STAGINGS,
  PluginId.KUBER,
  PluginId.QAA_GENERATOR,
  PluginId.JENKINS,
  PluginId.LEONID,
  PluginId.NOTIFICATOR,
  PluginId.STATISTICS,
];

export const BUILTIN_SYSTEM_PLUGIN_IDS: PluginIdType[] = [PluginId.ADMIN, PluginId.PROFILE];

function createTabDefinition(
  pluginId: PluginIdType,
  tabId: TabIdType,
  viewKey: typeof ViewKey[keyof typeof ViewKey],
  adminOnly?: boolean
): WorkspaceTabDefinition {
  return {
    adminOnly,
    closeable: true,
    contentType: ContentType.REACT_VIEW,
    id: tabId,
    pluginId,
    title: TabTitle[tabId],
    viewKey,
  };
}

export const BUILTIN_TAB_DEFINITIONS = Object.fromEntries([
  [
    TabId.STAGINGS_DEPLOY,
    createTabDefinition(PluginId.STAGINGS, TabId.STAGINGS_DEPLOY, ViewKey.STAGINGS_DEPLOY),
  ],
  [
    TabId.STAGINGS_NAMESPACES,
    createTabDefinition(
      PluginId.STAGINGS,
      TabId.STAGINGS_NAMESPACES,
      ViewKey.STAGINGS_NAMESPACES
    ),
  ],
  [TabId.STAGINGS_E2E, createTabDefinition(PluginId.STAGINGS, TabId.STAGINGS_E2E, ViewKey.STAGINGS_E2E)],
  [
    TabId.KUBE_CLUSTERS,
    createTabDefinition(PluginId.KUBER, TabId.KUBE_CLUSTERS, ViewKey.KUBE_CLUSTERS),
  ],
  [TabId.KUBE_PODS, createTabDefinition(PluginId.KUBER, TabId.KUBE_PODS, ViewKey.KUBE_PODS)],
  [
    TabId.QAA_GENERATE,
    createTabDefinition(PluginId.QAA_GENERATOR, TabId.QAA_GENERATE, ViewKey.QAA_GENERATE),
  ],
  [TabId.QAA_LIVE, createTabDefinition(PluginId.QAA_GENERATOR, TabId.QAA_LIVE, ViewKey.QAA_LIVE)],
  [TabId.QAA_RUNS, createTabDefinition(PluginId.QAA_GENERATOR, TabId.QAA_RUNS, ViewKey.QAA_RUNS)],
  [
    TabId.QAA_ADMIN,
    createTabDefinition(PluginId.QAA_GENERATOR, TabId.QAA_ADMIN, ViewKey.QAA_ADMIN, true),
  ],
  [
    TabId.JENKINS_TREE,
    createTabDefinition(PluginId.JENKINS, TabId.JENKINS_TREE, ViewKey.JENKINS_TREE),
  ],
  [
    TabId.JENKINS_BOARD,
    createTabDefinition(PluginId.JENKINS, TabId.JENKINS_BOARD, ViewKey.JENKINS_BOARD),
  ],
  [
    TabId.LEONID_SHARED_RESOURCES,
    createTabDefinition(
      PluginId.LEONID,
      TabId.LEONID_SHARED_RESOURCES,
      ViewKey.LEONID_SHARED_RESOURCES
    ),
  ],
  [
    TabId.LEONID_SKIPPED_TESTS,
    createTabDefinition(PluginId.LEONID, TabId.LEONID_SKIPPED_TESTS, ViewKey.LEONID_SKIPPED_TESTS),
  ],
  [TabId.LEONID_OBJECTS, createTabDefinition(PluginId.LEONID, TabId.LEONID_OBJECTS, ViewKey.LEONID_OBJECTS)],
  [
    TabId.LEONID_PIPELINE_CONFIGS,
    createTabDefinition(
      PluginId.LEONID,
      TabId.LEONID_PIPELINE_CONFIGS,
      ViewKey.LEONID_PIPELINE_CONFIGS
    ),
  ],
  [
    TabId.NOTIFICATOR_CONTRACT_MANAGER,
    createTabDefinition(
      PluginId.NOTIFICATOR,
      TabId.NOTIFICATOR_CONTRACT_MANAGER,
      ViewKey.NOTIFICATOR_CONTRACT_MANAGER
    ),
  ],
  [
    TabId.NOTIFICATOR_NOTIFICATIONS,
    createTabDefinition(
      PluginId.NOTIFICATOR,
      TabId.NOTIFICATOR_NOTIFICATIONS,
      ViewKey.NOTIFICATOR_NOTIFICATIONS
    ),
  ],
  [
    TabId.STATISTICS_SMOKE,
    createTabDefinition(PluginId.STATISTICS, TabId.STATISTICS_SMOKE, ViewKey.STATISTICS_SMOKE),
  ],
  [
    TabId.ADMIN_SECURITY,
    createTabDefinition(PluginId.ADMIN, TabId.ADMIN_SECURITY, ViewKey.ADMIN_SECURITY, true),
  ],
  [
    TabId.ADMIN_INTEGRATIONS,
    createTabDefinition(
      PluginId.ADMIN,
      TabId.ADMIN_INTEGRATIONS,
      ViewKey.ADMIN_INTEGRATIONS,
      true
    ),
  ],
  [TabId.PROFILE, createTabDefinition(PluginId.PROFILE, TabId.PROFILE, ViewKey.PROFILE)],
]) as Record<TabIdType, WorkspaceTabDefinition>;

export const BUILTIN_TAB_CATALOG: Record<PluginIdType, TabIdType[]> = {
  [PluginId.STAGINGS]: [TabId.STAGINGS_DEPLOY, TabId.STAGINGS_NAMESPACES, TabId.STAGINGS_E2E],
  [PluginId.KUBER]: [TabId.KUBE_CLUSTERS, TabId.KUBE_PODS],
  [PluginId.QAA_GENERATOR]: [TabId.QAA_GENERATE, TabId.QAA_LIVE, TabId.QAA_RUNS, TabId.QAA_ADMIN],
  [PluginId.JENKINS]: [TabId.JENKINS_TREE, TabId.JENKINS_BOARD],
  [PluginId.LEONID]: [
    TabId.LEONID_SHARED_RESOURCES,
    TabId.LEONID_SKIPPED_TESTS,
    TabId.LEONID_OBJECTS,
    TabId.LEONID_PIPELINE_CONFIGS,
  ],
  [PluginId.NOTIFICATOR]: [
    TabId.NOTIFICATOR_CONTRACT_MANAGER,
    TabId.NOTIFICATOR_NOTIFICATIONS,
  ],
  [PluginId.STATISTICS]: [TabId.STATISTICS_SMOKE],
  [PluginId.ADMIN]: [TabId.ADMIN_SECURITY, TabId.ADMIN_INTEGRATIONS],
  [PluginId.PROFILE]: [TabId.PROFILE],
};

export const BUILTIN_DEFAULT_TAB_ID_BY_PLUGIN: Record<PluginIdType, TabIdType | null> = {
  [PluginId.STAGINGS]: TabId.STAGINGS_DEPLOY,
  [PluginId.KUBER]: TabId.KUBE_CLUSTERS,
  [PluginId.QAA_GENERATOR]: TabId.QAA_GENERATE,
  [PluginId.JENKINS]: TabId.JENKINS_TREE,
  [PluginId.LEONID]: TabId.LEONID_SHARED_RESOURCES,
  [PluginId.NOTIFICATOR]: TabId.NOTIFICATOR_CONTRACT_MANAGER,
  [PluginId.STATISTICS]: TabId.STATISTICS_SMOKE,
  [PluginId.ADMIN]: TabId.ADMIN_SECURITY,
  [PluginId.PROFILE]: TabId.PROFILE,
};
