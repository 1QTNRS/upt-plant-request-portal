import type { CSSProperties } from "react";

import { LIGHTBOX_NAV_CSS } from "../lib/photo-lightbox";

/** Small click-to-enlarge thumb. Locked in px so a storefront `img { width:100% }` cannot blow it up. */
export const CUSTOMER_PHOTO_THUMB_PX = 64;

/**
 * A wrap flexbox with no width shrinks to one thumb and stacks the rest. The
 * row is 100% of the plant card so thumbs sit side by side. Pixel sizes use
 * !important: Dawn and other themes set `img { width:100%; height:auto }`,
 * which otherwise paints the full Shopify File.
 */
const GALLERY_ROW_CSS = `
[data-customer-gallery]{
  display:flex!important;
  flex-direction:row!important;
  flex-wrap:wrap;
  align-items:flex-start;
  gap:8px;
  width:100%;
  box-sizing:border-box;
}
[data-customer-gallery]>a{
  flex:0 0 ${CUSTOMER_PHOTO_THUMB_PX}px!important;
  display:block!important;
  width:${CUSTOMER_PHOTO_THUMB_PX}px!important;
  max-width:${CUSTOMER_PHOTO_THUMB_PX}px!important;
  height:${CUSTOMER_PHOTO_THUMB_PX}px!important;
  line-height:0;
}
[data-customer-gallery] img{
  display:block!important;
  width:${CUSTOMER_PHOTO_THUMB_PX}px!important;
  height:${CUSTOMER_PHOTO_THUMB_PX}px!important;
  max-width:${CUSTOMER_PHOTO_THUMB_PX}px!important;
  object-fit:cover!important;
  border-radius:8px;
  cursor:zoom-in;
}
`;

const rowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "row",
  flexWrap: "wrap",
  alignItems: "flex-start",
  gap: 8,
  width: "100%",
};

const thumbLinkStyle: CSSProperties = {
  flex: `0 0 ${CUSTOMER_PHOTO_THUMB_PX}px`,
  display: "block",
  width: CUSTOMER_PHOTO_THUMB_PX,
  maxWidth: CUSTOMER_PHOTO_THUMB_PX,
  height: CUSTOMER_PHOTO_THUMB_PX,
  lineHeight: 0,
};

const thumbImageStyle: CSSProperties = {
  display: "block",
  width: CUSTOMER_PHOTO_THUMB_PX,
  height: CUSTOMER_PHOTO_THUMB_PX,
  maxWidth: CUSTOMER_PHOTO_THUMB_PX,
  objectFit: "cover",
  borderRadius: 8,
  cursor: "zoom-in",
};

/**
 * Clickable plant photos for app-proxy pages. The storefront never hydrates;
 * the enhance script opens `#customer-lightbox`. No-JS users get the raw image.
 */
export function CustomerPhotoGallery({
  urls,
  alt,
}: {
  urls: string[];
  alt: string;
}) {
  if (urls.length === 0) return null;
  const galleryId = alt;
  return (
    <>
      <style>{GALLERY_ROW_CSS}</style>
      <div style={rowStyle} data-customer-gallery>
        {urls.map((url, index) => (
          <a
            key={url}
            href={url}
            data-customer-photo
            data-gallery={galleryId}
            data-index={String(index)}
            data-alt={
              urls.length > 1 ? `${alt}, photo ${index + 1} of ${urls.length}` : alt
            }
            style={thumbLinkStyle}
          >
            <img
              src={url}
              alt={
                urls.length > 1
                  ? `${alt}, photo ${index + 1} of ${urls.length}`
                  : alt
              }
              width={CUSTOMER_PHOTO_THUMB_PX}
              height={CUSTOMER_PHOTO_THUMB_PX}
              style={thumbImageStyle}
            />
          </a>
        ))}
      </div>
    </>
  );
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 40,
  display: "flex",
  flexDirection: "column",
  background: "rgba(32, 34, 35, 0.92)",
  color: "#fff",
  padding: 12,
};

const stageStyle: CSSProperties = {
  position: "relative",
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 0,
  touchAction: "pan-y",
};

const imageStyle: CSSProperties = {
  pointerEvents: "auto",
};

const toolbarStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  justifyContent: "space-between",
  alignItems: "center",
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

export function CustomerLightboxRoot() {
  return (
    <>
      {/* Inline display:flex beats the HTML hidden attribute unless we force it. */}
      <style>{`#customer-lightbox[hidden]{display:none!important}${LIGHTBOX_NAV_CSS}`}</style>
      <div
        id="customer-lightbox"
        hidden
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Plant photo"
        data-customer-lightbox
        style={overlayStyle}
      >
      <div style={toolbarStyle}>
        <button type="button" data-lightbox-close style={controlStyle}>
          Close
        </button>
        <span data-lightbox-status style={{ fontSize: 14 }} />
      </div>
      <div data-lightbox-stage style={{ ...stageStyle, gap: 10 }}>
        <button
          type="button"
          className="lightbox-nav"
          data-lightbox-prev
          aria-label="Previous"
        >
          ‹
        </button>
        <img data-lightbox-image alt="" style={imageStyle} />
        <button
          type="button"
          className="lightbox-nav"
          data-lightbox-next
          aria-label="Next"
        >
          ›
        </button>
      </div>
    </div>
    </>
  );
}
