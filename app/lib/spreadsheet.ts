function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function cellXml(value: string | number): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<Cell><Data ss:Type="Number">${value}</Data></Cell>`;
  }
  return `<Cell><Data ss:Type="String">${escapeXml(String(value))}</Data></Cell>`;
}

/** SpreadsheetML 2003 workbook Excel opens as a real .xls file. */
export function spreadsheetXml(
  sheetName: string,
  headers: string[],
  rows: Array<Array<string | number>>,
): string {
  const headerRow = `<Row>${headers.map((header) => cellXml(header)).join("")}</Row>`;
  const body = rows
    .map((row) => `<Row>${row.map((value) => cellXml(value)).join("")}</Row>`)
    .join("");
  const name = escapeXml(sheetName.slice(0, 31) || "Sheet1");
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="${name}">
  <Table>
${headerRow}
${body}
  </Table>
 </Worksheet>
</Workbook>
`;
}

export function spreadsheetHref(
  sheetName: string,
  headers: string[],
  rows: Array<Array<string | number>>,
): string {
  return `data:application/vnd.ms-excel,${encodeURIComponent(
    spreadsheetXml(sheetName, headers, rows),
  )}`;
}

export function downloadSpreadsheet(
  filename: string,
  sheetName: string,
  headers: string[],
  rows: Array<Array<string | number>>,
): void {
  const blob = new Blob([spreadsheetXml(sheetName, headers, rows)], {
    type: "application/vnd.ms-excel",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".xls") ? filename : `${filename}.xls`;
  link.click();
  URL.revokeObjectURL(url);
}
