import {
  formatOfferExpirationUrgencyPill,
  isOfferExpired,
} from "../lib/portal";
import { StatusBadge } from "./theme";
import { ViewerLocalTime } from "./viewer-local-time";

/** Admin offer expiration: exact time plus urgency pill. */
export function OfferExpirationDisplay({
  expiresAt,
  expiresAtIso,
}: {
  expiresAt: string;
  expiresAtIso: string;
}) {
  const expired = isOfferExpired(expiresAtIso);
  const urgencyPill = formatOfferExpirationUrgencyPill(expiresAtIso);

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 10,
        padding: "12px 14px",
        borderRadius: 10,
        background: expired ? "#fdecec" : "#fff8e6",
        border: `1px solid ${expired ? "#e5484d" : "#f0c040"}`,
      }}
    >
      {urgencyPill ? (
        <StatusBadge tone={expired ? "critical" : "warning"}>
          {urgencyPill}
        </StatusBadge>
      ) : null}
      <span style={{ fontWeight: 600, color: "#002910" }}>
        {expired ? "Offer expired" : "Offer expires"}
      </span>
      <ViewerLocalTime iso={expiresAtIso} fallback={expiresAt} />
    </div>
  );
}
