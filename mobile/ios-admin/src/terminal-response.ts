import type { RequestItem } from "./types";

type ResponseChoice = {
  sourceItemId: string;
  choice: "accept" | "reject" | "unavailable";
};

export function partitionPlantItemsByCustomerChoice(
  items: RequestItem[],
  responseItems: ResponseChoice[],
): { accepted: RequestItem[]; declined: RequestItem[]; notAvailable: RequestItem[] } {
  const acceptedIds = new Set(
    responseItems
      .filter((item) => item.choice === "accept")
      .map((item) => item.sourceItemId),
  );
  const declinedIds = new Set(
    responseItems
      .filter((item) => item.choice === "reject")
      .map((item) => item.sourceItemId),
  );
  const unavailableIds = new Set(
    responseItems
      .filter((item) => item.choice === "unavailable")
      .map((item) => item.sourceItemId),
  );
  return {
    accepted: items.filter((item) => acceptedIds.has(item.id)),
    declined: items.filter((item) => declinedIds.has(item.id)),
    notAvailable: items.filter(
      (item) =>
        unavailableIds.has(item.id) ||
        (item.availability === "not_available" &&
          !acceptedIds.has(item.id) &&
          !declinedIds.has(item.id)),
    ),
  };
}

export function shouldGroupTerminalPlantItems(
  status: string,
  responseItems: ResponseChoice[] | null | undefined,
): boolean {
  if (!responseItems?.length) return false;
  const hasChoice = responseItems.some(
    (item) => item.choice === "accept" || item.choice === "reject",
  );
  if (!hasChoice) return false;
  if (status === "Pending") return true;
  return status === "Closed" || status === "Expired";
}

/**
 * Before the customer accepts or rejects purchasable plants: OFFERED then NOT AVAILABLE
 * from frozen item availability. Response state wins over request status.
 */
export function shouldGroupPendingOfferItems(
  status: string,
  sentOffer: boolean,
  responseItems: ResponseChoice[] | null | undefined,
): boolean {
  if (shouldGroupTerminalPlantItems(status, responseItems)) return false;
  if (status === "New") return false;
  if (status === "Pending" || status === "Expired") return sentOffer;
  if (status === "Closed") return true;
  return false;
}

export function partitionPendingOfferItems(
  items: RequestItem[],
): { offered: RequestItem[]; notAvailable: RequestItem[] } {
  return {
    offered: items.filter((item) => item.availability !== "not_available"),
    notAvailable: items.filter((item) => item.availability === "not_available"),
  };
}
