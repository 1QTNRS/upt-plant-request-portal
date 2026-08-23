import { useEffect, useRef, useState, type CSSProperties } from "react";

import { LIGHTBOX_NAV_CSS, lightboxIndex, swipeNavigates } from "../lib/photo-lightbox";

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

function isOutsidePhoto(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (
    target.closest(
      "[data-lightbox-image], [data-lightbox-prev], [data-lightbox-next], [data-lightbox-close], .lightbox-nav",
    )
  ) {
    return false;
  }
  return Boolean(target.closest("[data-admin-photo-lightbox]"));
}

function isLightboxControl(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        "[data-lightbox-prev], [data-lightbox-next], [data-lightbox-close], .lightbox-nav",
      ),
    )
  );
}

const toolbarStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  justifyContent: "space-between",
  alignItems: "center",
};

const stageStyle: CSSProperties = {
  position: "relative",
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  minHeight: 0,
  touchAction: "pan-y",
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
      style={{ ...overlayStyle, position: "fixed" }}
    >
      <style>{LIGHTBOX_NAV_CSS}</style>
      <button
        type="button"
        aria-label="Close photo"
        data-lightbox-backdrop
        onClick={(event) => {
          if (isOutsidePhoto(event.target)) onClose();
        }}
        style={{
          position: "absolute",
          inset: 0,
          border: "none",
          background: "transparent",
          padding: 0,
          cursor: "default",
        }}
      />
      <div style={{ ...toolbarStyle, position: "relative", zIndex: 1 }}>
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
      {/* Clicking the dark stage around the photo closes it. Keyboard: Escape / Close. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        data-lightbox-stage
        style={{ ...stageStyle, zIndex: 1 }}
        onPointerDown={(event) => {
          if (!event.isPrimary || isLightboxControl(event.target)) return;
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
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        {many ? (
          <button
            type="button"
            className="lightbox-nav"
            data-lightbox-prev
            aria-label="Previous"
            onClick={() =>
              setIndex((current) => lightboxIndex(current, -1, urls.length))
            }
          >
            ‹
          </button>
        ) : null}
        <img data-lightbox-image src={src} alt={alt} />
        {many ? (
          <button
            type="button"
            className="lightbox-nav"
            data-lightbox-next
            aria-label="Next"
            onClick={() =>
              setIndex((current) => lightboxIndex(current, 1, urls.length))
            }
          >
            ›
          </button>
        ) : null}
      </div>
    </div>
  );
}
