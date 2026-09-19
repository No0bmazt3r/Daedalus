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
  /** Why the surface refused it — the Rule 1 / Rule 5 gate, in words. */
  refused_because: string | null;
  params: ToolParam[];
}

/** A tool the reference implementation has and this one deliberately does not. */
export interface ExcludedTool {
  name: string;
  category: string;
  reason: string;
}

/** One forbidden effect an operator has deliberately permitted, and why. */
export interface UnlockedEffect {
  effect: ToolEffect;
  unlocked_at: string;
  note: string;
}

export interface ToolCatalogue {
  surface: string;
  categories: { id: string; description: string }[];
  tools: AgentTool[];
  excluded: ExcludedTool[];
  forbidden_at_runtime: ToolEffect[];
  /**
   * Effects currently open. Empty is the project's default, and is what a fresh
   * install has — see `PROJECT.md` §3's Rule 1 and Rule 5.
   */
  unlocked: UnlockedEffect[];
  unlockable: ToolEffect[];
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
 * Permit one normally-forbidden effect at runtime.
 *
 * The note is not optional and not decorative: it is what answers "was the agent
 * able to run shell commands when this benchmark was recorded?" months later,
 * and the backend refuses an unlock without one.
 */
export const unlockEffect = (effect: ToolEffect, note: string) =>
  request<ToolCatalogue>('/api/tools/policy/unlock', {
    method: 'POST',
    body: JSON.stringify({ effect, note }),
  });

/** Take a permission back. With no effect named, locks everything. */
export const lockEffect = (effect?: ToolEffect) =>
  request<ToolCatalogue>('/api/tools/policy/lock', {
    method: 'POST',
    body: JSON.stringify({ effect: effect ?? null }),
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
