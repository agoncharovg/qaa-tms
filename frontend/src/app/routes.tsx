import { Navigate, useRoutes } from "react-router-dom";
import type { RouteObject } from "react-router-dom";

import { AppLayout } from "@/app/layout/AppLayout";
import { RequireAdmin, RequireAuth } from "@/app/guards";
import { LoginPage } from "@/features/auth/LoginPage";
import { RoutePath } from "@/constants";

const appRoutes: RouteObject[] = [
  {
    element: <LoginPage />,
    path: RoutePath.LOGIN,
  },
  {
    element: (
      <RequireAuth>
        <Navigate replace to={RoutePath.STAGINGS} />
      </RequireAuth>
    ),
    path: RoutePath.ROOT,
  },
  {
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    path: RoutePath.STAGINGS,
  },
  {
    element: (
      <RequireAuth>
        <RequireAdmin>
          <Navigate replace to={RoutePath.ADMIN_USERS} />
        </RequireAdmin>
      </RequireAuth>
    ),
    path: RoutePath.ADMIN,
  },
  {
    element: (
      <RequireAuth>
        <RequireAdmin>
          <AppLayout />
        </RequireAdmin>
      </RequireAuth>
    ),
    path: RoutePath.ADMIN_USERS,
  },
  {
    element: <Navigate replace to={RoutePath.ROOT} />,
    path: "*",
  },
];

export function AppRoutes() {
  return useRoutes(appRoutes);
}
