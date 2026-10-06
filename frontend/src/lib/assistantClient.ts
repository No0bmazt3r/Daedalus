// Client for Settings → Assistant — backend `api/assistant.py`.
//
// The site timezone, the system prompt, and the safety wording and extra
// blocked phrases. See `services/assistant_settings.py`.

import { request } from './http';

export type RefusalKind = 'control' | 'data' | 'override' | 'custom';

export interface AssistantSettings {
  /** Picked by hand. Null means auto-detect. */
  timezone: string | null;
  /** What the browser last reported. */
  detected_timezone: string | null;
  /** Null means the built-in default is in force. */
  system_prompt: string | null;
  refusals: Partial<Record<RefusalKind, string>>;
  blocked_phrases: string[];
}

export interface AssistantStatus {
  settings: AssistantSettings;
  effective_timezone: string;
  timezone_source: 'manual' | 'env' | 'browser' | 'machine';
  frozen: boolean;
  defaults: { system_prompt: string; refusals: Record<RefusalKind, string> };
  built_in_rules: { kind: RefusalKind; label: string; examples: string[] }[];
}

/** A null field resets it to the default. */
export type AssistantPatch = {
  timezone?: string | null;
  detected_timezone?: string | null;
  system_prompt?: string | null;
  refusals?: Partial<Record<RefusalKind, string | null>>;
  blocked_phrases?: string[];
};

export const fetchAssistant = () => request<AssistantStatus>('/api/assistant/config');

export const saveAssistant = (patch: AssistantPatch) =>
  request<AssistantStatus>('/api/assistant/config', { method: 'PUT', body: JSON.stringify(patch) });

/** The browser's own zone, e.g. "Asia/Kuala_Lumpur". */
export const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Tell the backend which zone this browser is in, if it changed. Quiet on failure. */
export async function reportBrowserTimezone(): Promise<void> {
  try {
    const zone = browserTimezone();
    const { settings } = await fetchAssistant();
    if (zone && settings.detected_timezone !== zone) await saveAssistant({ detected_timezone: zone });
  } catch {
    // Auto-detect is a convenience; a backend that is down changes nothing here.
  }
}
