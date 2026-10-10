'use client';

/**
 * useInfiniteScroll: scroll-based pagination helper. Uses IntersectionObserver on
 * a sentinel element at the list bottom to trigger loading more results.
 * Part of the vendored business-ui component library.
 */
import { useCallback, useEffect, useRef } from 'react';

/** Options for useInfiniteScroll. */
export type UseInfiniteScrollOptions = {
  /**
   * Callback that loads more data.
   */
  onLoadMore: () => void;
  /**
   * Whether more data remains to load.
   */
  hasMore: boolean;
  /**
   * Whether a page is currently loading.
   */
  isLoading: boolean;
  /**
   * Whether infinite scrolling is enabled.
   * @default true
   */
  enabled?: boolean;
  /**
   * IntersectionObserver threshold.
   * @default 0.1
   */
  threshold?: number;
  /**
   * IntersectionObserver rootMargin; triggers loading slightly ahead of reaching the bottom.
   * @default '50px'
   */
  rootMargin?: string;
};

/** Return value of useInfiniteScroll. */
export type UseInfiniteScrollResult = {
  /**
   * Ref to attach to the sentinel trigger element.
   */
  triggerRef: React.RefObject<HTMLDivElement | null>;
};

/**
 * Infinite-scroll hook: observes a bottom sentinel and auto-loads more when it
 * enters the viewport.
 *
 * @example
 * ```tsx
 * const { triggerRef } = useInfiniteScroll({
 *   onLoadMore: fetchMore,
 *   hasMore,
 *   isLoading: isFetchingMore,
 * })
 *
 * return (
 *   <ScrollArea>
 *     {items.map(item => <Item key={item.id} />)}
 *     <div ref={triggerRef} />
 *   </ScrollArea>
 * )
 * ```
 */
export function useInfiniteScroll({
  onLoadMore,
  hasMore,
  isLoading,
  enabled = true,
  threshold = 0.1,
  rootMargin = '50px',
}: UseInfiniteScrollOptions): UseInfiniteScrollResult {
  const triggerRef = useRef<HTMLDivElement>(null);

  const handleIntersect = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries;
      if (entry?.isIntersecting && hasMore && !isLoading && enabled) {
        onLoadMore();
      }
    },
    [hasMore, isLoading, enabled, onLoadMore],
  );

  useEffect(() => {
    const element = triggerRef.current;
    if (!element || !enabled) return;

    const observer = new IntersectionObserver(handleIntersect, {
      threshold,
      rootMargin,
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [handleIntersect, threshold, rootMargin, enabled]);

  return { triggerRef };
}
