import http from './http';

export interface WebUpdateStatus {
  enabled: boolean;
  currentVersion: string;
  available: { version: string; releaseUrl: string } | null;
  phase: 'idle' | 'backingUp' | 'updating' | 'failed';
  error?: string;
}

export async function fetchWebUpdateStatus(): Promise<WebUpdateStatus> {
  const response = await http.get<WebUpdateStatus>('/api/system/update');
  return response.data;
}

export async function startWebUpdate(): Promise<{ started: true; backup: string }> {
  const response = await http.post<{ started: true; backup: string }>('/api/system/update');
  return response.data;
}
