import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { THEME } from "./theme";

describe("request detail customer-facing notes", () => {
  it("uses light pink for read-only customer request notes", () => {
    assert.equal(THEME.customerRequestNotesBackground, "#FFCCCB");
    const editor = readFileSync(
      path.join(import.meta.dirname, "components", "ItemEditor.tsx"),
      "utf8",
    );
    assert.match(editor, /customerRequestNotesBackground/);
    assert.match(editor, /Customer notes/);
    assert.match(editor, /color: THEME\.darkGreen/);
  });

  it("shows sent-offer history in mint boxes before internal notes", () => {
    const screen = readFileSync(
      path.join(import.meta.dirname, "screens", "RequestDetailScreen.tsx"),
      "utf8",
    );
    assert.match(screen, /Customer-Facing Notes History/);
    assert.match(screen, /customerFacingNotesHistory/);
    assert.match(screen, /customerFacingHistoryEntry/);
    assert.match(screen, /customerFacingNotesHistoryBackground/);
    assert.ok(
      screen.indexOf("Customer-Facing Notes History") <
        screen.indexOf("Internal notes"),
    );
    assert.match(screen, /formatPortalDateTime\(entry\.sentAtIso\)/);
  });
});
