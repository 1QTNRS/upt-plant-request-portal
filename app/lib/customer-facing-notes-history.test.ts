import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { customerFacingNotesHistoryFromOffer } from "./customer-facing-notes-history";

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
});
