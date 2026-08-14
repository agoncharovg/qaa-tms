import { useState, type ComponentType } from "react";
import { Box, Group, NavLink, Stack } from "@mantine/core";

import { usePalette } from "@/app/theme/usePalette";
import type { Palette } from "@/app/theme/tokens";
import {
  PROFILE_SECTION_ORDER,
  ProfileSection,
  ProfileSectionLabel,
  type ProfileSection as ProfileSectionType,
} from "@/constants";
import { AccountPanel } from "@/plugins/profile/AccountPanel";
import { PluginsPanel } from "@/plugins/profile/PluginsPanel";
import { SettingsPanel } from "@/plugins/profile/SettingsPanel";

const ProfilePageCopy = {
  SECTION_ARIA_LABEL_PREFIX: "Open ",
  SECTION_ARIA_LABEL_SUFFIX: " profile section",
  SECTION_NAVIGATION: "Profile sections",
} as const;

const PROFILE_CURRENT_PAGE = "page" as const;
const PROFILE_NAV_COMPONENT = "nav" as const;
const PROFILE_NAV_BUTTON_COMPONENT = "button" as const;
const PROFILE_NAV_ALIGNMENT = "flex-start" as const;
const PROFILE_NAV_WRAP = "wrap" as const;
const PROFILE_NAV_INDICATOR_SIZE_PX = 6 as const;
const PROFILE_NAV_PANEL_BORDER_RADIUS = "999px" as const;
const PROFILE_NAV_WIDTH_PX = 216 as const;
const PROFILE_CONTENT_MIN_WIDTH_PX = 320 as const;
const PROFILE_SECTION_BUTTON_BORDER = "1px solid transparent" as const;
const PROFILE_SECTION_BUTTON_BORDER_RADIUS = "8px" as const;
const PROFILE_SECTION_BUTTON_PADDING = "8px 10px" as const;
const PROFILE_SECTION_BUTTON_TRANSITION = "background-color 150ms ease, color 150ms ease" as const;
const PROFILE_SECTION_INACTIVE_BACKGROUND = "transparent" as const;
const PROFILE_SECTION_LABEL_WEIGHT = 500 as const;
const PROFILE_SECTION_ACTIVE_LABEL_WEIGHT = 600 as const;
const PROFILE_SECTION_GAP = 6 as const;
const PROFILE_LAYOUT_GAP = "xl" as const;
const PROFILE_NAV_MARGIN_LEFT = "md" as const;
const PROFILE_NAV_PADDING_LEFT = "md" as const;
const PROFILE_NAV_BORDER_WIDTH = 1 as const;
const PROFILE_MIN_WIDTH = 0 as const;
const PROFILE_FLEX_SHRINK = 0 as const;
const PROFILE_CONTENT_FLEX = `1 1 ${PROFILE_CONTENT_MIN_WIDTH_PX}px` as const;
const PROFILE_NAV_FLEX = `0 0 ${PROFILE_NAV_WIDTH_PX}px` as const;
const PROFILE_NAV_LINE = (palette: Palette) => `${PROFILE_NAV_BORDER_WIDTH}px solid ${palette.line}`;

const PROFILE_SECTION_QUERY_PARAM = "section" as const;

const profilePanelBySection: Record<ProfileSectionType, ComponentType> = {
  [ProfileSection.ACCOUNT]: AccountPanel,
  [ProfileSection.PLUGINS]: PluginsPanel,
  [ProfileSection.SETTINGS]: SettingsPanel,
};

function buildProfileSectionAriaLabel(section: ProfileSectionType): string {
  return `${ProfilePageCopy.SECTION_ARIA_LABEL_PREFIX}${ProfileSectionLabel[section]}${ProfilePageCopy.SECTION_ARIA_LABEL_SUFFIX}`;
}


function resolveInitialProfileSection(): ProfileSectionType {
  if (typeof window === "undefined") {
    return ProfileSection.ACCOUNT;
  }

  const searchParams = new URLSearchParams(window.location.search);
  const requestedSection = searchParams.get(PROFILE_SECTION_QUERY_PARAM);
  if (requestedSection && PROFILE_SECTION_ORDER.includes(requestedSection as ProfileSectionType)) {
    return requestedSection as ProfileSectionType;
  }

  return ProfileSection.ACCOUNT;
}

export function ProfilePage() {
  const palette = usePalette();
  const [activeSection, setActiveSection] = useState<ProfileSectionType>(resolveInitialProfileSection);
  const ActivePanel = profilePanelBySection[activeSection];

  return (
    <Group align={PROFILE_NAV_ALIGNMENT} gap={PROFILE_LAYOUT_GAP} wrap={PROFILE_NAV_WRAP}>
      <Box
        component={PROFILE_NAV_COMPONENT}
        aria-label={ProfilePageCopy.SECTION_NAVIGATION}
        ml={PROFILE_NAV_MARGIN_LEFT}
        miw={PROFILE_NAV_WIDTH_PX}
        pl={PROFILE_NAV_PADDING_LEFT}
        style={{
          borderLeft: PROFILE_NAV_LINE(palette),
          flex: PROFILE_NAV_FLEX,
        }}
      >
        <Stack gap={PROFILE_SECTION_GAP}>
          {PROFILE_SECTION_ORDER.map((section) => {
            const active = section === activeSection;
            return (
              <NavLink
                active={active}
                aria-current={active ? PROFILE_CURRENT_PAGE : undefined}
                aria-label={buildProfileSectionAriaLabel(section)}
                component={PROFILE_NAV_BUTTON_COMPONENT}
                key={section}
                label={ProfileSectionLabel[section]}
                leftSection={
                  <Box
                    aria-hidden="true"
                    h={PROFILE_NAV_INDICATOR_SIZE_PX}
                    style={{
                      backgroundColor: active ? palette.accent : palette.faint,
                      borderRadius: PROFILE_NAV_PANEL_BORDER_RADIUS,
                      flexShrink: PROFILE_FLEX_SHRINK,
                    }}
                    w={PROFILE_NAV_INDICATOR_SIZE_PX}
                  />
                }
                onClick={() => setActiveSection(section)}
                styles={{
                  label: {
                    fontWeight: active ? PROFILE_SECTION_ACTIVE_LABEL_WEIGHT : PROFILE_SECTION_LABEL_WEIGHT,
                  },
                  root: {
                    backgroundColor: active ? palette.accentSoft : PROFILE_SECTION_INACTIVE_BACKGROUND,
                    border: PROFILE_SECTION_BUTTON_BORDER,
                    borderRadius: PROFILE_SECTION_BUTTON_BORDER_RADIUS,
                    color: active ? palette.accent : palette.inkSoft,
                    padding: PROFILE_SECTION_BUTTON_PADDING,
                    transition: PROFILE_SECTION_BUTTON_TRANSITION,
                    "&:hover": {
                      backgroundColor: active ? palette.accentSoft : palette.chip,
                    },
                  },
                }}
                type="button"
                variant="subtle"
              />
            );
          })}
        </Stack>
      </Box>

      <Box
        style={{
          flex: PROFILE_CONTENT_FLEX,
          minWidth: PROFILE_MIN_WIDTH,
        }}
      >
        <ActivePanel />
      </Box>
    </Group>
  );
}
