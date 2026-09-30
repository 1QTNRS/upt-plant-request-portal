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

  it("shows plant-first sent-offer history in mint boxes before internal notes", () => {
    const screen = readFileSync(
      path.join(import.meta.dirname, "screens", "RequestDetailScreen.tsx"),
      "utf8",
    );
    assert.match(screen, /Customer-Facing Notes History/);
    assert.match(screen, /customerFacingNotesHistory\.map/);
    assert.match(screen, /customerFacingHistoryEntry/);
    assert.match(screen, /customerFacingNotesHistoryBackground/);
    assert.match(screen, /customerFacingHistoryPlant/);
    assert.match(screen, /\{entry\.plantName\}/);
    assert.match(screen, /entry\.note/);
    assert.doesNotMatch(
      screen,
      /customerFacingHistory[\s\S]*formatPortalDateTime\(entry\.sentAtIso\)/,
    );
    assert.ok(
      screen.indexOf("Customer-Facing Notes History") <
        screen.indexOf("Internal notes"),
    );
  });

  it("keeps one mint entry per plant note and omits empty notes at the API layer", () => {
    const screen = readFileSync(
      path.join(import.meta.dirname, "screens", "RequestDetailScreen.tsx"),
      "utf8",
    );
    assert.match(screen, /customerFacingNotesHistory\.length > 0/);
    assert.match(screen, /\$\{entry\.plantName\}-\$\{index\}/);
    const historyHelper = readFileSync(
      path.join(
        import.meta.dirname,
        "..",
        "..",
        "..",
        "app",
        "lib",
        "customer-facing-notes-history.ts",
      ),
      "utf8",
    );
    assert.match(historyHelper, /filter\(\(entry\) => entry\.note\.length > 0\)/);
  });
});
