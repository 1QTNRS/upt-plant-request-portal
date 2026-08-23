import { useEffect, useRef, useState, type CSSProperties } from "react";

import { lightboxIndex, swipeNavigates } from "../lib/photo-lightbox";

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 80,
  display: "flex",
  flexDirection: "column",
  background: "rgba(32, 34, 35, 0.92)",
  color: "#fff",
  padding: 12,
};

const toolbarStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  justifyContent: "space-between",
  alignItems: "center",
};

const stageStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 0,
  touchAction: "pan-y",
};

const imageStyle: CSSProperties = {
  maxWidth: "min(92vw, 900px)",
  maxHeight: "78vh",
  objectFit: "contain",
};

const controlStyle: CSSProperties = {
  minHeight: 44,
  minWidth: 44,
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #8c9196",
  background: "#202223",
  color: "#fff",
  font: "inherit",
  cursor: "pointer",
};

export function AdminPhotoLightbox({
  urls,
  alt,
  startIndex,
  onClose,
}: {
  urls: string[];
  alt: string;
  startIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(() =>
    lightboxIndex(startIndex, 0, urls.length),
  );
  const start = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") {
        setIndex((current) => lightboxIndex(current, -1, urls.length));
      }
      if (event.key === "ArrowRight") {
        setIndex((current) => lightboxIndex(current, 1, urls.length));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, urls.length]);

  if (urls.length === 0) return null;
  const many = urls.length > 1;
  const src = urls[index] ?? urls[0];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      data-admin-photo-lightbox
      style={overlayStyle}
    >
      <div style={toolbarStyle}>
        <button
          type="button"
          data-lightbox-close
          aria-label="Close"
          onClick={onClose}
          style={controlStyle}
        >
          × Close
        </button>
        <span data-lightbox-status style={{ fontSize: 14 }}>
          {many ? `${index + 1} of ${urls.length}` : ""}
        </span>
      </div>
      <div
        data-lightbox-stage
        style={stageStyle}
        onPointerDown={(event) => {
          if (!event.isPrimary) return;
          start.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={(event) => {
          if (!start.current) return;
          const move = swipeNavigates(
            event.clientX - start.current.x,
            event.clientY - start.current.y,
          );
          start.current = null;
          if (move) setIndex((current) => lightboxIndex(current, move, urls.length));
        }}
        onPointerCancel={() => {
          start.current = null;
        }}
      >
        {many ? (
          <button
            type="button"
            data-lightbox-prev
            onClick={() =>
              setIndex((current) => lightboxIndex(current, -1, urls.length))
            }
            style={controlStyle}
          >
            Previous
          </button>
        ) : null}
        <img src={src} alt={alt} style={imageStyle} />
        {many ? (
          <button
            type="button"
            data-lightbox-next
            onClick={() =>
              setIndex((current) => lightboxIndex(current, 1, urls.length))
            }
            style={controlStyle}
          >
            Next
          </button>
        ) : null}
      </div>
    </div>
  );
}
