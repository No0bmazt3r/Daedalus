import { useEffect, useState, type RefObject } from 'react';

/**
 * Observed width of an element, in pixels.
 *
 * Window-width media queries are the wrong tool here: the Settings window is
 * itself draggable and resizable, so its content can be narrow on a wide
 * screen. What matters is how much room *this* element has, which only a
 * ResizeObserver can answer.
 *
 * Returns 0 until the first observation, so callers can tell "not measured
 * yet" from "genuinely narrow" and avoid flashing the compact layout on the
 * first frame.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Older Safari and jsdom have no ResizeObserver. Fall back to a single
    // measurement rather than leaving the layout stuck at 0 forever.
    if (typeof ResizeObserver === 'undefined') {
      setWidth(element.getBoundingClientRect().width);
      return;
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // borderBoxSize is the modern path; contentRect is the fallback.
        const next = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
        setWidth(next);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}
