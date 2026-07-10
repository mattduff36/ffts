'use client';

import { Button } from '@/components/ui/button';
import { LOAD_MORE_PAGE_SIZE } from '@/lib/hooks/useLoadMorePagination';

interface LoadMorePaginationProps {
  visibleCount: number;
  totalCount: number;
  itemLabel: string;
  pageSize?: number;
  onShowMore: () => void;
}

export function LoadMorePagination({
  visibleCount,
  totalCount,
  itemLabel,
  pageSize = LOAD_MORE_PAGE_SIZE,
  onShowMore,
}: LoadMorePaginationProps) {
  const hasMoreItems = visibleCount < totalCount;

  if (hasMoreItems) {
    return (
      <div className="flex flex-col items-center gap-2 border-t border-slate-700/60 pt-4">
        <p className="text-xs text-muted-foreground">
          Showing {visibleCount} of {totalCount} {itemLabel}
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={onShowMore}
          className="border-slate-600 text-white hover:bg-slate-800"
        >
          Show More
        </Button>
      </div>
    );
  }

  if (totalCount > pageSize) {
    return (
      <p className="border-t border-slate-700/60 pt-4 text-center text-xs text-muted-foreground">
        Showing all {totalCount} {itemLabel}
      </p>
    );
  }

  return null;
}
