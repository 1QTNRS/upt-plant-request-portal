import { useState, type ReactNode } from "react";

/**
 * Local open state so collapsing does not remount children and cannot wipe
 * filters, search, or loaded rows on a parent re-render.
 */
export function CollapsibleSection({
  title,
  badge,
  defaultOpen,
  children,
}: {
  title: string;
  badge?: string | number;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className="admin-collapsible"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="admin-collapsible__summary">
        <span className="admin-collapsible__title">{title}</span>
        {badge != null && badge !== "" ? (
          <span className="admin-collapsible__badge">{badge}</span>
        ) : null}
      </summary>
      <div className="admin-collapsible__body">{children}</div>
    </details>
  );
}

export function CollapsibleSectionStyles() {
  return (
    <style>{`
      .admin-request-collapsibles {
        width: 100%;
        max-width: 100%;
        min-width: 0;
        box-sizing: border-box;
      }
      .admin-request-collapsibles > .admin-collapsible {
        width: 100%;
        box-sizing: border-box;
      }
      .admin-collapsible {
        border: 1px solid #c9cccf;
        border-radius: 8px;
        background: #fff;
        margin: 0 0 16px;
      }
      .admin-collapsible__summary {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        padding: 12px 16px;
        cursor: pointer;
        list-style: none;
        font-weight: 600;
      }
      .admin-collapsible__summary::-webkit-details-marker { display: none; }
      .admin-collapsible__summary::before {
        content: "▸";
        display: inline-block;
        width: 1em;
        color: #6d7175;
      }
      .admin-collapsible[open] > .admin-collapsible__summary::before {
        content: "▾";
      }
      .admin-collapsible__badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 1.5em;
        padding: 0 8px;
        border-radius: 999px;
        background: #e4e5e7;
        font-size: 12px;
        font-weight: 600;
      }
      .admin-collapsible__body {
        padding: 0 16px 16px;
      }
    `}</style>
  );
}
