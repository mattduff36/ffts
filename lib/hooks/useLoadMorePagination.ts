import { useMemo, useState } from 'react';

export const LOAD_MORE_PAGE_SIZE = 50;

interface UseLoadMorePaginationOptions {
  pageSize?: number;
  resetKey: string;
}

export function useLoadMorePagination<T>(
  items: T[],
  { pageSize = LOAD_MORE_PAGE_SIZE, resetKey }: UseLoadMorePaginationOptions,
) {
  const [pagination, setPagination] = useState({ key: '', limit: pageSize });
  const visibleItemLimit = pagination.key === resetKey ? pagination.limit : pageSize;

  const visibleItems = useMemo(
    () => items.slice(0, visibleItemLimit),
    [items, visibleItemLimit],
  );

  function showMore() {
    setPagination({
      key: resetKey,
      limit: visibleItemLimit + pageSize,
    });
  }

  return {
    visibleItems,
    visibleItemLimit,
    showMore,
  };
}
