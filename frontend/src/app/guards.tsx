import type { PropsWithChildren } from "react";
import { Center, Loader } from "@mantine/core";
import { Navigate, Outlet } from "react-router-dom";

import { RoutePath } from "@/constants";
import { useAuthStore } from "@/store/authStore";

function GuardLoader() {
  return (
    <Center h="100vh">
      <Loader size="lg" />
    </Center>
  );
}

export function RequireAuth({ children }: PropsWithChildren) {
  const token = useAuthStore((state) => state.token);
  const isHydrated = useAuthStore((state) => state.isHydrated);
  const isBootstrapping = useAuthStore((state) => state.isBootstrapping);

  if (!isHydrated || isBootstrapping) {
    return <GuardLoader />;
  }

  if (!token) {
    return <Navigate replace to={RoutePath.LOGIN} />;
  }

  return children ? <>{children}</> : <Outlet />;
}

export function RequireAdmin({ children }: PropsWithChildren) {
  const currentUser = useAuthStore((state) => state.currentUser);

  if (!currentUser?.is_admin) {
    return <Navigate replace to={RoutePath.STAGINGS} />;
  }

  return children ? <>{children}</> : <Outlet />;
}
