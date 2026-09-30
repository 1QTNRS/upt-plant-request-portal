import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  customerFacingNotesHistoryFromOffer,
  frozenOfferItemPlantName,
  resolveCustomerFacingHistoryPlantName,
} from "./customer-facing-notes-history";

const exactPlantItem = {
  availability: "available",
  plantName: "Customer wording",
  offeredName: "Monstera Peru Exact",
  fulfillmentType: "exact_plant",
};

const growersChoiceItem = {
  availability: "available",
  plantName: "Hoya requested",
  offeredName: "Hoya Listing Title",
  fulfillmentType: "growers_choice",
};

const notAvailableItem = {
  availability: "not_available",
  plantName: "Ghost Plant",
  offeredName: "",
  fulfillmentType: "exact_plant",
};

describe("customer-facing notes history", () => {
  it("uses frozen offer items and drops blank notes", () => {
    const sentAt = new Date("2026-08-21T16:00:00.000Z");
    const history = customerFacingNotesHistoryFromOffer(
      {
        sentAt,
        items: [
          { plantName: "Monstera", customerFacingNotes: "  Scar on one leaf.  " },
          { plantName: "Philodendron", customerFacingNotes: "" },
        ],
      },
      "REQ12",
    );
    assert.equal(history.length, 1);
    assert.equal(history[0]?.note, "Scar on one leaf.");
    assert.equal(history[0]?.plantName, "Monstera");
    assert.equal(history[0]?.requestNumber, "REQ12");
    assert.equal(history[0]?.sentAtIso, sentAt.toISOString());
  });

  it("returns empty history when no offer was sent", () => {
    assert.deepEqual(customerFacingNotesHistoryFromOffer(null, "REQ1"), []);
  });

  it("freezes offered plant name for available exact plant offers", () => {
    assert.equal(frozenOfferItemPlantName(exactPlantItem), "Monstera Peru Exact");
    const history = customerFacingNotesHistoryFromOffer(
      {
        sentAt: new Date("2026-08-21T16:00:00.000Z"),
        items: [
          {
            plantName: frozenOfferItemPlantName(exactPlantItem),
            customerFacingNotes: "Exact plant note.",
          },
        ],
      },
      "REQ1",
    );
    assert.equal(history[0]?.plantName, "Monstera Peru Exact");
    assert.equal(history[0]?.note, "Exact plant note.");
  });

  it("preserves Grower's Choice naming when sending offers", () => {
    assert.equal(frozenOfferItemPlantName(growersChoiceItem), "Hoya Listing Title");
    const withoutOfferedName = {
      ...growersChoiceItem,
      offeredName: "",
    };
    assert.equal(frozenOfferItemPlantName(withoutOfferedName), "Hoya requested");
  });

  it("freezes original requested plant name for not available items", () => {
    assert.equal(frozenOfferItemPlantName(notAvailableItem), "Ghost Plant");
    const history = customerFacingNotesHistoryFromOffer(
      {
        sentAt: new Date("2026-08-21T16:00:00.000Z"),
        items: [
          {
            plantName: frozenOfferItemPlantName(notAvailableItem),
            customerFacingNotes: "Not currently in inventory.",
          },
        ],
      },
      "REQ2",
    );
    assert.equal(history[0]?.plantName, "Ghost Plant");
    assert.equal(history[0]?.note, "Not currently in inventory.");
  });

  it("falls back to RequestItem plant name when legacy snapshots left plantName blank", () => {
    assert.equal(
      resolveCustomerFacingHistoryPlantName({
        plantName: "",
        customerFacingNotes: "Frozen only on offer.",
        requestedPlantName: "Hoya clemensiorum ‘Dragon Scale’",
      }),
      "Hoya clemensiorum ‘Dragon Scale’",
    );
    const history = customerFacingNotesHistoryFromOffer(
      {
        sentAt: new Date("2026-08-21T16:00:00.000Z"),
        items: [
          {
            plantName: "",
            customerFacingNotes: "Frozen only on offer.",
            requestedPlantName: "Hoya clemensiorum ‘Dragon Scale’",
          },
        ],
      },
      "REQ3",
    );
    assert.equal(history[0]?.plantName, "Hoya clemensiorum ‘Dragon Scale’");
    assert.equal(history[0]?.note, "Frozen only on offer.");
  });

  it("prefers frozen offer plant name over RequestItem when both exist", () => {
    assert.equal(
      resolveCustomerFacingHistoryPlantName({
        plantName: "Monstera Peru Exact",
        customerFacingNotes: "Note",
        requestedPlantName: "Monstera Peru",
      }),
      "Monstera Peru Exact",
    );
  });

  it("shows each not available plant with its own requested name", () => {
    const history = customerFacingNotesHistoryFromOffer(
      {
        sentAt: new Date("2026-08-21T16:00:00.000Z"),
        items: [
          {
            plantName: "",
            customerFacingNotes: "Out of stock.",
            requestedPlantName: "Philodendron verrucosum",
          },
          {
            plantName: "",
            customerFacingNotes: "Try again in spring.",
            requestedPlantName: "Anthurium clarinervium",
          },
        ],
      },
      "REQ4",
    );
    assert.equal(history.length, 2);
    assert.equal(history[0]?.plantName, "Philodendron verrucosum");
    assert.equal(history[0]?.note, "Out of stock.");
    assert.equal(history[1]?.plantName, "Anthurium clarinervium");
    assert.equal(history[1]?.note, "Try again in spring.");
  });

  it("does not surface unsent draft notes — only frozen offer customerFacingNotes", () => {
    const history = customerFacingNotesHistoryFromOffer(
      {
        sentAt: new Date("2026-08-21T16:00:00.000Z"),
        items: [{ plantName: "Monstera", customerFacingNotes: "Sent note." }],
      },
      "REQ5",
    );
    assert.equal(history.length, 1);
    assert.equal(history[0]?.note, "Sent note.");
    assert.deepEqual(
      customerFacingNotesHistoryFromOffer(
        {
          sentAt: new Date("2026-08-21T16:00:00.000Z"),
          items: [{ plantName: "Monstera", customerFacingNotes: "" }],
        },
        "REQ5",
      ),
      [],
    );
  });
});
