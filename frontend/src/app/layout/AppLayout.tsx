import { AppShell } from "@mantine/core";
import { useLocation } from "react-router-dom";

import { Sidebar } from "@/app/layout/Sidebar";
import { TabBar } from "@/app/layout/TabBar";
import { Workspace } from "@/app/layout/Workspace";
import { RoutePath, SectionKey, type SectionKey as SectionKeyType } from "@/constants";
import { useUiStore } from "@/store/uiStore";

function getSectionFromPath(pathname: string): SectionKeyType {
  return pathname.startsWith(RoutePath.ADMIN) ? SectionKey.ADMIN : SectionKey.STAGINGS;
}

export function AppLayout() {
  const location = useLocation();
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed);
  const activeSection = getSectionFromPath(location.pathname);

  return (
    <AppShell
      header={{ height: 76 }}
      navbar={{ breakpoint: "sm", width: sidebarCollapsed ? 92 : 280 }}
      padding="md"
      styles={{
        main: {
          background:
            "radial-gradient(circle at top right, rgba(34, 139, 230, 0.14), transparent 30%), #0b1017",
          minHeight: "100vh",
        },
      }}
    >
      <Sidebar activeSection={activeSection} />
      <TabBar activeSection={activeSection} />
      <Workspace activeSection={activeSection} />
    </AppShell>
  );
}
