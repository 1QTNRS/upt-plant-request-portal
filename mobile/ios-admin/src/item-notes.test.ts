import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { itemNoteLines, mobileAdminNotes } from "./item-notes";

describe("item note display", () => {
  it("shows a customer note once and leaves admin empty", () => {
    const lines = itemNoteLines({
      customerRequestNotes: "Climbing, please",
      adminNotes: "Climbing, please",
    });
    assert.deepEqual(lines, { customer: "Climbing, please" });
    assert.equal(
      mobileAdminNotes({
        customerRequestNotes: "Climbing, please",
        adminNotes: "Climbing, please",
      }),
      "",
    );
  });

  it("keeps a distinct admin note in the admin place", () => {
    const lines = itemNoteLines({
      customerRequestNotes: "Climbing, please",
      adminNotes: "Need a larger pot",
    });
    assert.deepEqual(lines, {
      customer: "Climbing, please",
      admin: "Need a larger pot",
    });
  });
});
