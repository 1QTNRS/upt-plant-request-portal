import type { RequestItem } from "./types";

type ResponseChoice = {
  sourceItemId: string;
  choice: "accept" | "reject" | "unavailable";
};

export function partitionPlantItemsByCustomerChoice(
  items: RequestItem[],
  responseItems: ResponseChoice[],
): { accepted: RequestItem[]; declined: RequestItem[] } {
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
  return {
    accepted: items.filter((item) => acceptedIds.has(item.id)),
    declined: items.filter((item) => declinedIds.has(item.id)),
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
