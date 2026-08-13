import { useEffect } from "react";
import { MantineProvider, createTheme } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";

import { AppRoutes } from "@/app/routes";
import { brandColors, darkShades } from "@/app/theme/tokens";
import { useAuthStore } from "@/store/authStore";
import { useUiStore } from "@/store/uiStoreCore";

const theme = createTheme({
  colors: {
    brand: brandColors,
    dark: darkShades,
  },
  defaultRadius: "md",
  fontFamily:
    "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  primaryColor: "brand",
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

function AuthBootstrap() {
  const initialize = useAuthStore((state) => state.initialize);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  return <AppRoutes />;
}

export default function App() {
  const colorScheme = useUiStore((state) => state.colorScheme);

  return (
    <QueryClientProvider client={queryClient}>
      <MantineProvider forceColorScheme={colorScheme} theme={theme}>
        <Notifications />
        <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          <AuthBootstrap />
        </BrowserRouter>
      </MantineProvider>
    </QueryClientProvider>
  );
}
