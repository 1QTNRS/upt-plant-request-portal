import { useState, type CSSProperties } from "react";
import { Form } from "react-router";

import type { ExactPlantCandidateRow } from "../lib/exact-plants.server";
import {
  canDismissExactPlantFromQueue,
  EXACT_PLANT_LISTING_FILTER_LABELS,
  EXACT_PLANT_RELEASE_LABELS,
  exactPlantListingBucket,
  exactPlantReleaseTone,
  nextExactPlantColumnSort,
  type ExactPlantTableSort,
  type ExactPlantTableSortState,
} from "../lib/exact-plants";
import { formatCurrency, formatDate } from "../lib/portal";
import { AdminConfirmDialog } from "./admin-confirm-dialog";
import { AdminPhotoLightbox } from "./admin-photo-lightbox";

const SORTABLE: Array<{
  column: ExactPlantTableSort;
  label: string;
  align?: "right";
}> = [
  { column: "name", label: "Plant name" },
  { column: "request", label: "Request #" },
  { column: "reason", label: "Eligibility" },
  { column: "listing", label: "Listing status" },
  { column: "price", label: "Price", align: "right" },
  { column: "date", label: "Date" },
];

const ELIGIBILITY_TONE: Record<
  ReturnType<typeof exactPlantReleaseTone>,
  { background: string; color: string }
> = {
  warning: { background: "#fff1e3", color: "#7a4d00" },
  caution: { background: "#fff5d6", color: "#6b4f00" },
  info: { background: "#e6f2ff", color: "#1f4e79" },
};

export function ExactPlantsTable({
  items,
  listingFilter,
  sort,
  mode = "queue",
}: {
  items: ExactPlantCandidateRow[];
  listingFilter: string;
  sort: ExactPlantTableSortState;
  mode?: "queue" | "dismissed";
}) {
  const [viewer, setViewer] = useState<{
    urls: string[];
    alt: string;
    startIndex: number;
  } | null>(null);
  const [dismissItemId, setDismissItemId] = useState<string | null>(null);
  const dismissed = mode === "dismissed";

  return (
    <>
      <style>{tableLayoutCss}</style>
      <div data-exact-plants-table-wrap className="exact-plants-table-wrap">
        <table data-exact-plants-table className="exact-plants-table">
          <thead>
            <tr>
              <th scope="col" className="exact-plants-col-photo" style={thStyle}>
                Photo
              </th>
              {SORTABLE.map((column) => {
                const active = sort.column === column.column;
                const next = nextExactPlantColumnSort(sort, column.column);
                const arrow = active ? (sort.direction === "desc" ? "↓" : "↑") : "";
                return (
                  <th
                    key={column.column}
                    scope="col"
                    className={`exact-plants-col-${column.column}`}
                    style={{
                      ...thStyle,
                      textAlign: column.align === "right" ? "right" : "left",
                    }}
                    aria-sort={
                      active
                        ? sort.direction === "desc"
                          ? "descending"
                          : "ascending"
                        : "none"
                    }
                  >
                    <Form method="get" style={{ display: "inline" }}>
                      <input type="hidden" name="listing" value={listingFilter} />
                      <input type="hidden" name="sort" value={next.column} />
                      <input type="hidden" name="dir" value={next.direction} />
                      <button
                        type="submit"
                        data-exact-plant-sort={column.column}
                        aria-label={
                          active
                            ? `${column.label}, ${sort.direction === "asc" ? "ascending" : "descending"}. Activate to reverse.`
                            : `Sort by ${column.label}, ascending`
                        }
                        style={{
                          ...sortButtonStyle,
                          fontWeight: active ? 700 : 600,
                        }}
                      >
                        {column.label}
                        {arrow ? ` ${arrow}` : ""}
                      </button>
                    </Form>
                  </th>
                );
              })}
              <th scope="col" className="exact-plants-col-actions" style={thStyle}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const listed =
                item.listing?.status === "listed" && item.listing.shopifyProductGid;
              const bucket = exactPlantListingBucket(item);
              const reviewHref = `/app/exact-plants/${item.requestItemId}?returnTo=/app/exact-plants`;
              const canDismiss = canDismissExactPlantFromQueue({
                listing: item.listing,
              });
              const dismissedAt = item.dismissedAt;
              const photos = item.photoUrls.filter(Boolean);
              const eligibilityTone = ELIGIBILITY_TONE[exactPlantReleaseTone(item.releaseReason)];
              return (
                <tr
                  key={item.requestItemId}
                  data-exact-plant-row={item.requestItemId}
                  className={index % 2 === 1 ? "exact-plants-row-alt" : undefined}
                >
                  <td className="exact-plants-col-photo" style={tdStyle}>
                    {photos[0] ? (
                      <button
                        type="button"
                        data-exact-plant-photo
                        onClick={() =>
                          setViewer({
                            urls: photos,
                            alt: item.title,
                            startIndex: 0,
                          })
                        }
                        aria-label={`View photos of ${item.title}`}
                        style={{
                          padding: 0,
                          border: "none",
                          background: "none",
                          cursor: "zoom-in",
                        }}
                      >
                        <img
                          src={photos[0]}
                          alt={item.title}
                          width={44}
                          height={44}
                          style={{
                            display: "block",
                            width: 44,
                            height: 44,
                            objectFit: "cover",
                            borderRadius: 6,
                          }}
                        />
                      </button>
                    ) : (
                      <span style={{ color: "#6d7175" }}>—</span>
                    )}
                  </td>
                  <td className="exact-plants-col-name" style={tdStyle}>
                    <strong>{item.title}</strong>
                  </td>
                  <td className="exact-plants-col-request" style={tdStyle}>
                    <s-link href={`/app/requests/${item.requestId}`}>
                      {item.requestNumber}
                    </s-link>
                  </td>
                  <td className="exact-plants-col-reason" style={tdStyle}>
                    <span
                      data-exact-plant-eligibility
                      style={{
                        display: "inline-block",
                        maxWidth: "100%",
                        whiteSpace: "normal",
                        overflowWrap: "break-word",
                        lineHeight: 1.25,
                        padding: "3px 6px",
                        borderRadius: 6,
                        background: eligibilityTone.background,
                        color: eligibilityTone.color,
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      {EXACT_PLANT_RELEASE_LABELS[item.releaseReason]}
                    </span>
                  </td>
                  <td className="exact-plants-col-listing" style={tdStyle}>
                    {dismissed ? (
                      <s-badge>Dismissed</s-badge>
                    ) : listed ? (
                      <s-badge tone="success">
                        {EXACT_PLANT_LISTING_FILTER_LABELS.listed}
                      </s-badge>
                    ) : (
                      EXACT_PLANT_LISTING_FILTER_LABELS[bucket]
                    )}
                    {item.listing?.status === "failed" && item.listing.lastError ? (
                      <div style={{ color: "#d72c0d", fontSize: 12, marginTop: 4 }}>
                        {item.listing.lastError}
                      </div>
                    ) : null}
                  </td>
                  <td
                    className="exact-plants-col-price"
                    style={{ ...tdStyle, textAlign: "right" }}
                  >
                    {formatCurrency(item.price)}
                  </td>
                  <td className="exact-plants-col-date" style={tdStyle}>
                    <time
                      data-exact-plant-date
                      dateTime={dismissedAt || item.eligibleAt}
                    >
                      {formatDate(new Date(dismissedAt || item.eligibleAt))}
                    </time>
                  </td>
                  <td className="exact-plants-col-actions" style={tdStyle}>
                    <s-stack direction="block" gap="small">
                      {dismissed ? (
                        <s-text color="subdued">No listing</s-text>
                      ) : listed ? (
                        item.listing?.productAdminUrl ? (
                          <s-link href={item.listing.productAdminUrl} target="_blank">
                            Open Shopify product
                          </s-link>
                        ) : null
                      ) : (
                        <s-link href={reviewHref}>Create listing</s-link>
                      )}
                      {item.listing?.status === "failed" &&
                      item.listing.productAdminUrl &&
                      !dismissed ? (
                        <s-link href={item.listing.productAdminUrl} target="_blank">
                          Open unpublished Shopify product
                        </s-link>
                      ) : null}
                      {canDismiss && !dismissed ? (
                        <s-button
                          variant="secondary"
                          type="button"
                          onClick={() => setDismissItemId(item.requestItemId)}
                        >
                          Dismiss
                        </s-button>
                      ) : null}
                    </s-stack>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {viewer ? (
        <AdminPhotoLightbox
          urls={viewer.urls}
          alt={viewer.alt}
          startIndex={viewer.startIndex}
          onClose={() => setViewer(null)}
        />
      ) : null}
      {dismissItemId ? (
        <AdminConfirmDialog
          title="Dismiss from EXACT PLANTS?"
          confirmLabel="Confirm Dismiss from EXACT PLANTS"
          onCancel={() => setDismissItemId(null)}
          confirm={
            <Form method="post">
              <input type="hidden" name="intent" value="dismiss-exact-plant" />
              <input type="hidden" name="requestItemId" value={dismissItemId} />
              <input type="hidden" name="confirmed" value="true" />
              <s-button variant="primary" tone="critical" type="submit">
                Confirm Dismiss from EXACT PLANTS
              </s-button>
            </Form>
          }
        >
          <s-text>
            This removes the plant from the EXACT PLANTS queue. No Shopify
            product is created. The original request, customer response, offer
            snapshot, photos, and history stay. You can still find it on the
            Dismissed tab.
          </s-text>
        </AdminConfirmDialog>
      ) : null}
    </>
  );
}

const tableLayoutCss = `
  .exact-plants-table-wrap {
    margin-top: 12px;
    width: 100%;
  }
  .exact-plants-table {
    width: 100%;
    table-layout: fixed;
    border-collapse: separate;
    border-spacing: 0;
    font: inherit;
  }
  .exact-plants-col-photo { width: 52px; }
  .exact-plants-col-name { width: auto; }
  .exact-plants-col-request { width: 4.6rem; }
  .exact-plants-col-reason { width: 7.4rem; }
  .exact-plants-col-listing { width: 5.8rem; }
  .exact-plants-col-price { width: 4.6rem; }
  .exact-plants-col-date { width: 6.4rem; }
  .exact-plants-col-actions { width: 7.2rem; }
  .exact-plants-table tbody td {
    border-top: 1px solid #c9cccf;
    border-bottom: 1px solid #8c9196;
  }
  .exact-plants-table tbody td:first-child {
    border-left: 3px solid #8c9196;
  }
  .exact-plants-table tbody td:last-child {
    border-right: 1px solid #c9cccf;
  }
  .exact-plants-table th,
  .exact-plants-table td {
    overflow-wrap: anywhere;
  }
  .exact-plants-col-request,
  .exact-plants-col-price,
  .exact-plants-col-date {
    white-space: nowrap;
    overflow-wrap: normal;
  }
  .exact-plants-row-alt td {
    background: #f6f6f7;
  }
  @media (max-width: 720px) {
    .exact-plants-table-wrap {
      overflow-x: auto;
    }
    .exact-plants-table {
      min-width: 680px;
    }
  }
`;

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "8px 6px",
  borderBottom: "2px solid #8c9196",
  background: "#f1f2f3",
  whiteSpace: "nowrap",
  verticalAlign: "bottom",
};

const tdStyle: CSSProperties = {
  padding: "10px 6px",
  borderBottom: "2px solid #c9cccf",
  verticalAlign: "top",
};

const sortButtonStyle: CSSProperties = {
  padding: "4px 0",
  minHeight: 44,
  border: "none",
  background: "transparent",
  font: "inherit",
  cursor: "pointer",
  color: "inherit",
};
