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
import { formatCurrency, formatDateTime } from "../lib/portal";
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

export function ExactPlantsTable({
  items,
  listingFilter,
  sort,
  pendingDismissItemId,
}: {
  items: ExactPlantCandidateRow[];
  listingFilter: string;
  sort: ExactPlantTableSortState;
  pendingDismissItemId?: string | null;
}) {
  const [viewer, setViewer] = useState<{
    urls: string[];
    alt: string;
    startIndex: number;
  } | null>(null);

  return (
    <>
      <div
        data-exact-plants-table-wrap
        style={{ overflowX: "auto", marginTop: 12 }}
      >
        <table
          data-exact-plants-table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            minWidth: 820,
            font: "inherit",
          }}
        >
          <thead>
            <tr>
              <th scope="col" style={thStyle}>
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
              <th scope="col" style={thStyle}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const listed =
                item.listing?.status === "listed" && item.listing.shopifyProductGid;
              const bucket = exactPlantListingBucket(item);
              const reviewHref = `/app/exact-plants/${item.requestItemId}?returnTo=/app/exact-plants`;
              const canDismiss = canDismissExactPlantFromQueue({
                listing: item.listing,
              });
              const confirming = pendingDismissItemId === item.requestItemId;
              const photos = item.photoUrls.filter(Boolean);
              return (
                <tr key={item.requestItemId} data-exact-plant-row={item.requestItemId}>
                  <td style={tdStyle}>
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
                          width={56}
                          height={56}
                          style={{
                            display: "block",
                            width: 56,
                            height: 56,
                            objectFit: "cover",
                            borderRadius: 6,
                          }}
                        />
                      </button>
                    ) : (
                      <span style={{ color: "#6d7175" }}>—</span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <strong>{item.title}</strong>
                  </td>
                  <td style={tdStyle}>
                    <s-link href={`/app/requests/${item.requestId}`}>
                      Request {item.requestNumber}
                    </s-link>
                  </td>
                  <td style={tdStyle}>
                    <s-badge tone={exactPlantReleaseTone(item.releaseReason)}>
                      {EXACT_PLANT_RELEASE_LABELS[item.releaseReason]}
                    </s-badge>
                  </td>
                  <td style={tdStyle}>
                    {listed ? (
                      <s-badge tone="success">Listed in EXACT PLANTS</s-badge>
                    ) : (
                      EXACT_PLANT_LISTING_FILTER_LABELS[bucket]
                    )}
                    {item.listing?.status === "failed" && item.listing.lastError ? (
                      <div style={{ color: "#d72c0d", fontSize: 12, marginTop: 4 }}>
                        {item.listing.lastError}
                      </div>
                    ) : null}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                    {formatCurrency(item.price)}
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                    {formatDateTime(new Date(item.eligibleAt))}
                  </td>
                  <td style={tdStyle}>
                    <s-stack direction="inline" gap="small">
                      {listed ? (
                        item.listing?.productAdminUrl ? (
                          <s-link href={item.listing.productAdminUrl} target="_blank">
                            Open Shopify product
                          </s-link>
                        ) : null
                      ) : (
                        <s-link href={reviewHref}>Create EXACT PLANTS Listing</s-link>
                      )}
                      {item.listing?.status === "failed" &&
                      item.listing.productAdminUrl ? (
                        <s-link href={item.listing.productAdminUrl} target="_blank">
                          Open unpublished Shopify product
                        </s-link>
                      ) : null}
                      {canDismiss ? (
                        confirming ? (
                          <Form method="post">
                            <input
                              type="hidden"
                              name="intent"
                              value="dismiss-exact-plant"
                            />
                            <input
                              type="hidden"
                              name="requestItemId"
                              value={item.requestItemId}
                            />
                            <input type="hidden" name="confirmed" value="true" />
                            <s-button
                              variant="primary"
                              tone="critical"
                              type="submit"
                            >
                              Confirm Dismiss from EXACT PLANTS
                            </s-button>
                          </Form>
                        ) : (
                          <Form method="post">
                            <input
                              type="hidden"
                              name="intent"
                              value="dismiss-exact-plant"
                            />
                            <input
                              type="hidden"
                              name="requestItemId"
                              value={item.requestItemId}
                            />
                            <s-button variant="secondary" type="submit">
                              Dismiss from EXACT PLANTS
                            </s-button>
                          </Form>
                        )
                      ) : null}
                    </s-stack>
                    {confirming ? (
                      <s-banner tone="warning">
                        <s-text>
                          This removes the plant from the EXACT PLANTS queue. No
                          Shopify product is created. The original request,
                          customer response, offer snapshot, photos, and history
                          stay.
                        </s-text>
                      </s-banner>
                    ) : null}
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
    </>
  );
}

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "1px solid #c9cccf",
  background: "#f6f6f7",
  whiteSpace: "nowrap",
};

const tdStyle: CSSProperties = {
  padding: "10px 8px",
  borderBottom: "1px solid #e1e3e5",
  verticalAlign: "top",
};

const sortButtonStyle: CSSProperties = {
  padding: "6px 4px",
  minHeight: 44,
  border: "none",
  background: "transparent",
  font: "inherit",
  cursor: "pointer",
  color: "inherit",
};
