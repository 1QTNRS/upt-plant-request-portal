import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { spreadsheetHref, spreadsheetXml } from "./spreadsheet";

describe("spreadsheetXml", () => {
  it("writes an Excel SpreadsheetML workbook and escapes cells", () => {
    const xml = spreadsheetXml(
      "Requests",
      ["Number", "Customer"],
      [
        ["REQ1", "Alex & Co"],
        ["REQ2", 12],
      ],
    );
    assert.match(xml, /progid="Excel.Sheet"/);
    assert.match(xml, /ss:Name="Requests"/);
    assert.match(xml, /ss:Type="String">REQ1</);
    assert.match(xml, /Alex &amp; Co/);
    assert.match(xml, /ss:Type="Number">12</);
    assert.match(spreadsheetHref("Requests", ["A"], [["b"]]), /^data:application\/vnd.ms-excel,/);
  });
});
