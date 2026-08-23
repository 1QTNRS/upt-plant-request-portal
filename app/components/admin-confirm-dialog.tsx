import type { CSSProperties, ReactNode } from "react";

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 90,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  background: "rgba(32, 34, 35, 0.72)",
};

const cardStyle: CSSProperties = {
  width: "min(480px, 100%)",
  padding: 20,
  borderRadius: 12,
  background: "#fff",
  border: "1px solid #c9cccf",
};

const buttonStyle: CSSProperties = {
  minHeight: 44,
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid #c9cccf",
  background: "#fff",
  font: "inherit",
  cursor: "pointer",
};

export function AdminConfirmDialog({
  title,
  children,
  onCancel,
  confirm,
}: {
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  onCancel: () => void;
  confirm: ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-admin-confirm-dialog
      style={{ ...overlayStyle, position: "fixed" }}
    >
      <button
        type="button"
        aria-label="Cancel"
        onClick={onCancel}
        style={{
          position: "absolute",
          inset: 0,
          border: "none",
          background: "transparent",
          padding: 0,
          cursor: "pointer",
        }}
      />
      <div style={{ ...cardStyle, position: "relative", zIndex: 1 }}>
        <s-stack direction="block" gap="base">
          <s-heading>{title}</s-heading>
          {children}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {confirm}
            <button type="button" onClick={onCancel} style={buttonStyle}>
              Cancel
            </button>
          </div>
        </s-stack>
      </div>
    </div>
  );
}
