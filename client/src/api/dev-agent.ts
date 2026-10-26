/** Local coding-agent HTTP API. All requests use the platform client. */
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  DevAgentRuntimeSnapshot, DevAgentUndoInput, DevAgentRestoreInput, DevAgentSettings,
  DevAgentSettingsInput, DevAgentSettingsTestInput, DevAgentSettingsTestResult,
} from '@shared/api.interface';
import type {
  CreateDevTaskPayload,
  DevHealth,
  DevPatchDetail,
  DevTaskDetail,
  DevTaskSummary,
} from '@/pages/Dev/types';

export async function getDevHealth() {
  const response = await axiosForBackend({ url: '/api/dev/health', method: 'GET' });
  return response.data as DevHealth;
}

export async function listDevTasks() {
  const response = await axiosForBackend({ url: '/api/dev/tasks', method: 'GET' });
  return response.data as DevTaskSummary[];
}

export async function createDevTask(payload: CreateDevTaskPayload) {
  const response = await axiosForBackend({
    url: '/api/dev/tasks',
    method: 'POST',
    data: payload,
  });
  return response.data as DevTaskDetail;
}

export async function getDevTask(id: string) {
  const response = await axiosForBackend({ url: `/api/dev/tasks/${id}`, method: 'GET' });
  return response.data as DevTaskDetail;
}

export async function getDevPatch(id: string, patchId: string) {
  const response = await axiosForBackend({
    url: `/api/dev/tasks/${id}/patches/${patchId}`,
    method: 'GET',
  });
  return response.data as DevPatchDetail;
}

export async function runDevTask(id: string) {
  const response = await axiosForBackend({ url: `/api/dev/tasks/${id}/run`, method: 'POST' });
  return response.data;
}

export async function stopDevTask(id: string) {
  const response = await axiosForBackend({ url: `/api/dev/tasks/${id}/stop`, method: 'POST' });
  return response.data;
}

export async function approveDevTask(id: string) {
  const response = await axiosForBackend({ url: `/api/dev/tasks/${id}/approve`, method: 'POST' });
  return response.data;
}

export async function rejectDevTask(id: string, reason: string) {
  const response = await axiosForBackend({
    url: `/api/dev/tasks/${id}/reject`,
    method: 'POST',
    data: { reason },
  });
  return response.data;
}

export async function getDevRuntime(id: string, cursor: number = 0): Promise<DevAgentRuntimeSnapshot> {
  const response = await axiosForBackend({
    url: `/api/dev/tasks/${encodeURIComponent(id)}/runtime?cursor=${cursor}`, method: 'GET',
  });
  return response.data as DevAgentRuntimeSnapshot;
}

export async function getDevArtifact(id: string, artifactId: string): Promise<Blob> {
  const response = await axiosForBackend({
    url: `/api/dev/tasks/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifactId)}`,
    method: 'GET', responseType: 'blob',
  });
  return response.data as Blob;
}

export async function undoDevChange(id: string, payload: DevAgentUndoInput): Promise<unknown> {
  const response = await axiosForBackend({
    url: `/api/dev/tasks/${encodeURIComponent(id)}/changes/undo`, method: 'POST', data: payload,
  });
  return response.data;
}

export async function restoreDevCheckpoint(id: string, payload: DevAgentRestoreInput): Promise<unknown> {
  const response = await axiosForBackend({
    url: `/api/dev/tasks/${encodeURIComponent(id)}/checkpoints/restore`, method: 'POST', data: payload,
  });
  return response.data;
}

export async function getDevCapabilities(): Promise<Record<string, unknown>> {
  const response = await axiosForBackend({ url: '/api/dev/capabilities', method: 'GET' });
  return response.data as Record<string, unknown>;
}

export async function getDevSettings(): Promise<DevAgentSettings> {
  const response = await axiosForBackend({ url: '/api/dev/settings', method: 'GET' });
  return response.data as DevAgentSettings;
}

export async function saveDevSettings(data: DevAgentSettingsInput): Promise<DevAgentSettings> {
  const response = await axiosForBackend({ url: '/api/dev/settings', method: 'PUT', data });
  return response.data as DevAgentSettings;
}

export async function testDevSettings(data: DevAgentSettingsTestInput): Promise<DevAgentSettingsTestResult> {
  const response = await axiosForBackend({ url: '/api/dev/settings/test', method: 'POST', data });
  return response.data as DevAgentSettingsTestResult;
}

export async function sendDevMessage(id: string, text: string): Promise<void> {
  await axiosForBackend({ url: `/api/dev/tasks/${encodeURIComponent(id)}/messages`, method: 'POST', data: { text } });
}

export async function decideDevExternal(id: string, requestId: string, approve: boolean): Promise<void> {
  await axiosForBackend({
    url: `/api/dev/tasks/${encodeURIComponent(id)}/approvals/${encodeURIComponent(requestId)}`,
    method: 'POST', data: { approve },
  });
}
