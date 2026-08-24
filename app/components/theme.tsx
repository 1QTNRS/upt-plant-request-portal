import type { CSSProperties, ReactNode } from "react";

import { THEME, themeBadgeStyle, type ThemeTone } from "../lib/theme";

export function LeafIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M20 4c-6.2.4-11 4.2-13.2 9.1C4.6 9.6 4 6.4 4 4 8.5 6.2 12 10 13.6 15.2 15.8 10.4 18.4 6.2 20 4zm-9.1 17.2c.6-2.4 1.8-4.6 3.5-6.4-1.2 3.2-2.6 5.3-3.5 6.4z"
      />
    </svg>
  );
}

export function StatusBadge({
  tone,
  children,
}: {
  tone: ThemeTone;
  children: string;
}) {
  const colors = themeBadgeStyle(tone, children);
  return (
    <span
      data-status-badge
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 999,
        border: `1px solid ${colors.borderColor}`,
        background: colors.background,
        color: colors.color,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.3,
        whiteSpace: "nowrap",
      }}
    >
      {tone === "info" && children === "New" ? (
        <span
          aria-hidden="true"
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: THEME.yellow,
          }}
        />
      ) : null}
      {children}
    </span>
  );
}

export const themePrimaryButtonStyle: CSSProperties = {
  boxSizing: "border-box",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  width: "100%",
  minHeight: 48,
  padding: "12px 16px",
  borderRadius: 10,
  border: `1px solid ${THEME.darkGreen}`,
  background: THEME.darkGreen,
  color: THEME.white,
  WebkitTextFillColor: THEME.white,
  font: "inherit",
  fontWeight: 600,
  cursor: "pointer",
};

export const themeFieldStyle: CSSProperties = {
  display: "block",
  width: "100%",
  maxWidth: "100%",
  boxSizing: "border-box",
  marginTop: 8,
  padding: 12,
  minHeight: 44,
  borderRadius: 10,
  border: `1px solid ${THEME.line}`,
  background: THEME.white,
  color: THEME.ink,
  font: "inherit",
};

export function ThemeStyles() {
  return (
    <style>{`
      :root {
        --upt-dark-green: ${THEME.darkGreen};
        --upt-yellow: ${THEME.yellow};
        --upt-mint: ${THEME.mint};
        --upt-cream: ${THEME.cream};
        --upt-line: ${THEME.line};
      }
      .upt-customer-surface {
        min-height: 100vh;
        background: ${THEME.yellow};
        box-sizing: border-box;
      }
      .upt-customer-surface s-page {
        background: transparent !important;
        background-color: transparent !important;
      }
      .upt-customer-surface s-section {
        background: ${THEME.white} !important;
        background-color: ${THEME.white} !important;
        border-radius: 14px;
      }
      .upt-nested-box {
        background: ${THEME.mint};
        border: 1px solid ${THEME.line};
        border-radius: 12px;
        padding: 16px;
      }
      .upt-customer-page {
        position: relative;
        max-width: 720px;
        margin: 0 auto;
        padding: 8px 4px 32px;
        color: ${THEME.ink};
      }
      .upt-customer-title {
        margin: 8px 0 20px;
        color: ${THEME.darkGreen};
        font-family: Georgia, "Palatino Linotype", Palatino, serif;
        font-size: 2rem;
        font-weight: 700;
        line-height: 1.2;
      }
      .upt-card {
        background: ${THEME.white};
        border: 1px solid ${THEME.line};
        border-radius: 14px;
        padding: 20px;
        margin: 0 0 16px;
        box-shadow: 0 1px 0 rgba(0, 41, 16, 0.04);
      }
      .upt-card-title {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0 0 12px;
        color: ${THEME.darkGreen};
        font-size: 1.05rem;
        font-weight: 700;
      }
      .upt-card-title svg { flex: 0 0 auto; }
      .upt-muted { color: ${THEME.muted}; line-height: 1.5; }
      .upt-plant-card {
        border: 1px solid ${THEME.line};
        border-radius: 12px;
        padding: 16px;
        margin-bottom: 12px;
        background: ${THEME.cream};
      }
      .upt-fixed-table th { background: ${THEME.mint} !important; color: ${THEME.darkGreen}; }
      .upt-request-card { border-color: ${THEME.line}; }
      [data-list-prev],
      [data-list-next],
      [data-paged-prev],
      [data-paged-next] { color: ${THEME.darkGreen}; }
      [data-export-excel] {
        background: ${THEME.darkGreen} !important;
        color: ${THEME.white} !important;
        border-color: ${THEME.darkGreen} !important;
      }
      a, s-link { color: ${THEME.darkGreen}; }
    `}</style>
  );
}

export function NestedBox({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div className="upt-nested-box" style={style}>
      {children}
    </div>
  );
}

/**
 * Yellow page chrome for customer-facing routes only. Do not use on admin —
 * ThemeStyles is shared, but this wrapper is what paints the viewport.
 */
export function CustomerSurface({
  children,
  paintDocument = false,
}: {
  children: ReactNode;
  /** Only the customer layout should paint html/body, so admin previews stay unpainted. */
  paintDocument?: boolean;
}) {
  return (
    <div className="upt-customer-surface">
      {paintDocument ? (
        <style>{`
          html, body { background-color: ${THEME.yellow}; }
        `}</style>
      ) : null}
      {children}
    </div>
  );
}

export function CustomerPageShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <CustomerSurface>
      <s-page>
        <ThemeStyles />
        <div className="upt-customer-page">
          <h1 className="upt-customer-title">{title}</h1>
          {children}
        </div>
      </s-page>
    </CustomerSurface>
  );
}
