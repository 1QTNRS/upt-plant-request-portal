import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";

import { paginateItems } from "../lib/list-page";
import { downloadSpreadsheet } from "../lib/spreadsheet";

export const pagerArrowStyle: CSSProperties = {
  boxSizing: "border-box",
  width: 36,
  height: 36,
  minWidth: 36,
  padding: 0,
  border: "none",
  borderRadius: 8,
  background: "transparent",
  color: "#002910",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

const exportButtonStyle: CSSProperties = {
  boxSizing: "border-box",
  minHeight: 36,
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid #002910",
  background: "#002910",
  color: "#fff",
  font: "inherit",
  cursor: "pointer",
};

function keepWindowScroll(run: () => void) {
  if (typeof window === "undefined") {
    run();
    return;
  }
  const top = window.scrollY;
  run();
  requestAnimationFrame(() => {
    window.scrollTo({ top, left: 0, behavior: "instant" });
  });
}

export function usePagedItems<T>(items: T[], pageSize: number, resetKey: string) {
  const [page, setPageState] = useState(1);
  useEffect(() => {
    setPageState(1);
  }, [resetKey]);
  const slice = useMemo(
    () => paginateItems(items, page, pageSize),
    [items, page, pageSize],
  );
  const setPage = (next: number) => {
    keepWindowScroll(() => setPageState(next));
  };
  return { ...slice, setPage };
}

export function PagerChevron({ direction }: { direction: "prev" | "next" }) {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
      {direction === "prev" ? (
        <path
          d="M10.5 3.5 5.5 8l5 4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M5.5 3.5 10.5 8l-5 4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
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
        gap: 4,
        marginTop: 12,
        minHeight: 36,
      }}
    >
      <button
        type="button"
        data-list-prev
        aria-label="Previous page"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        style={{
          ...pagerArrowStyle,
          opacity: page <= 1 ? 0.35 : 1,
          cursor: page <= 1 ? "default" : "pointer",
        }}
      >
        <PagerChevron direction="prev" />
      </button>
      <s-text color="subdued">
        <span style={{ display: "inline-block", minWidth: "11ch", textAlign: "center" }}>
          {start}–{end} of {total}
        </span>
      </s-text>
      <button
        type="button"
        data-list-next
        aria-label="Next page"
        disabled={page >= pageCount}
        onClick={() => onPage(page + 1)}
        style={{
          ...pagerArrowStyle,
          opacity: page >= pageCount ? 0.35 : 1,
          cursor: page >= pageCount ? "default" : "pointer",
        }}
      >
        <PagerChevron direction="next" />
      </button>
    </div>
  );
}

export function PagedFrame({
  pageSize,
  rowHeight,
  children,
}: {
  pageSize: number;
  rowHeight: number;
  children: ReactNode;
}) {
  return (
    <div
      data-paged-frame
      style={{ minHeight: pageSize * rowHeight }}
    >
      {children}
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
      style={exportButtonStyle}
    >
      Export to Excel
    </button>
  );
}
