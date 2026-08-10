import { create } from "zustand";

import { backendClient } from "@/api/backendClient";
import type { LoginRequest, User } from "@/api/types";
import { StorageKey } from "@/constants";

type RememberedCredentials = {
  password: string;
  rememberCredentials: boolean;
  username: string;
};

type LoginPreferences = {
  autoLogin: boolean;
  rememberCredentials: boolean;
};

interface AuthState {
  autoLogin: boolean;
  currentUser: User | null;
  initialize: () => Promise<void>;
  isBootstrapping: boolean;
  isHydrated: boolean;
  login: (credentials: LoginRequest, preferences: LoginPreferences) => Promise<User>;
  logout: () => void;
  rememberCredentials: boolean;
  rememberedPassword: string;
  rememberedUsername: string;
  setCurrentUser: (user: User | null) => void;
  setEnabledPlugins: (enabledPlugins: User["enabled_plugins"]) => void;
  token: string | null;
}

const defaultRememberedCredentials: RememberedCredentials = {
  password: "",
  rememberCredentials: false,
  username: "",
};

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readStoredToken(): string | null {
  if (!isBrowser()) {
    return null;
  }

  return window.localStorage.getItem(StorageKey.TOKEN);
}

function writeStoredToken(token: string | null): void {
  if (!isBrowser()) {
    return;
  }

  if (token) {
    window.localStorage.setItem(StorageKey.TOKEN, token);
    return;
  }

  window.localStorage.removeItem(StorageKey.TOKEN);
}

function readStoredAutoLogin(): boolean {
  if (!isBrowser()) {
    return false;
  }

  return window.localStorage.getItem(StorageKey.AUTO_LOGIN) === "true";
}

function writeStoredAutoLogin(autoLogin: boolean): void {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(StorageKey.AUTO_LOGIN, String(autoLogin));
}

function readStoredRememberedCredentials(): RememberedCredentials {
  if (!isBrowser()) {
    return defaultRememberedCredentials;
  }

  const rawValue = window.localStorage.getItem(StorageKey.REMEMBER_ME);
  if (!rawValue) {
    return defaultRememberedCredentials;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<RememberedCredentials>;
    return {
      password: parsed.password ?? "",
      rememberCredentials: parsed.rememberCredentials === true,
      username: parsed.username ?? "",
    };
  } catch {
    return defaultRememberedCredentials;
  }
}

function writeStoredRememberedCredentials(
  username: string,
  password: string,
  rememberCredentials: boolean
): void {
  if (!isBrowser()) {
    return;
  }

  if (!rememberCredentials) {
    window.localStorage.removeItem(StorageKey.REMEMBER_ME);
    return;
  }

  window.localStorage.setItem(
    StorageKey.REMEMBER_ME,
    JSON.stringify({
      password,
      rememberCredentials,
      username,
    } satisfies RememberedCredentials)
  );
}

const initialRememberedCredentials = readStoredRememberedCredentials();
const initialAutoLogin = readStoredAutoLogin();

const initialAuthState = {
  autoLogin: initialAutoLogin,
  currentUser: null,
  isBootstrapping: false,
  isHydrated: false,
  rememberCredentials: initialRememberedCredentials.rememberCredentials,
  rememberedPassword: initialRememberedCredentials.password,
  rememberedUsername: initialRememberedCredentials.username,
  token: readStoredToken(),
} satisfies Omit<
  AuthState,
  "initialize" | "login" | "logout" | "setCurrentUser" | "setEnabledPlugins"
>;

export const useAuthStore = create<AuthState>()((set, get) => ({
  ...initialAuthState,

  async initialize() {
    if (get().isBootstrapping) {
      return;
    }

    set({
      isBootstrapping: true,
      isHydrated: true,
    });

    const storedToken = readStoredToken();
    if (storedToken) {
      try {
        const currentUser = await backendClient.getCurrentUser(storedToken);
        set({
          currentUser,
          isBootstrapping: false,
          token: storedToken,
        });
        return;
      } catch {
        writeStoredToken(null);
      }
    }

    const rememberedCredentials = readStoredRememberedCredentials();
    const autoLogin = readStoredAutoLogin();

    set({
      autoLogin,
      rememberCredentials: rememberedCredentials.rememberCredentials,
      rememberedPassword: rememberedCredentials.password,
      rememberedUsername: rememberedCredentials.username,
      token: null,
    });

    if (
      autoLogin &&
      rememberedCredentials.rememberCredentials &&
      rememberedCredentials.username.length > 0
    ) {
      try {
        await get().login(
          {
            password: rememberedCredentials.password,
            username: rememberedCredentials.username,
          },
          {
            autoLogin: true,
            rememberCredentials: true,
          }
        );
      } catch {
        writeStoredToken(null);
      }
    }

    set({
      isBootstrapping: false,
      isHydrated: true,
    });
  },

  async login(credentials, preferences) {
    const response = await backendClient.login(credentials);

    writeStoredToken(response.access_token);
    writeStoredAutoLogin(preferences.rememberCredentials && preferences.autoLogin);
    writeStoredRememberedCredentials(
      credentials.username,
      credentials.password,
      preferences.rememberCredentials
    );

    set({
      autoLogin: preferences.rememberCredentials && preferences.autoLogin,
      currentUser: response.user,
      rememberCredentials: preferences.rememberCredentials,
      rememberedPassword: preferences.rememberCredentials ? credentials.password : "",
      rememberedUsername: preferences.rememberCredentials ? credentials.username : "",
      token: response.access_token,
    });

    return response.user;
  },

  logout() {
    writeStoredToken(null);
    set({
      currentUser: null,
      token: null,
    });
  },

  setCurrentUser(user) {
    set({
      currentUser: user,
    });
  },

  setEnabledPlugins(enabledPlugins) {
    set((state) => {
      if (!state.currentUser) {
        return state;
      }

      return {
        currentUser: {
          ...state.currentUser,
          enabled_plugins: enabledPlugins,
        },
      };
    });
  },
}));

export function resetAuthStoreState(): void {
  writeStoredToken(null);
  writeStoredAutoLogin(false);
  if (isBrowser()) {
    window.localStorage.removeItem(StorageKey.REMEMBER_ME);
  }

  useAuthStore.setState({
    ...defaultRememberedCredentials,
    autoLogin: false,
    currentUser: null,
    isBootstrapping: false,
    isHydrated: true,
    token: null,
  });
}
