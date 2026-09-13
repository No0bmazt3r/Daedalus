// Drag-to-resize + collapse behaviour for the Settings navigation rail.
//
// Ported from the Odysseus settings sidebar, with two changes: state persists
// to the backend rather than localStorage (nothing lives in browser storage),
// and it is expressed as a hook rather than DOM binding.

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadOnePref, savePref, PREF_SETTINGS_UI } from '../lib/prefsClient';

export const SIDEBAR_DEFAULT_WIDTH = 220;
export const SIDEBAR_MIN_WIDTH = 150;
export const SIDEBAR_MAX_WIDTH = 340;
/** Drag narrower than this and the rail collapses instead of resisting. */
export const SIDEBAR_COLLAPSE_THRESHOLD = 110;
export const SIDEBAR_COLLAPSED_WIDTH = 60;

interface SidebarState {
  width: number;
  collapsed: boolean;
}

function clampWidth(value: unknown): number {
  const width = Number(value);
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, width));
}

export function useResizableSidebar() {
  const [width, setWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [collapsed, setCollapsed] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  // Mirrors `width` so the pointerup handler can read the final value without
  // doing work inside a setState updater (updaters must stay side-effect free).
  const widthRef = useRef(SIDEBAR_DEFAULT_WIDTH);

  // Don't write the defaults back over the stored value before it arrives.
  const hydrated = useRef(false);
  const drag = useRef({ startX: 0, startWidth: 0 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = (await loadOnePref(PREF_SETTINGS_UI)) as Partial<SidebarState> | null;
        if (cancelled || !stored) return;
        widthRef.current = clampWidth(stored.width);
        setWidth(widthRef.current);
        setCollapsed(stored.collapsed === true);
      } catch {
        /* backend down — defaults are fine for this session */
      } finally {
        if (!cancelled) hydrated.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback((next: SidebarState) => {
    if (!hydrated.current) return;
    savePref(PREF_SETTINGS_UI, next);
  }, []);

  const applyWidth = useCallback(
    (next: number, options: { persist?: boolean } = {}) => {
      const clamped = clampWidth(next);
      widthRef.current = clamped;
      setWidth(clamped);
      if (options.persist !== false) persist({ width: clamped, collapsed: false });
      return clamped;
    },
    [persist]
  );

  const applyCollapsed = useCallback(
    (next: boolean, options: { persist?: boolean } = {}) => {
      setCollapsed(next);
      if (options.persist !== false) persist({ width, collapsed: next });
    },
    [persist, width]
  );

  const toggleCollapsed = useCallback(
    () => applyCollapsed(!collapsed),
    [applyCollapsed, collapsed]
  );

  // Pointer drag. Listeners live on the window so the pointer can leave the
  // handle mid-drag without the resize sticking.
  useEffect(() => {
    if (!isResizing) return;

    const onMove = (e: PointerEvent) => {
      const raw = drag.current.startWidth + (e.clientX - drag.current.startX);
      if (raw < SIDEBAR_COLLAPSE_THRESHOLD) {
        // Let it visually shrink past the minimum so the collapse feels earned.
        setCollapsed(true);
        widthRef.current = Math.max(SIDEBAR_COLLAPSED_WIDTH, raw);
        setWidth(widthRef.current);
        return;
      }
      setCollapsed(false);
      widthRef.current = clampWidth(raw);
      setWidth(widthRef.current);
    };

    const onUp = () => {
      setIsResizing(false);
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');

      // Below the threshold the rail collapses, but its *stored* width stays
      // usable so expanding again doesn't restore a 60px sliver.
      const collapsing = widthRef.current < SIDEBAR_COLLAPSE_THRESHOLD;
      const settled = collapsing ? SIDEBAR_DEFAULT_WIDTH : clampWidth(widthRef.current);
      widthRef.current = settled;
      setWidth(settled);
      setCollapsed(collapsing);
      persist({ width: settled, collapsed: collapsing });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [isResizing, persist]);

  const onResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      drag.current = { startX: e.clientX, startWidth: width };
      setIsResizing(true);
      // Keep the resize cursor and kill text selection for the whole drag.
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [width]
  );

  /** Keyboard access on the separator: Enter/Space toggles, arrows resize. */
  const onResizeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleCollapsed();
        return;
      }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();

      if (collapsed) {
        // Any arrow key re-opens a collapsed rail first.
        applyCollapsed(false);
        return;
      }
      // At the minimum, one more ArrowLeft collapses. Without this the clamp
      // would pin it at 150px and keyboard collapse would be unreachable.
      if (e.key === 'ArrowLeft' && width <= SIDEBAR_MIN_WIDTH) {
        applyCollapsed(true);
        return;
      }
      applyWidth(width + (e.key === 'ArrowLeft' ? -16 : 16));
    },
    [applyCollapsed, applyWidth, collapsed, toggleCollapsed, width]
  );

  return {
    width: collapsed ? SIDEBAR_COLLAPSED_WIDTH : width,
    rawWidth: width,
    collapsed,
    isResizing,
    toggleCollapsed,
    onResizeStart,
    onResizeKeyDown,
  };
}
