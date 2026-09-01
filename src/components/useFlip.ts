'use client';

import { useLayoutEffect, useRef, useCallback } from 'react';

/**
 * FLIP-animates vertical reorders of a keyed list: rows glide to their new
 * slot instead of teleporting. Rows register via the returned ref factory;
 * pass a signature string that changes exactly when the order changes.
 *
 * Positions are measured with offsetTop (layout-relative, scroll-immune)
 * and animated with WAAPI so nothing here touches React state.
 */
export function useFlipList(signature: string) {
  const nodes = useRef(new Map<string, HTMLElement>());
  const prevTops = useRef(new Map<string, number>());

  const register = useCallback(
    (key: string) => (el: HTMLElement | null) => {
      if (el) nodes.current.set(key, el);
      else nodes.current.delete(key);
    },
    [],
  );

  useLayoutEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const tops = new Map<string, number>();
    for (const [k, el] of nodes.current) tops.set(k, el.offsetTop);
    if (!reduced) {
      for (const [k, el] of nodes.current) {
        const prev = prevTops.current.get(k);
        const now = tops.get(k)!;
        if (prev !== undefined && Math.abs(prev - now) > 2) {
          el.animate(
            [
              { transform: `translateY(${prev - now}px)` },
              { transform: 'translateY(0)' },
            ],
            { duration: 520, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
          );
        }
      }
    }
    prevTops.current = tops;
  }, [signature]);

  return register;
}
