import type { ReactNode } from "react";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";

import { PluginsProvider } from "@/plugins/provider";

export function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: false,
      },
    },
  });

  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <PluginsProvider>
          <MantineProvider forceColorScheme="dark">
            <Notifications />
            {ui}
          </MantineProvider>
        </PluginsProvider>
      </QueryClientProvider>
    ),
  };
}
