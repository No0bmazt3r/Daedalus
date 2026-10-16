// Client for Settings → Persona — backend `api/persona.py`.
//
// What Daedalus has learned about this install's user, proposed by a background
// job and applied only once accepted. See `services/persona.py`.

import { request } from './http';
import type { GraphNode } from './blueprintsClient';

export type TraitKind = 'style' | 'vocabulary' | 'focus' | 'role';
export type TraitStatus = 'proposed' | 'accepted' | 'rejected';

export interface PersonaTrait {
  trait_id: string;
  kind: TraitKind;
  key: string;
  value: string;
  node_id: string | null;
  status: TraitStatus;
  sightings: number;
  /** Written from the fields by the backend, never by the model. */
  statement: string;
  /** The user's own messages that showed it; `text` is null once the chat is deleted. */
  evidence: { session_id: string; seq: number; text: string | null; at: string | null }[];
  created_at: string;
  decided_at: string | null;
}

export interface PersonaState {
  enabled: boolean;
  traits: PersonaTrait[];
  graph: { nodes: GraphNode[]; edges: { from: string; type: string; to: string }[] };
  queued?: number;
}

export const fetchPersona = () => request<PersonaState>('/api/persona');

export const setPersonaEnabled = (enabled: boolean) =>
  request<PersonaState>('/api/persona/settings', { method: 'PUT', body: JSON.stringify({ enabled }) });

export const decideTrait = (id: string, accept: boolean) =>
  request<PersonaState>(`/api/persona/traits/${encodeURIComponent(id)}/${accept ? 'accept' : 'reject'}`, {
    method: 'POST',
  });

export const forgetTrait = (id: string) =>
  request<PersonaState>(`/api/persona/traits/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const forgetPersona = () => request<PersonaState>('/api/persona', { method: 'DELETE' });

/** Read every chat's unread messages now. Waits on the local model, so it can take a while. */
export const scanPersona = () =>
  request<PersonaState>('/api/persona/scan', { method: 'POST', timeoutMs: 600_000 });
