export const ADMIN_REQUEST_PAGE_SIZE = 10;
export const CUSTOMER_REQUEST_PAGE_SIZE = 10;
export const EXACT_PLANTS_PAGE_SIZE = 25;
export const ANALYTICS_LIST_PAGE_SIZE = 10;

export type ListPage<T> = {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  items: T[];
  start: number;
  end: number;
};

export function paginateItems<T>(
  items: T[],
  page: number,
  pageSize: number,
): ListPage<T> {
  const size = Math.max(1, Math.floor(pageSize));
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Number.isFinite(page)
    ? Math.min(Math.max(1, Math.floor(page)), pageCount)
    : 1;
  const offset = (current - 1) * size;
  return {
    page: current,
    pageCount,
    pageSize: size,
    total,
    items: items.slice(offset, offset + size),
    start: total === 0 ? 0 : offset + 1,
    end: Math.min(offset + size, total),
  };
}
