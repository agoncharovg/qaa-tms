import { Navigate, useRoutes } from "react-router-dom";
import type { RouteObject } from "react-router-dom";

import { RequireAuth } from "@/app/guards";
import { AppLayout } from "@/app/layout/AppLayout";
import { LoginPage } from "@/app/auth/LoginPage";
import { GcoreProfilePoc } from "@/app/design-poc/GcoreProfilePoc";
import { RoutePath } from "@/constants";
import {
  useEnabledOptionalPluginIdSet,
  usePlugins,
  usePrimaryVisiblePlugins,
} from "@/plugins/registry";
import { useAuthStore } from "@/store/authStore";

function RootRedirect() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const enabledOptionalIds = useEnabledOptionalPluginIdSet(currentUser?.enabled_plugins);
  const firstVisiblePlugin = usePrimaryVisiblePlugins(currentUser, enabledOptionalIds)[0];

  return <Navigate replace to={firstVisiblePlugin?.route ?? RoutePath.LOGIN} />;
}

export function AppRoutes() {
  const plugins = usePlugins();
  const appRoutes: RouteObject[] = [
    {
      element: <LoginPage />,
      path: RoutePath.LOGIN,
    },
    {
      element: <GcoreProfilePoc />,
      path: "/design-poc",
    },
    {
      element: (
        <RequireAuth>
          <RootRedirect />
        </RequireAuth>
      ),
      path: RoutePath.ROOT,
    },
    ...plugins.map((plugin) => ({
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

  return useRoutes(appRoutes);
}
