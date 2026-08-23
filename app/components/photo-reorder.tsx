import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

/**
 * Touch-friendly photo strip. Dragging posts the whole id list; Move left /
 * Move right stay as the keyboard and no-JS fallback.
 */
export function PhotoReorderStrip({
  itemId,
  photos,
  alt,
}: {
  itemId: string;
  photos: Array<{ id: string; url: string }>;
  alt: string;
}) {
  const fetcher = useFetcher();
  const [order, setOrder] = useState(photos.map((photo) => photo.id));
  const dragId = useRef<string | null>(null);

  useEffect(() => {
    setOrder(photos.map((photo) => photo.id));
  }, [photos]);

  const byId = new Map(photos.map((photo) => [photo.id, photo]));
  const ordered = order
    .map((id) => byId.get(id))
    .filter((photo): photo is { id: string; url: string } => Boolean(photo));

  const persist = (next: string[]) => {
    const data = new FormData();
    data.set("intent", "reorder-photos");
    data.set("itemId", itemId);
    data.set("photoIds", next.join(","));
    fetcher.submit(data, { method: "post" });
  };

  const moveIndex = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setOrder(next);
    persist(next);
  };

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 12,
        touchAction: "none",
      }}
    >
      {ordered.map((photo, index) => (
        <div
          key={photo.id}
          data-photo-id={photo.id}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            dragId.current = photo.id;
            (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
          }}
          onPointerUp={(event) => {
            if (!dragId.current) return;
            const hit = document
              .elementsFromPoint(event.clientX, event.clientY)
              .find((node) => node instanceof HTMLElement && node.dataset.photoId);
            const targetId =
              hit instanceof HTMLElement ? hit.dataset.photoId : undefined;
            const from = order.indexOf(dragId.current);
            const to = targetId ? order.indexOf(targetId) : -1;
            dragId.current = null;
            if (from >= 0 && to >= 0 && from !== to) {
              moveIndex(from, to);
            }
          }}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            cursor: "grab",
            userSelect: "none",
          }}
        >
          <div style={{ position: "relative", width: 120 }}>
            <img
              src={photo.url}
              alt={alt}
              width={120}
              height={120}
              draggable={false}
              style={{
                display: "block",
                objectFit: "cover",
                borderRadius: 8,
                maxWidth: "100%",
                pointerEvents: "none",
              }}
            />
            <button
              type="button"
              data-photo-delete
              aria-label="Remove photo"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const data = new FormData();
                data.set("intent", "remove-photo");
                data.set("itemId", itemId);
                data.set("photoId", photo.id);
                fetcher.submit(data, { method: "post" });
                setOrder((current) => current.filter((id) => id !== photo.id));
              }}
              style={{
                position: "absolute",
                top: 4,
                right: 4,
                width: 28,
                height: 28,
                border: "none",
                borderRadius: 14,
                background: "rgba(32, 34, 35, 0.85)",
                color: "#fff",
                font: "inherit",
                fontWeight: 700,
                lineHeight: "28px",
                cursor: "pointer",
                padding: 0,
              }}
            >
              ×
            </button>
          </div>
          {index === 0 ? <s-badge tone="info">Customer sees first</s-badge> : null}
          <s-stack direction="inline" gap="small">
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="move-photo" />
              <input type="hidden" name="itemId" value={itemId} />
              <input type="hidden" name="photoId" value={photo.id} />
              <input type="hidden" name="direction" value="up" />
              <s-button
                variant="secondary"
                type="submit"
                {...(index === 0 ? { disabled: true } : {})}
              >
                Move left
              </s-button>
            </fetcher.Form>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="move-photo" />
              <input type="hidden" name="itemId" value={itemId} />
              <input type="hidden" name="photoId" value={photo.id} />
              <input type="hidden" name="direction" value="down" />
              <s-button
                variant="secondary"
                type="submit"
                {...(index === ordered.length - 1 ? { disabled: true } : {})}
              >
                Move right
              </s-button>
            </fetcher.Form>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="remove-photo" />
              <input type="hidden" name="itemId" value={itemId} />
              <input type="hidden" name="photoId" value={photo.id} />
              <s-button variant="secondary" tone="critical" type="submit">
                Remove
              </s-button>
            </fetcher.Form>
          </s-stack>
        </div>
      ))}
    </div>
  );
}
