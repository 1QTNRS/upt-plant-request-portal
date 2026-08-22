import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mergeAdminItemDraft,
  parseNumberDraft,
  sanitizeNumberDraft,
  shouldSelectZeroOnFocus,
  type AdminItemDraft,
} from "./admin-item-draft";

const available: AdminItemDraft = {
  offeredName: "Monstera",
  customerFacingNotes: "One scar",
  fulfillmentType: "exact_plant",
  unavailableReason: "not in our current inventory",
  price: 0,
  weightLbs: 0,
};

const notAvailable: AdminItemDraft = {
  ...available,
  fulfillmentType: "not_available",
  unavailableReason: "currently not in UPT prop circulation",
  price: 85,
  weightLbs: 2.5,
  customerFacingNotes: "We will not have this until spring.",
};

describe("sanitizeNumberDraft", () => {
  it("replaces a leading zero so 0 then 85 becomes 85, not 085", () => {
    assert.equal(sanitizeNumberDraft("085"), "85");
    assert.equal(sanitizeNumberDraft("0085"), "85");
  });

  it("keeps a lone zero and valid decimals", () => {
    assert.equal(sanitizeNumberDraft("0"), "0");
    assert.equal(sanitizeNumberDraft("0.5"), "0.5");
    assert.equal(sanitizeNumberDraft("0.50"), "0.50");
    assert.equal(sanitizeNumberDraft("85.25"), "85.25");
  });

  it("allows an in-progress decimal", () => {
    assert.equal(sanitizeNumberDraft("85."), "85.");
    assert.equal(sanitizeNumberDraft("0."), "0.");
  });

  it("strips characters that are not digits or a decimal", () => {
    assert.equal(sanitizeNumberDraft("8a5"), "85");
    assert.equal(sanitizeNumberDraft(""), "");
  });
});

describe("parseNumberDraft", () => {
  it("treats empty and non-numeric as zero without inventing a leading zero", () => {
    assert.equal(parseNumberDraft(""), 0);
    assert.equal(parseNumberDraft("85"), 85);
    assert.equal(parseNumberDraft("85.25"), 85.25);
    assert.equal(parseNumberDraft("0.5"), 0.5);
  });
});

describe("shouldSelectZeroOnFocus", () => {
  it("selects an untouched default zero so the next keystroke replaces it", () => {
    assert.equal(shouldSelectZeroOnFocus("0"), true);
    assert.equal(shouldSelectZeroOnFocus("85"), false);
    assert.equal(shouldSelectZeroOnFocus("0.5"), false);
  });
});

describe("mergeAdminItemDraft", () => {
  it("keeps a dirty Not Available choice when the server still says Available", () => {
    const merged = mergeAdminItemDraft(notAvailable, available, {
      fulfillmentType: true,
      unavailableReason: true,
    });
    assert.equal(merged.fulfillmentType, "not_available");
    assert.equal(merged.unavailableReason, "currently not in UPT prop circulation");
    assert.equal(merged.offeredName, "Monstera");
  });

  it("keeps dirty price, weight and notes across a sibling photo reload", () => {
    const local: AdminItemDraft = {
      ...available,
      price: 85,
      weightLbs: 3.2,
      customerFacingNotes: "Typed but not blurred yet",
    };
    const merged = mergeAdminItemDraft(local, available, {
      price: true,
      weightLbs: true,
      customerFacingNotes: true,
    });
    assert.equal(merged.price, 85);
    assert.equal(merged.weightLbs, 3.2);
    assert.equal(merged.customerFacingNotes, "Typed but not blurred yet");
  });

  it("takes server values for fields the merchant has not edited", () => {
    const merged = mergeAdminItemDraft(available, notAvailable, {});
    assert.deepEqual(merged, notAvailable);
  });

  it("does not let one item's dirty flags rewrite another item's server values", () => {
    const other: AdminItemDraft = {
      offeredName: "Hoya",
      customerFacingNotes: "",
      fulfillmentType: "exact_plant",
      unavailableReason: "not in our current inventory",
      price: 40,
      weightLbs: 1,
    };
    const merged = mergeAdminItemDraft(other, other, {
      fulfillmentType: true,
      price: true,
    });
    assert.equal(merged.offeredName, "Hoya");
    assert.equal(merged.fulfillmentType, "exact_plant");
    assert.equal(merged.price, 40);
  });
});
