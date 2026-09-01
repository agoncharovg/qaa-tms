import { createContext, createElement, useContext, useEffect, useRef, type ReactNode } from "react";
import { useMantineTheme, type MantineTheme } from "@mantine/core";
import { useNavigate } from "react-router-dom";

import { CONTRACT_VERSION, type TabId, type ViewKey } from "@/constants";
import { pluginById } from "@/plugins/catalog";
import { getTabDefinitions } from "@/plugins/pluginRegistryStore";
import { useUiStore } from "@/store/uiStore";

export type Unmount = () => void;

export interface ThemeTokens {
  colorScheme: string;
  primaryColor: string;
  background: string;
  surface: string;
  text: string;
  dimmed: string;
  border: string;
  radius: string;
  spacing: string;
  fontFamily: string;
}

export interface HostApi {
  contractVersion: number;
  theme: {
    getTokens(): ThemeTokens;
    subscribe(cb: (tokens: ThemeTokens) => void): Unmount;
  };
  view: {
    setTitle(title: string): void;
    setBusy(busy: boolean): void;
    requestResize(px: number): void;
  };
  nav: {
    openTab?(tabId: TabId): void;
  };
}

export interface MountContext {
  container: HTMLElement;
  viewKey: ViewKey;
  host: HostApi;
  agentBaseUrl?: string;
}

interface BuiltinHostApiProviderProps {
  children: ReactNode;
}

function toCssValue(value: string | number): string {
  return typeof value === "number" ? `${value}px` : value;
}

function getPrimaryShadeIndex(theme: MantineTheme): number {
  return typeof theme.primaryShade === "number" ? theme.primaryShade : theme.primaryShade.dark;
}

function getThemeTokens(theme: MantineTheme): ThemeTokens {
  const primaryShadeIndex = getPrimaryShadeIndex(theme);
  const primaryPalette = theme.colors[theme.primaryColor] ?? theme.colors.blue;

  return {
    background: theme.colors.dark[8],
    border: theme.colors.dark[4],
    colorScheme: "dark",
    dimmed: theme.colors.gray[5],
    fontFamily: theme.fontFamily,
    primaryColor: primaryPalette[primaryShadeIndex] ?? primaryPalette[0],
    radius: toCssValue(theme.defaultRadius),
    spacing: toCssValue(theme.spacing.md),
    surface: theme.colors.dark[7],
    text: theme.white,
  };
}

function noop(): void {}

const DEFAULT_THEME_TOKENS: ThemeTokens = {
  background: "#101113",
  border: "#373a40",
  colorScheme: "dark",
  dimmed: "#909296",
  fontFamily: "sans-serif",
  primaryColor: "#228be6",
  radius: "8px",
  spacing: "16px",
  surface: "#1a1b1e",
  text: "#ffffff",
};

const NOOP_HOST_API: HostApi = {
  contractVersion: CONTRACT_VERSION,
  nav: {},
  theme: {
    getTokens() {
      return DEFAULT_THEME_TOKENS;
    },
    subscribe() {
      return noop;
    },
  },
  view: {
    requestResize: noop,
    setBusy: noop,
    setTitle: noop,
  },
};

const BuiltinHostApiContext = createContext<HostApi>(NOOP_HOST_API);

export function BuiltinHostApiProvider({ children }: BuiltinHostApiProviderProps) {
  const theme = useMantineTheme();
  const navigate = useNavigate();
  const openTab = useUiStore((state) => state.openTab);
  const themeTokens = getThemeTokens(theme);
  const themeSignature = JSON.stringify(themeTokens);
  const subscribersRef = useRef(new Set<(tokens: ThemeTokens) => void>());
  const themeTokensRef = useRef(themeTokens);
  const hostApiRef = useRef<HostApi>({
    contractVersion: CONTRACT_VERSION,
    nav: {
      openTab(tabId) {
        const tab = getTabDefinitions()[tabId];
        if (!tab) {
          return;
        }

        openTab(tab.pluginId, tabId);

        const plugin = pluginById(tab.pluginId);
        if (plugin) {
          navigate(plugin.route);
        }
      },
    },
    theme: {
      getTokens() {
        return themeTokensRef.current;
      },
      subscribe(cb) {
        subscribersRef.current.add(cb);
        return () => {
          subscribersRef.current.delete(cb);
        };
      },
    },
    view: {
      requestResize: noop,
      setBusy: noop,
      setTitle: noop,
    },
  });

  themeTokensRef.current = themeTokens;

  useEffect(() => {
    for (const subscriber of subscribersRef.current) {
      subscriber(themeTokensRef.current);
    }
  }, [themeSignature]);

  return createElement(BuiltinHostApiContext.Provider, { value: hostApiRef.current }, children);
}

export function useBuiltinHostApi(): HostApi {
  return useContext(BuiltinHostApiContext);
}
