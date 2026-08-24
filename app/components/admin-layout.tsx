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
      .admin-request-summary,
      .admin-plant-card {
        max-width: 100%;
        min-width: 0;
      }
      .admin-request-summary input,
      .admin-request-summary textarea,
      .admin-request-summary select,
      .admin-plant-card input,
      .admin-plant-card textarea,
      .admin-plant-card select {
        box-sizing: border-box;
        max-width: 100%;
        min-width: 0;
      }
      .admin-photo-file-input {
        font: inherit;
        width: 100%;
        max-width: 100%;
      }
      .admin-photo-file-input::file-selector-button {
        font: inherit;
        font-weight: 550;
        min-height: 36px;
        padding: 8px 16px;
        margin-right: 12px;
        border: 1px solid #8c9196;
        border-radius: 8px;
        background: #fff;
        color: #202223;
        cursor: pointer;
      }
      .upt-fixed-table {
        width: 100%;
        table-layout: fixed;
        border-collapse: collapse;
      }
      .upt-fixed-table th,
      .upt-fixed-table td {
        padding: 10px 8px;
        text-align: left;
        vertical-align: middle;
        border-bottom: 1px solid #e1e3e5;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        height: 44px;
        box-sizing: border-box;
      }
      .upt-fixed-table th {
        font-weight: 600;
        background: #f1f2f3;
      }
      .upt-fixed-table .upt-cell-wrap {
        white-space: normal;
        overflow-wrap: anywhere;
      }
      .upt-fixed-table.upt-wrap-table th,
      .upt-fixed-table.upt-wrap-table td {
        white-space: normal;
        overflow: visible;
        text-overflow: unset;
        height: auto;
        min-height: 44px;
        overflow-wrap: anywhere;
        line-height: 1.3;
        vertical-align: top;
      }
      .upt-fixed-table.upt-wrap-table th {
        vertical-align: bottom;
      }
      .upt-fixed-table.upt-wrap-table s-badge {
        display: inline-block;
        max-width: 100%;
        height: auto;
        white-space: normal;
        overflow-wrap: anywhere;
        line-height: 1.25;
      }
      .upt-page-slot td {
        border-bottom-color: transparent;
      }
      .upt-fixed-table,
      [data-list-pager],
      [data-paged-frame],
      [data-paged-list] {
        overflow-anchor: none;
      }
    `}</style>
  );
}

export function WrappingRow({ children }: { children: ReactNode }) {
  return <div style={wrapRowStyle}>{children}</div>;
}
