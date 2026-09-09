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
