import { useEffect } from "react";
import { MantineProvider, createTheme } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";

import { AppRoutes } from "@/app/routes";
import { useAuthStore } from "@/store/authStore";

const theme = createTheme({
  colors: {
    ocean: [
      "#d6f1ff",
      "#ace2ff",
      "#80d3ff",
      "#52c2ff",
      "#28b3ff",
      "#0e99e6",
      "#0077b4",
      "#005681",
      "#00364f",
      "#001826",
    ],
  },
  defaultRadius: "md",
  primaryColor: "ocean",
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
  return (
    <QueryClientProvider client={queryClient}>
      <MantineProvider defaultColorScheme="dark" forceColorScheme="dark" theme={theme}>
        <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          <AuthBootstrap />
        </BrowserRouter>
      </MantineProvider>
    </QueryClientProvider>
  );
}
