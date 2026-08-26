import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { sendOfferHoldControlsEnabled } from "./offer-controls";

describe("Send offer hold controls", () => {
  it("disables expiration and ADD ON when nothing is purchasable", () => {
    assert.equal(
      sendOfferHoldControlsEnabled([{ availability: "not_available" }]),
      false,
    );
  });

  it("re-enables hold controls when an item becomes purchasable", () => {
    assert.equal(
      sendOfferHoldControlsEnabled([
        { availability: "not_available" },
        { availability: "available" },
      ]),
      true,
    );
  });

  it("greys out those controls on the request page and keeps Send offer", () => {
    const source = readFileSync(
      path.join(import.meta.dirname, "screens", "RequestDetailScreen.tsx"),
      "utf8",
    );
    assert.match(source, /sendOfferHoldControlsEnabled/);
    assert.match(source, /Nothing on this request is purchasable/);
    assert.match(source, /pointerEvents=\{holdControlsOn \? "auto" : "none"\}/);
    assert.match(source, /intent: "send-offer"/);
    assert.match(source, /Send offer/);
  });
});
