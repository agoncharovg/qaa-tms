import React from "react";
import { createRoot } from "react-dom/client";

import {
  CONTRACT_VERSION,
  type LocalPluginModule,
  type ThemeTokens,
} from "@qaa-tms/plugin-sdk";

function HelloView({ tokens, viewKey }: { tokens: ThemeTokens; viewKey: string }) {
  return (
    <div
      style={{
        background: tokens.surface,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radius,
        color: tokens.text,
        display: "grid",
        fontFamily: tokens.fontFamily,
        gap: tokens.spacing,
        minHeight: "100%",
        padding: tokens.spacing,
      }}
    >
      <div
        style={{
          color: tokens.primaryColor,
          fontSize: "12px",
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        Local plugin
      </div>
      <div style={{ fontSize: "28px", fontWeight: 700 }}>Hello from a local plugin</div>
      <div style={{ color: tokens.dimmed, maxWidth: "42rem" }}>
        This view is rendered with the plugin&apos;s own bundled React runtime and styled from
        host theme tokens.
      </div>
      <div
        style={{
          background: tokens.background,
          borderRadius: tokens.radius,
          color: tokens.dimmed,
          fontFamily: "monospace",
          padding: tokens.spacing,
        }}
      >
        viewKey: {viewKey}
      </div>
    </div>
  );
}

const helloPlugin: LocalPluginModule = {
  contractVersion: CONTRACT_VERSION,
  mount(viewKey, ctx) {
    const root = createRoot(ctx.container);

    const render = (tokens: ThemeTokens) => {
      root.render(<HelloView tokens={tokens} viewKey={viewKey} />);
    };

    render(ctx.host.theme.getTokens());
    const unsubscribe = ctx.host.theme.subscribe(render);

    return () => {
      unsubscribe();
      root.unmount();
      ctx.container.replaceChildren();
    };
  },
};

export default helloPlugin;
