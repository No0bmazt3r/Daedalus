import { useEffect, useState, type RefObject } from 'react';

/**
 * Observed height of an element, in pixels. The vertical twin of
 * `useElementWidth`, and it exists for a sharper reason than symmetry.
 *
 * `vh` units are the obvious alternative and they are wrong here: every one of
 * these panels lives inside a `FloatingWindow` that is draggable, resizable and
 * maximizable, so the viewport's height says nothing about how much room the
 * content has. A window restored to 720px on a 1440px screen would size itself
 * to the screen and overflow its own frame.
 *
 * Returns 0 until the first observation, so a caller can tell "not measured
 * yet" from "genuinely short" and fall back to a sensible default for one frame
 * rather than rendering at zero.
 */
export function useElementHeight(ref: RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Older Safari and jsdom have no ResizeObserver. One measurement beats
    // being stuck at 0 forever.
    if (typeof ResizeObserver === 'undefined') {
      setHeight(element.getBoundingClientRect().height);
      return;
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setHeight(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return height;
}
