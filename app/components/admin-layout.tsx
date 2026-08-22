import type { CSSProperties, ReactNode } from "react";

/** Shared wrap so admin metric rows and toolbars fit a phone width. */
export const wrapRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
  alignItems: "stretch",
};

export const statCardStyle: CSSProperties = {
  flex: "1 1 160px",
  minWidth: "min(100%, 160px)",
  boxSizing: "border-box",
};

export function AdminResponsiveStyles() {
  return (
    <style>{`
      .upt-wide-only { display: block; }
      .upt-narrow-only { display: none; }
      @media (max-width: 720px) {
        .upt-wide-only { display: none !important; }
        .upt-narrow-only { display: block !important; }
      }
      .upt-request-card {
        border: 1px solid #c9cccf;
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 12px;
        background: #fff;
      }
      .upt-request-card dt {
        color: #6d7175;
        font-size: 12px;
        margin: 0 0 2px;
      }
      .upt-request-card dd {
        margin: 0 0 10px;
      }
    `}</style>
  );
}

export function WrappingRow({ children }: { children: ReactNode }) {
  return <div style={wrapRowStyle}>{children}</div>;
}
