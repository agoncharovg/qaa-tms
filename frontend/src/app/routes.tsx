import { Navigate, useRoutes } from "react-router-dom";
import type { RouteObject } from "react-router-dom";

import { RequireAuth } from "@/app/guards";
import { AppLayout } from "@/app/layout/AppLayout";
import { LoginPage } from "@/app/auth/LoginPage";
import { RoutePath } from "@/constants";
import { enabledOptionalPluginIdSet, PLUGINS, visiblePlugins } from "@/plugins/registry";
import { useAuthStore } from "@/store/authStore";

function RootRedirect() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const enabledOptionalIds = enabledOptionalPluginIdSet(currentUser?.enabled_plugins);
  const firstVisiblePlugin = visiblePlugins(currentUser, enabledOptionalIds)[0];

  return <Navigate replace to={firstVisiblePlugin?.route ?? RoutePath.LOGIN} />;
}

const appRoutes: RouteObject[] = [
  {
    element: <LoginPage />,
    path: RoutePath.LOGIN,
  },
  {
    element: (
      <RequireAuth>
        <RootRedirect />
      </RequireAuth>
    ),
    path: RoutePath.ROOT,
  },
  ...PLUGINS.map((plugin) => ({
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    path: `${plugin.route}/*`,
  })),
  {
    element: <Navigate replace to={RoutePath.ROOT} />,
    path: "*",
  },
];

export function AppRoutes() {
  return useRoutes(appRoutes);
}
