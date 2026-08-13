/**
 * Design PoC — Gcore control-panel look-alike, rendered on the "My profile" screen.
 *
 * Self-contained on purpose: it mounts its own light MantineProvider so the
 * surrounding dark app theme is untouched. Reachable at /design-poc.
 * Once the direction is approved, these primitives graduate into the real shell
 * (AppShell header + grouped navbar + subnav) and the hardcoded palette becomes theme tokens.
 */
import { MantineProvider, createTheme } from "@mantine/core";
import type { ReactNode } from "react";
import {
  IconBook,
  IconBrain,
  IconChevronDown,
  IconChevronRight,
  IconCloud,
  IconCpu,
  IconDatabase,
  IconDeviceDesktop,
  IconHeadset,
  IconInfoCircle,
  IconLayoutDashboard,
  IconLayoutSidebarLeftCollapse,
  IconRouter,
  IconSearch,
  IconServer,
  IconServerBolt,
  IconShieldHalf,
  IconShieldLock,
  IconSparkles,
  IconWorld,
} from "@tabler/icons-react";

// ---------------------------------------------------------------------------
// Palette (Gcore-like). These become theme tokens once approved.
// ---------------------------------------------------------------------------
const C = {
  accent: "#ff5913",
  accentHover: "#e64e0c",
  ink: "#1b1b1f",
  inkSoft: "#3f434a",
  dim: "#6b7280",
  faint: "#9ca3af",
  line: "#e6e7eb",
  lineSoft: "#eef0f3",
  bg: "#ffffff",
  panel: "#ffffff",
  chip: "#f4f5f7",
  chipHover: "#eceef1",
  infoBg: "#eaf3fb",
  infoBorder: "#cfe4f6",
  infoIcon: "#2b7fce",
  link: "#2b6cb0",
} as const;

const pocTheme = createTheme({
  fontFamily:
    "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  primaryColor: "brand",
  colors: {
    brand: [
      "#fff2ec",
      "#ffe0d2",
      "#ffbfa3",
      "#ff9c70",
      "#ff7e46",
      "#ff6a2b",
      "#ff5913",
      "#e64e0c",
      "#c14109",
      "#9c3406",
    ],
  },
});

// ---------------------------------------------------------------------------
// Left icon-nav
// ---------------------------------------------------------------------------
interface NavItem {
  label: string;
  icon: ReactNode;
  active?: boolean;
  beta?: boolean;
}
interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: "Overview",
    items: [{ label: "Dashboard", icon: <IconLayoutDashboard size={18} /> }],
  },
  {
    title: "AI",
    items: [
      { label: "GPU Cloud", icon: <IconCpu size={18} /> },
      { label: "Everywhere Inference", icon: <IconBrain size={18} /> },
      { label: "Gclaw", icon: <IconSparkles size={18} />, beta: true },
    ],
  },
  {
    title: "Compute",
    items: [
      { label: "Cloud", icon: <IconCloud size={18} /> },
      { label: "Basic VMs", icon: <IconDeviceDesktop size={18} /> },
      { label: "Object Storage", icon: <IconDatabase size={18} /> },
    ],
  },
  {
    title: "Network",
    items: [
      { label: "CDN", icon: <IconWorld size={18} /> },
      { label: "Managed DNS", icon: <IconRouter size={18} /> },
      { label: "FastEdge", icon: <IconServerBolt size={18} /> },
      { label: "Streaming", icon: <IconServer size={18} /> },
    ],
  },
  {
    title: "Security",
    items: [
      { label: "WAAP", icon: <IconShieldHalf size={18} /> },
      { label: "DDoS Protection", icon: <IconShieldLock size={18} /> },
      { label: "Edge Proxy", icon: <IconShieldLock size={18} /> },
    ],
  },
  {
    title: "Infrastructure",
    items: [{ label: "Colocation", icon: <IconServer size={18} /> }],
  },
];

function IconNav() {
  return (
    <nav
      style={{
        width: 232,
        flexShrink: 0,
        background: C.bg,
        borderRight: `1px solid ${C.line}`,
        padding: "18px 14px 24px",
        overflowY: "auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 8px 22px" }}>
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: 7,
            background: C.accent,
            color: "#fff",
            display: "grid",
            placeItems: "center",
            fontWeight: 800,
            fontSize: 16,
          }}
        >
          Q
        </div>
        <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: 0.3, color: C.ink }}>
          QAA-TMS
        </span>
      </div>

      {NAV_GROUPS.map((group) => (
        <div key={group.title} style={{ marginBottom: 18 }}>
          <div
            style={{
              padding: "0 10px 8px",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.8,
              textTransform: "uppercase",
              color: C.faint,
            }}
          >
            {group.title}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {group.items.map((item) => (
              <button
                key={item.label}
                type="button"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  width: "100%",
                  padding: "8px 10px",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                  background: item.active ? C.chip : "transparent",
                  color: item.active ? C.accent : C.inkSoft,
                  fontSize: 14,
                  fontWeight: item.active ? 600 : 500,
                  textAlign: "left",
                }}
              >
                <span style={{ display: "grid", placeItems: "center", flexShrink: 0 }}>
                  {item.icon}
                </span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.beta ? (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: C.accent,
                      background: C.chip,
                      borderRadius: 5,
                      padding: "1px 5px",
                    }}
                  >
                    Beta
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Top header
// ---------------------------------------------------------------------------
function TopHeader() {
  const iconBtn: React.CSSProperties = {
    width: 38,
    height: 38,
    borderRadius: 10,
    border: `1px solid ${C.line}`,
    background: C.bg,
    color: C.inkSoft,
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
  };
  return (
    <header
      style={{
        height: 64,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "0 20px",
        borderBottom: `1px solid ${C.line}`,
        background: C.bg,
      }}
    >
      <button type="button" aria-label="Toggle nav" style={{ ...iconBtn, border: "none" }}>
        <IconLayoutSidebarLeftCollapse size={20} />
      </button>

      <div style={{ flex: 1, maxWidth: 620, position: "relative" }}>
        <IconSearch
          size={18}
          style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: C.faint }}
        />
        <input
          placeholder="Type / to search"
          style={{
            width: "100%",
            height: 40,
            borderRadius: 12,
            border: `1px solid ${C.line}`,
            padding: "0 14px 0 42px",
            fontSize: 14,
            color: C.ink,
            outline: "none",
            background: C.bg,
          }}
        />
      </div>

      <div style={{ flex: 1 }} />

      <button type="button" aria-label="Support" style={iconBtn}>
        <IconHeadset size={19} />
      </button>
      <button type="button" aria-label="Docs" style={iconBtn}>
        <IconBook size={19} />
      </button>
      <div style={{ fontWeight: 700, fontSize: 15, color: C.ink, padding: "0 4px" }}>€0</div>
      <button
        type="button"
        style={{
          height: 38,
          padding: "0 18px",
          borderRadius: 10,
          border: "none",
          background: C.accent,
          color: "#fff",
          fontWeight: 600,
          fontSize: 14,
          cursor: "pointer",
        }}
      >
        Top-up
      </button>
      <button
        type="button"
        aria-label="Account"
        style={{ ...iconBtn, width: "auto", padding: "0 8px 0 6px", gap: 6, display: "flex" }}
      >
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            background: C.chip,
            display: "grid",
            placeItems: "center",
            color: C.dim,
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          SW
        </span>
        <IconChevronDown size={16} />
      </button>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Subnav column
// ---------------------------------------------------------------------------
interface SubItem {
  label: string;
  active?: boolean;
  chevron?: boolean;
}
const SUBNAV: SubItem[] = [
  { label: "My profile", active: true },
  { label: "Account", chevron: true },
  { label: "Billing", chevron: true },
  { label: "Audit log" },
  { label: "Notifications" },
];

function SubNav() {
  return (
    <aside
      style={{
        width: 210,
        flexShrink: 0,
        borderRight: `1px solid ${C.line}`,
        padding: "26px 16px",
        background: C.bg,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 16, color: C.ink, padding: "0 10px 16px" }}>
        Profile
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {SUBNAV.map((item) => (
          <button
            key={item.label}
            type="button"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              padding: "9px 10px",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
              background: "transparent",
              color: item.active ? C.accent : C.inkSoft,
              fontSize: 14,
              fontWeight: item.active ? 600 : 500,
              textAlign: "left",
            }}
          >
            <span>{item.label}</span>
            {item.chevron ? <IconChevronRight size={16} style={{ color: C.faint }} /> : null}
          </button>
        ))}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Content building blocks
// ---------------------------------------------------------------------------
function Card({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: C.panel,
        border: `1px solid ${C.line}`,
        borderRadius: 14,
        padding: 24,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function CardTitle({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontWeight: 700, fontSize: 18, color: C.ink, marginBottom: 20 }}>{children}</div>
  );
}

function Field({
  label,
  value,
  select,
}: {
  label: string;
  value: string;
  select?: boolean;
}) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{ display: "block", fontSize: 13, color: C.inkSoft, marginBottom: 7 }}>
        {label} <span style={{ color: C.accent }}>*</span>
      </label>
      <div style={{ position: "relative" }}>
        <input
          defaultValue={value}
          style={{
            width: "100%",
            height: 44,
            borderRadius: 10,
            border: `1px solid ${C.line}`,
            padding: "0 14px",
            fontSize: 14,
            color: C.ink,
            outline: "none",
            background: C.bg,
          }}
        />
        {select ? (
          <IconChevronDown
            size={18}
            style={{
              position: "absolute",
              right: 12,
              top: "50%",
              transform: "translateY(-50%)",
              color: C.faint,
              pointerEvents: "none",
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function GhostBtn({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      style={{
        height: 40,
        padding: "0 18px",
        borderRadius: 10,
        border: `1px solid ${C.line}`,
        background: C.bg,
        color: C.inkSoft,
        fontSize: 14,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      style={{
        height: 36,
        padding: "0 14px",
        borderRadius: 9,
        border: `1px solid ${C.line}`,
        background: C.chip,
        color: C.inkSoft,
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      {children}
      <IconChevronDown size={15} />
    </button>
  );
}

function FilterInput({ placeholder, icon }: { placeholder: string; icon?: ReactNode }) {
  return (
    <div style={{ position: "relative", flex: "0 0 auto" }}>
      {icon ? (
        <span
          style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: C.faint }}
        >
          {icon}
        </span>
      ) : null}
      <input
        placeholder={placeholder}
        style={{
          height: 40,
          borderRadius: 10,
          border: `1px solid ${C.line}`,
          padding: icon ? "0 14px 0 36px" : "0 14px",
          fontSize: 13,
          color: C.ink,
          outline: "none",
          background: C.bg,
          minWidth: 180,
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Content: My profile
// ---------------------------------------------------------------------------
function ProfileContent() {
  const th: React.CSSProperties = {
    textAlign: "left",
    fontSize: 13,
    fontWeight: 600,
    color: C.dim,
    padding: "0 12px 12px",
  };
  const td: React.CSSProperties = { fontSize: 14, color: C.inkSoft, padding: "16px 12px" };

  return (
    <main style={{ flex: 1, overflowY: "auto", padding: "26px 32px 48px", background: C.bg }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: C.ink, margin: 0 }}>My profile</h1>
        <div style={{ marginLeft: "auto", display: "flex", gap: 12 }}>
          <button
            type="button"
            disabled
            style={{
              height: 40,
              padding: "0 20px",
              borderRadius: 10,
              border: "none",
              background: C.chip,
              color: C.faint,
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Discard
          </button>
          <button
            type="button"
            disabled
            style={{
              height: 40,
              padding: "0 24px",
              borderRadius: 10,
              border: "none",
              background: C.chip,
              color: C.faint,
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Save
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
        <Card>
          <CardTitle>General</CardTitle>
          <Field label="Username" value="Shane Washington" />
          <Field label="Email" value="piece_hhuffman_260813175650346@gcore.qaa.net" />
          <div style={{ marginBottom: 0 }}>
            <label style={{ display: "block", fontSize: 13, color: C.inkSoft, marginBottom: 7 }}>
              Language
            </label>
            <div style={{ position: "relative" }}>
              <input
                defaultValue="English"
                style={{
                  width: "100%",
                  height: 44,
                  borderRadius: 10,
                  border: `1px solid ${C.line}`,
                  padding: "0 14px",
                  fontSize: 14,
                  color: C.ink,
                  outline: "none",
                  background: C.bg,
                }}
              />
              <IconChevronDown
                size={18}
                style={{
                  position: "absolute",
                  right: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: C.faint,
                  pointerEvents: "none",
                }}
              />
            </div>
          </div>
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Card>
            <CardTitle>Two-Factor authentication</CardTitle>
            <div
              style={{
                display: "flex",
                gap: 12,
                background: C.infoBg,
                border: `1px solid ${C.infoBorder}`,
                borderRadius: 10,
                padding: "14px 16px",
                marginBottom: 20,
              }}
            >
              <IconInfoCircle size={20} style={{ color: C.infoIcon, flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 13.5, color: C.inkSoft, lineHeight: 1.5 }}>
                Two-Factor Authentication (2FA) significantly enhances the security of your accounts,
                safeguarding them against unauthorised access and potential breaches.
              </div>
            </div>
            <GhostBtn>Enable 2FA</GhostBtn>
          </Card>

          <Card>
            <CardTitle>Password</CardTitle>
            <div style={{ fontSize: 14, color: C.inkSoft, marginBottom: 18 }}>
              To change your password click on the button below.
            </div>
            <GhostBtn>Change password</GhostBtn>
          </Card>
        </div>
      </div>

      <Card style={{ marginTop: 20, padding: 0 }}>
        <div style={{ padding: "22px 24px 0" }}>
          <CardTitle>Last logins</CardTitle>
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 12,
            padding: "0 24px 6px",
          }}
        >
          <Chip>Last 24 hours</Chip>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              height: 40,
              border: `1px solid ${C.line}`,
              borderRadius: 10,
              padding: "0 12px",
              fontSize: 13,
              color: C.inkSoft,
            }}
          >
            08/12/2026 <IconChevronRight size={14} style={{ color: C.faint }} /> 08/13/2026
          </div>
          <FilterInput placeholder="IP" icon={<IconSearch size={15} />} />
          <div style={{ position: "relative", minWidth: 220 }}>
            <input
              placeholder="Success"
              style={{
                width: "100%",
                height: 40,
                borderRadius: 10,
                border: `1px solid ${C.line}`,
                padding: "0 14px",
                fontSize: 13,
                color: C.dim,
                outline: "none",
                background: C.bg,
              }}
            />
            <IconChevronDown
              size={16}
              style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: C.faint }}
            />
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "10px 24px 16px",
          }}
        >
          <button
            type="button"
            style={{
              border: "none",
              background: "none",
              color: C.accent,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              padding: 0,
            }}
          >
            Reset all
          </button>
          <div style={{ marginLeft: "auto", display: "flex", gap: 12 }}>
            <Chip>My Presets</Chip>
            <Chip>Manage Columns</Chip>
            <Chip>Display Density</Chip>
          </div>
        </div>

        <div style={{ padding: "0 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.line}` }}>
                <th style={th}>Login date ↓↑</th>
                <th style={th}>IP ↓↑</th>
                <th style={th}>Success</th>
                <th style={th}>OS</th>
                <th style={th}>Browser</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
                <td style={td}>13 Aug 2026, 20:56</td>
                <td style={td}>92.223.127.228</td>
                <td style={td}>true</td>
                <td style={td}>undefined: undefined</td>
                <td style={td}>undefined: undefined</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "18px 24px 22px",
            gap: 8,
          }}
        >
          <button type="button" style={pagerBtn}>
            ‹
          </button>
          <button type="button" style={{ ...pagerBtn, background: C.accent, color: "#fff", borderColor: C.accent }}>
            1
          </button>
          <button type="button" style={pagerBtn}>
            ›
          </button>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ fontSize: 13, color: C.inkSoft }}>Entries per page</span>
            <Chip>10</Chip>
            <span style={{ fontSize: 13, color: C.dim }}>Showing 1 - 1 of 1 entries</span>
          </div>
        </div>
      </Card>
    </main>
  );
}

const pagerBtn: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 9,
  border: `1px solid ${C.line}`,
  background: C.bg,
  color: C.inkSoft,
  fontSize: 15,
  cursor: "pointer",
  display: "grid",
  placeItems: "center",
};

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------
export function GcoreProfilePoc() {
  return (
    <MantineProvider theme={pocTheme} forceColorScheme="light">
      <div
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          background: C.bg,
          color: C.ink,
          fontFamily: pocTheme.fontFamily,
        }}
      >
        <TopHeader />
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <IconNav />
          <SubNav />
          <ProfileContent />
        </div>
      </div>
    </MantineProvider>
  );
}

export default GcoreProfilePoc;
