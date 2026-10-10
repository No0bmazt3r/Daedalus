import { useEffect, useState, type RefObject } from 'react';

/**
 * Observed size of an element, in pixels.
 *
 * Viewport units and window-width media queries are the wrong tool here: the
 * panels live inside `FloatingWindow`s that are draggable, resizable and
 * maximizable, so the screen says nothing about how much room the content has.
 * What matters is how much room *this* element has, which only a
 * ResizeObserver can answer.
 *
 * Both are 0 until the first observation, so a caller can tell "not measured
 * yet" from "genuinely small" and fall back to a sensible default for one frame
 * rather than rendering at zero.
 */
export function useElementSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Older Safari and jsdom have no ResizeObserver. One measurement beats
    // being stuck at 0 forever.
    if (typeof ResizeObserver === 'undefined') {
      const { width, height } = element.getBoundingClientRect();
      setSize({ width, height });
      return;
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // borderBoxSize is the modern path; contentRect is the fallback.
        const box = entry.borderBoxSize?.[0];
        setSize({
          width: box?.inlineSize ?? entry.contentRect.width,
          height: box?.blockSize ?? entry.contentRect.height,
        });
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}
