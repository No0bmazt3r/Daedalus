// Hover-to-highlight for the theme modal's colour rows.
//
// Ported from Odysseus: hovering a colour row overlays a translucent box on
// the parts of the UI that colour actually drives, so it is obvious what is
// being edited before you edit it.

import type { AdvancedKey, BaseKey } from './themes';

const OVERLAY_CLASS = 'theme-zone-highlight';

/**
 * Which part of the running UI each picker paints. The selectors point at the
 * `zone-*` classes the components carry, so they stay correct as long as the
 * components keep wearing them.
 */
export const ZONE_MAP: Partial<Record<BaseKey | AdvancedKey | 'effect', string>> = {
  // Base palette
  bg: 'main',
  text: '.zone-brand-text, main h1',
  textMuted: '.zone-sidebar .theme-text-muted',
  card: '.zone-input, .zone-ai-bubble',
  sidebar: '.zone-sidebar',
  border: '.zone-input',
  primary: '.zone-send-btn, .zone-brand',
  effect: 'main',
  // Advanced zones
  userBubbleBg: '.zone-user-bubble',
  aiBubbleBg: '.zone-ai-bubble',
  bubbleBorder: '.zone-user-bubble, .zone-ai-bubble',
  sidebarBg: '.zone-sidebar',
  brandColor: '.zone-brand',
  brandMixTo: '.zone-brand-text',
  inputBg: '.zone-input',
  inputBorder: '.zone-input',
  sendBtnBg: '.zone-send-btn',
  sendBtnHover: '.zone-send-btn',
  toggleActive: '.zone-toggle-active',
  incognitoAccent: '.incognito-text, .incognito-bg, .incognito-bg-soft',
};

export function clearZoneHighlight() {
  document.querySelectorAll('.' + OVERLAY_CLASS).forEach((el) => el.remove());
}

export function showZoneHighlight(zone?: string) {
  clearZoneHighlight();
  if (!zone) return;
  const selector = ZONE_MAP[zone as BaseKey | AdvancedKey];
  if (!selector) return;

  let els: NodeListOf<Element>;
  try {
    els = document.querySelectorAll(selector);
  } catch {
    return;
  }

  els.forEach((el) => {
    // Highlighting the modal's own controls is noise, not information.
    if (el.closest('[data-theme-modal]')) return;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const overlay = document.createElement('div');
    overlay.className = OVERLAY_CLASS;
    overlay.style.top = r.top - 2 + 'px';
    overlay.style.left = r.left - 2 + 'px';
    overlay.style.width = r.width + 4 + 'px';
    overlay.style.height = r.height + 4 + 'px';
    document.body.appendChild(overlay);
  });
}
