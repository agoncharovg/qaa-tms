import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/plugins/profile/AccountPanel", () => ({
  AccountPanel: () => <div>Account panel body</div>,
}));

vi.mock("@/plugins/profile/PluginsPanel", () => ({
  PluginsPanel: () => <div>Plugins panel body</div>,
}));

vi.mock("@/plugins/profile/SettingsPanel", () => ({
  SettingsPanel: () => <div>Settings panel body</div>,
}));

import { ProfilePage } from "@/plugins/profile/ProfilePage";
import { renderWithProviders } from "@/test/render";

const ProfilePageTestCopy = {
  ACCOUNT_PANEL: "Account panel body",
  PLUGINS_PANEL: "Plugins panel body",
  SETTINGS_PANEL: "Settings panel body",
  SETTINGS_SECTION_LABEL: "Open Settings profile section",
  PLUGINS_SECTION_LABEL: "Open Plugins profile section",
} as const;

describe("ProfilePage", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.pushState({}, "", "/profile");
  });

  it("shows the Account section by default and switches sections from the nested menu", async () => {
    const user = userEvent.setup();

    renderWithProviders(<ProfilePage />);

    expect(screen.getByText(ProfilePageTestCopy.ACCOUNT_PANEL)).toBeInTheDocument();
    expect(screen.queryByText(ProfilePageTestCopy.PLUGINS_PANEL)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: ProfilePageTestCopy.PLUGINS_SECTION_LABEL }));
    expect(screen.getByText(ProfilePageTestCopy.PLUGINS_PANEL)).toBeInTheDocument();
    expect(screen.queryByText(ProfilePageTestCopy.ACCOUNT_PANEL)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: ProfilePageTestCopy.SETTINGS_SECTION_LABEL }));
    expect(screen.getByText(ProfilePageTestCopy.SETTINGS_PANEL)).toBeInTheDocument();
    expect(screen.queryByText(ProfilePageTestCopy.PLUGINS_PANEL)).not.toBeInTheDocument();
  });

  it("opens the Settings section from the section query parameter", () => {
    window.history.pushState({}, "", "/profile?section=settings");

    renderWithProviders(<ProfilePage />);

    expect(screen.getByText(ProfilePageTestCopy.SETTINGS_PANEL)).toBeInTheDocument();
    expect(screen.queryByText(ProfilePageTestCopy.ACCOUNT_PANEL)).not.toBeInTheDocument();
  });

  it("persists the selected section into the URL so it survives a reload", async () => {
    const user = userEvent.setup();

    renderWithProviders(<ProfilePage />);

    await user.click(screen.getByRole("button", { name: ProfilePageTestCopy.SETTINGS_SECTION_LABEL }));

    // The URL now carries the section, so remounting (F5) restores Settings, not Account.
    expect(new URLSearchParams(window.location.search).get("section")).toBe("settings");
    expect(screen.getByText(ProfilePageTestCopy.SETTINGS_PANEL)).toBeInTheDocument();
  });
});
