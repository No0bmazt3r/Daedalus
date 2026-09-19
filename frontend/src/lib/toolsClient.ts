// The agent tool layer — /api/tools (Layer 8).
//
// The catalogue is generated on the backend from the same declarations the
// dispatcher gates on, so this client deliberately carries no second copy of
// "which tools exist" or "what they are allowed to do". A panel that listed
// tools itself would eventually disagree with the thing enforcing them, and the
// disagreement would be invisible until something was wrongly allowed.

import { request } from './http';

/** What a tool touches. The unit the runtime gate reasons about. */
export type ToolEffect =
  | 'execute_code'
  | 'read_sensor'
  | 'read_corpus'
  | 'read_graph'
  | 'read_transcript'
  | 'read_system'
  | 'clock'
  | 'inference'
  | 'user_interaction'
  | 'network_egress'
  | 'write'
  | 'admin';

/**
 * Where a result's content came from.
 *
 * `system` is Daedalus' own output. `corpus` is text out of an ingested
 * document — quotable as evidence, never obeyed as instruction. `transcript` is
 * something the model said earlier: untrusted *and* stale, which is why
 * everything carrying it is `citable: false`.
 */
export type ToolIntegrity = 'system' | 'corpus' | 'transcript';

export interface ToolParam {
  name: string;
  type: string;
  description: string;
  required: boolean;
  default: unknown;
  /** The permitted set, when there is one. Rejected at dispatch, not coerced. */
  enum: string[] | null;
  minimum: number | null;
  maximum: number | null;
  /**
   * A value that actually works, written as the string you would type. Null
   * where no literal is honest — a `session_id` has to come from
   * `list_sessions` first, and a made-up one would only teach a value that
   * cannot work.
   */
  example: string | null;
}

export interface AgentTool {
  name: string;
  category: string;
  summary: string;
  effects: ToolEffect[];
  integrity: ToolIntegrity;
  /** False when the result may never be cited as evidence — Rule 3's boundary. */
  citable: boolean;
  available: boolean;
  /** Registered but not usable yet, e.g. waiting on M2's ingestion. */
  blocked_by: string | null;
  /** Why it may not run — the effect gate, or the per-tool switch below. */
  refused_because: string | null;
  /**
   * Switched off by hand. Its own field, not something to read out of
   * `refused_because`: "I turned this off" and "the gate refuses this" are
   * different sentences, and only the first one has a switch to flip back.
   */
  disabled: boolean;
  params: ToolParam[];
}

/** A tool the reference implementation has and this one deliberately does not. */
export interface ExcludedTool {
  name: string;
  category: string;
  reason: string;
}

/** One tool an operator has switched off, and when. */
export interface DisabledTool {
  tool: string;
  disabled_at: string;
  note: string | null;
}

/** One effect an operator has deliberately closed, and when. */
export interface LockedEffect {
  effect: ToolEffect;
  locked_at: string;
  note: string | null;
}

export interface ToolCatalogue {
  surface: string;
  categories: { id: string; description: string }[];
  tools: AgentTool[];
  excluded: ExcludedTool[];
  forbidden_at_runtime: ToolEffect[];
  /**
   * Effects currently closed. **Empty is the default** — everything open, which
   * is the right shape for a single-operator console where the operator is the
   * admin. The backend stores the locks rather than the permissions so that
   * "restore the default" is a delete and cannot get half-done.
   */
  locked: LockedEffect[];
  unlockable: ToolEffect[];
  /**
   * Tools taken off the list the model is offered. A different axis from
   * `locked`: that one is what this machine is permitted to do, this one is
   * which tools the model should be choosing between. Empty is the default.
   */
  disabled: DisabledTool[];
}

/** What a dispatched tool hands back. Never the raw value — see `citable`. */
export interface ToolResult {
  tool: string;
  category: string;
  ok: boolean;
  status: 'ok' | 'refused' | 'invalid_arguments' | 'error';
  integrity: ToolIntegrity;
  citable: boolean;
  data: unknown;
  detail: string;
  elapsed_ms: number;
}

/**
 * Refuse one effect at runtime. With none named, locks all four.
 *
 * Closing is the recorded event now that open is the default — `locked_at` and
 * the optional note are what answer "was the agent able to run shell commands
 * when this benchmark was taken?" months later.
 */
export const lockEffect = (effect?: ToolEffect, note?: string) =>
  request<ToolCatalogue>('/api/tools/policy/lock', {
    method: 'POST',
    body: JSON.stringify({ effect: effect ?? null, note: note ?? null }),
  });

/** Permit an effect again. With none named, restores the default (all open). */
export const unlockEffect = (effect?: ToolEffect) =>
  request<ToolCatalogue>('/api/tools/policy/unlock', {
    method: 'POST',
    body: JSON.stringify({ effect: effect ?? null }),
  });

/**
 * Stop offering one tool: out of the model's schema list, and refused if it asks
 * for it anyway from a name it remembers.
 *
 * Not the same thing as locking an effect. Closing `network_egress` to quiet one
 * tool also closes the three that share it, and switching one tool off says
 * nothing about the safety envelope a recorded result is cited under.
 */
export const disableTool = (tool: string, note?: string) =>
  request<ToolCatalogue>('/api/tools/policy/disable', {
    method: 'POST',
    body: JSON.stringify({ tool, note: note ?? null }),
  });

/** Offer it again. With no name, turns every switched-off tool back on. */
export const enableTool = (tool?: string) =>
  request<ToolCatalogue>('/api/tools/policy/enable', {
    method: 'POST',
    body: JSON.stringify({ tool: tool ?? null }),
  });

export const fetchToolCatalogue = (surface = 'runtime') =>
  request<ToolCatalogue>(`/api/tools?surface=${encodeURIComponent(surface)}`);

/** The function-calling payload the model is given, exactly as sent. */
export const fetchToolSchemas = () =>
  request<unknown[]>('/api/tools/schemas');

/**
 * Run one tool from Settings, with a person watching.
 *
 * A refusal or a failure is still a `200` — the envelope carries the verdict,
 * because "this tool declined, and here is the rule" is the result worth seeing.
 */
export const tryTool = (name: string, args: Record<string, unknown>) =>
  request<ToolResult>(`/api/tools/${encodeURIComponent(name)}/try`, {
    method: 'POST',
    body: JSON.stringify({ arguments: args }),
    timeoutMs: 30000,
  });
