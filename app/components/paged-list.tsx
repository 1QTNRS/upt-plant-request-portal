import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { paginateItems } from "../lib/list-page";
import { downloadSpreadsheet } from "../lib/spreadsheet";

const pagerButtonStyle: CSSProperties = {
  boxSizing: "border-box",
  minHeight: 44,
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid #c9cccf",
  background: "#fff",
  color: "#202223",
  font: "inherit",
  cursor: "pointer",
};

export function usePagedItems<T>(items: T[], pageSize: number, resetKey: string) {
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
  }, [resetKey]);
  const slice = useMemo(
    () => paginateItems(items, page, pageSize),
    [items, page, pageSize],
  );
  return { ...slice, setPage };
}

export function ListPager({
  page,
  pageCount,
  total,
  start,
  end,
  onPage,
}: {
  page: number;
  pageCount: number;
  total: number;
  start: number;
  end: number;
  onPage: (page: number) => void;
}) {
  if (total === 0) return null;
  return (
    <div
      data-list-pager
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
        marginTop: 12,
      }}
    >
      <button
        type="button"
        data-list-prev
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        style={{
          ...pagerButtonStyle,
          cursor: page <= 1 ? "not-allowed" : "pointer",
        }}
      >
        Previous
      </button>
      <s-text color="subdued">
        Showing {start}–{end} of {total}
      </s-text>
      <button
        type="button"
        data-list-next
        disabled={page >= pageCount}
        onClick={() => onPage(page + 1)}
        style={{
          ...pagerButtonStyle,
          cursor: page >= pageCount ? "not-allowed" : "pointer",
        }}
      >
        Next
      </button>
    </div>
  );
}

export function ExportExcelButton({
  filename,
  sheetName,
  headers,
  rows,
}: {
  filename: string;
  sheetName: string;
  headers: string[];
  rows: Array<Array<string | number>>;
}) {
  return (
    <button
      type="button"
      data-export-excel
      onClick={() => downloadSpreadsheet(filename, sheetName, headers, rows)}
      style={pagerButtonStyle}
    >
      Export to Excel
    </button>
  );
}
