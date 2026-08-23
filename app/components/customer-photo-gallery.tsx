import type { CSSProperties } from "react";

const thumbStyle: CSSProperties = {
  display: "block",
  objectFit: "cover",
  borderRadius: "8px",
  maxWidth: "100%",
  width: "min(200px, 100%)",
  height: "auto",
  cursor: "zoom-in",
};

const rowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
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
        >
          <img
            src={url}
            alt={
              urls.length > 1
                ? `${alt}, photo ${index + 1} of ${urls.length}`
                : alt
            }
            width={200}
            height={200}
            style={thumbStyle}
          />
        </a>
      ))}
    </div>
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
  maxWidth: "min(86vw, 900px)",
  maxHeight: "78vh",
  objectFit: "contain",
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

const prevStyle: CSSProperties = {
  ...controlStyle,
  position: "absolute",
  top: "50%",
  left: 8,
  transform: "translateY(-50%)",
  zIndex: 2,
};

const nextStyle: CSSProperties = {
  ...controlStyle,
  position: "absolute",
  top: "50%",
  right: 8,
  transform: "translateY(-50%)",
  zIndex: 2,
};

export function CustomerLightboxRoot() {
  return (
    <>
      {/* Inline display:flex beats the HTML hidden attribute unless we force it. */}
      <style>{`#customer-lightbox[hidden]{display:none!important}`}</style>
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
      <div data-lightbox-stage style={stageStyle}>
        <button type="button" data-lightbox-prev style={prevStyle}>
          Previous
        </button>
        <img data-lightbox-image alt="" style={imageStyle} />
        <button type="button" data-lightbox-next style={nextStyle}>
          Next
        </button>
      </div>
    </div>
    </>
  );
}
