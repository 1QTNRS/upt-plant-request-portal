import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  gallerySwipe,
  dismissSwipe,
  isBaseScale,
  LIGHTBOX_TOUCH_LISTENER_OPTIONS,
  lockPageScroll,
  MOBILE_LIGHTBOX_STAGE_CSS,
  pinchScale,
  pinchScaleFromTouches,
  pointerDistance,
  touchPairDistance,
} from "../lib/mobile-lightbox";
import { LIGHTBOX_NAV_CSS, lightboxIndex } from "../lib/photo-lightbox";

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 80,
  display: "flex",
  flexDirection: "column",
  background: "rgba(32, 34, 35, 0.92)",
  color: "#fff",
  padding: 12,
  touchAction: "none",
  overscrollBehavior: "none",
};

function isOutsidePhoto(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (
    target.closest(
      "[data-lightbox-image], [data-lightbox-prev], [data-lightbox-next], [data-lightbox-close], .lightbox-nav, [data-lightbox-transform]",
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
  touchAction: "none",
  overscrollBehavior: "none",
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

type PointerPoint = { id: number; x: number; y: number };

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
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, PointerPoint>());
  const pinchStart = useRef<{ distance: number; scale: number } | null>(null);
  const panStart = useRef<{ x: number; y: number; ox: number; oy: number } | null>(
    null,
  );
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const scaleRef = useRef(scale);
  const offsetRef = useRef(offset);
  const twoFingerTouch = useRef(false);
  scaleRef.current = scale;
  offsetRef.current = offset;

  const resetTransform = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setDragging(false);
    pointers.current.clear();
    pinchStart.current = null;
    panStart.current = null;
    swipeStart.current = null;
  }, []);

  useEffect(() => {
    resetTransform();
  }, [index, resetTransform]);

  useEffect(() => {
    const lock = lockPageScroll();
    return () => lock?.unlock();
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length < 2) return;
      event.preventDefault();
      twoFingerTouch.current = true;
      const first = event.touches[0];
      const second = event.touches[1];
      pinchStart.current = {
        distance: touchPairDistance(first, second),
        scale: scaleRef.current,
      };
      panStart.current = null;
      swipeStart.current = null;
      setDragging(false);
    };

    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length < 2 || !pinchStart.current) return;
      event.preventDefault();
      const first = event.touches[0];
      const second = event.touches[1];
      setScale(
        pinchScaleFromTouches(
          first,
          second,
          pinchStart.current.distance,
          pinchStart.current.scale,
        ),
      );
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length >= 2) return;
      twoFingerTouch.current = false;
      pinchStart.current = null;
      if (event.touches.length === 0) {
        panStart.current = null;
        swipeStart.current = null;
        setDragging(false);
      }
    };

    stage.addEventListener("touchstart", onTouchStart, LIGHTBOX_TOUCH_LISTENER_OPTIONS);
    stage.addEventListener("touchmove", onTouchMove, LIGHTBOX_TOUCH_LISTENER_OPTIONS);
    stage.addEventListener("touchend", onTouchEnd);
    stage.addEventListener("touchcancel", onTouchEnd);
    return () => {
      stage.removeEventListener("touchstart", onTouchStart);
      stage.removeEventListener("touchmove", onTouchMove);
      stage.removeEventListener("touchend", onTouchEnd);
      stage.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (!isBaseScale(scale)) return;
      if (event.key === "ArrowLeft") {
        setIndex((current) => lightboxIndex(current, -1, urls.length));
      }
      if (event.key === "ArrowRight") {
        setIndex((current) => lightboxIndex(current, 1, urls.length));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, scale, urls.length]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (twoFingerTouch.current) return;
    if (!event.isPrimary && pointers.current.size >= 2) return;
    if (isLightboxControl(event.target)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    });

    if (pointers.current.size === 2) {
      const pts = [...pointers.current.values()];
      pinchStart.current = {
        distance: pointerDistance(pts[0], pts[1]),
        scale,
      };
      panStart.current = null;
      swipeStart.current = null;
      return;
    }

    if (!isBaseScale(scale)) {
      panStart.current = {
        x: event.clientX,
        y: event.clientY,
        ox: offset.x,
        oy: offset.y,
      };
      return;
    }

    swipeStart.current = { x: event.clientX, y: event.clientY };
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const point = pointers.current.get(event.pointerId);
    if (!point) return;
    point.x = event.clientX;
    point.y = event.clientY;

    if (pointers.current.size >= 2 && pinchStart.current) {
      const pts = [...pointers.current.values()];
      if (pts.length < 2) return;
      setScale(
        pinchScale(
          pointerDistance(pts[0], pts[1]),
          pinchStart.current.distance,
          pinchStart.current.scale,
        ),
      );
      return;
    }

    if (panStart.current && !isBaseScale(scale)) {
      setOffset({
        x: panStart.current.ox + (event.clientX - panStart.current.x),
        y: panStart.current.oy + (event.clientY - panStart.current.y),
      });
      return;
    }

    if (swipeStart.current && isBaseScale(scale)) {
      const dy = event.clientY - swipeStart.current.y;
      if (dy > 0) {
        setOffset({ x: 0, y: dy });
      }
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // capture may already be released
    }

    if (pointers.current.size >= 1) {
      pinchStart.current = null;
      return;
    }

    pinchStart.current = null;
    panStart.current = null;

    if (swipeStart.current && isBaseScale(scale)) {
      const dx = event.clientX - swipeStart.current.x;
      const dy = event.clientY - swipeStart.current.y;
      swipeStart.current = null;
      setDragging(false);

      if (dismissSwipe(dy) && Math.abs(dy) > Math.abs(dx)) {
        resetTransform();
        onClose();
        return;
      }

      const move = gallerySwipe(dx, dy, urls.length, scale);
      if (move) {
        resetTransform();
        setIndex((current) => lightboxIndex(current, move, urls.length));
        return;
      }

      setOffset({ x: 0, y: 0 });
    }
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) {
      pinchStart.current = null;
      panStart.current = null;
      swipeStart.current = null;
      setDragging(false);
      if (isBaseScale(scale)) setOffset({ x: 0, y: 0 });
    }
  };

  if (urls.length === 0) return null;
  const many = urls.length > 1;
  const src = urls[index] ?? urls[0];
  const transformStyle = {
    transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
    transition: dragging ? "none" : "transform 0.2s ease",
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      data-admin-photo-lightbox
      style={{ ...overlayStyle, position: "fixed" }}
    >
      <style>{LIGHTBOX_NAV_CSS}</style>
      <style>{MOBILE_LIGHTBOX_STAGE_CSS}</style>
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
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        ref={stageRef}
        data-lightbox-stage
        style={{ ...stageStyle, zIndex: 1 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClick={(event) => {
          if (event.target === event.currentTarget && isBaseScale(scale)) onClose();
        }}
      >
        {many ? (
          <button
            type="button"
            className="lightbox-nav"
            data-lightbox-prev
            aria-label="Previous"
            onClick={() => {
              resetTransform();
              setIndex((current) => lightboxIndex(current, -1, urls.length));
            }}
          >
            ‹
          </button>
        ) : null}
        <div data-lightbox-transform style={transformStyle}>
          <img data-lightbox-image src={src} alt={alt} draggable={false} />
        </div>
        {many ? (
          <button
            type="button"
            className="lightbox-nav"
            data-lightbox-next
            aria-label="Next"
            onClick={() => {
              resetTransform();
              setIndex((current) => lightboxIndex(current, 1, urls.length));
            }}
          >
            ›
          </button>
        ) : null}
      </div>
    </div>
  );
}
