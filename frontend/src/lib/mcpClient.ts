// MCP servers — /api/mcp.
//
// A *setup* client (Rule 5). Adding a server is an operator action: a stdio
// server is a program the backend executes, so a model able to write that row
// could name any executable on the machine. The agent tools can list and call
// servers; only this API can create one.

import { request, type RequestOptions } from './http';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpServer {
  id: string;
  created_at: string;
  updated_at: string;
  label: string;
  transport: 'stdio' | 'http';
  /** stdio: the program the backend spawns. */
  command: string | null;
  args: string[];
  /** Names only — an operator-supplied value may be a credential. */
  env_keys: string[];
  url: string | null;
  header_keys: string[];
  has_headers: boolean;
  enabled: boolean;

  last_connected_at: string | null;
  last_error: string | null;
  server_name: string | null;
  server_version: string | null;
  protocol_version: string | null;

  /**
   * The pinned tool list — what this project was built against. Null until the
   * server is pinned, which is deliberately a decision rather than something
   * that happens on first connect.
   */
  tools: McpTool[] | null;
  tool_count: number;
  tools_hash: string | null;
  tools_pinned_at: string | null;
}

export interface McpStatus {
  servers: McpServer[];
  enabled_count: number;
  tool_count: number;
  protocol_version: string;
}

/** The result of a handshake. A server that is down is `ok: false`, not an error. */
export interface McpTestResult {
  ok: boolean;
  server_id: string;
  label: string;
  detail: string;
  tools: McpTool[];
  /** True when the live tool list differs from the pinned snapshot. */
  drifted: boolean;
  drift_detail?: string;
  server_name?: string | null;
  servers: McpServer[];
}

// Starting a stdio server means spawning a process and waiting for a handshake.
// npx-style servers install themselves on first run, which is comfortably past
// the default request timeout.
const CONNECT: RequestOptions = { timeoutMs: 120000 };

export const fetchMcpServers = () => request<McpStatus>('/api/mcp/servers');

export const addMcpServer = (body: {
  label: string;
  transport: 'stdio' | 'http';
  command?: string | null;
  args?: string[];
  env?: Record<string, string>;
  url?: string | null;
  headers?: Record<string, string>;
}) =>
  request<McpStatus>('/api/mcp/servers', {
    method: 'POST',
    body: JSON.stringify(body),
  });

/** Handshake and list tools. `pin` freezes that list as the one of record. */
export const testMcpServer = (id: string, pin = false) =>
  request<McpTestResult>(
    `/api/mcp/servers/${encodeURIComponent(id)}/test?pin=${pin}`,
    { ...CONNECT, method: 'POST' },
  );

export const pinMcpServer = (id: string) =>
  request<McpStatus>(`/api/mcp/servers/${encodeURIComponent(id)}/pin`, {
    ...CONNECT,
    method: 'POST',
  });

export const setMcpServerEnabled = (id: string, enabled: boolean) =>
  request<McpStatus>(`/api/mcp/servers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });

export const deleteMcpServer = (id: string) =>
  request<McpStatus>(`/api/mcp/servers/${encodeURIComponent(id)}`, { method: 'DELETE' });
