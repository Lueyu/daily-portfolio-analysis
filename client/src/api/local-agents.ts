import http from './http';

export interface LocalAgentConnection {
  id: string;
  name: string;
  protocol: 'a2a';
  available: boolean;
}

const BASE_URL = '/api/settings/local-agents';

export async function fetchLocalAgents(): Promise<LocalAgentConnection[]> {
  const response = await http.get<{ items: LocalAgentConnection[] }>(BASE_URL);
  return response.data.items;
}

export async function testLocalAgent(id: string): Promise<{ ok: boolean; protocol?: 'a2a'; version?: string; code?: string }> {
  const response = await http.post<{ ok: boolean; protocol?: 'a2a'; version?: string; code?: string }>(`${BASE_URL}/${encodeURIComponent(id)}/test`);
  return response.data;
}
