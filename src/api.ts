// Tiny fetch wrapper over the Testeria REST API
import type { Project, Endpoint, Flow, RunRecord } from './types';

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  // projects
  listProjects: () => req<{ projects: Project[] }>('/api/projects'),
  createProject: (body: Partial<Project>) => req<{ project: Project }>('/api/projects', { method: 'POST', body: JSON.stringify(body) }),
  updateProject: (id: string, body: Partial<Project>) => req<{ project: Project }>(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteProject: (id: string) => req<{ success: boolean }>(`/api/projects/${id}`, { method: 'DELETE' }),

  // endpoints
  listEndpoints: (projectId: string) => req<{ endpoints: Endpoint[] }>(`/api/projects/${projectId}/endpoints`),
  createEndpoint: (projectId: string, body: Partial<Endpoint>) => req<{ endpoint: Endpoint }>(`/api/projects/${projectId}/endpoints`, { method: 'POST', body: JSON.stringify(body) }),
  updateEndpoint: (id: string, body: Partial<Endpoint>) => req<{ endpoint: Endpoint }>(`/api/endpoints/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteEndpoint: (id: string) => req<{ success: boolean }>(`/api/endpoints/${id}`, { method: 'DELETE' }),
  importEndpoints: (projectId: string, rawContent: string) =>
    req<{ success: boolean; importedCount: number; basePath: string; warnings: string[]; endpoints: Endpoint[] }>(
      `/api/projects/${projectId}/import-endpoints`, { method: 'POST', body: JSON.stringify({ rawContent }) }
    ),

  // flows
  listFlows: (projectId: string) => req<{ flows: Flow[] }>(`/api/projects/${projectId}/flows`),
  getFlow: (id: string) => req<{ flow: Flow }>(`/api/flows/${id}`),
  createFlow: (projectId: string, body: Partial<Flow>) => req<{ flow: Flow }>(`/api/projects/${projectId}/flows`, { method: 'POST', body: JSON.stringify(body) }),
  updateFlow: (id: string, body: Partial<Flow>) => req<{ flow: Flow }>(`/api/flows/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteFlow: (id: string) => req<{ success: boolean }>(`/api/flows/${id}`, { method: 'DELETE' }),

  // runs
  runFlow: (flowId: string, record: boolean) => req<{ run: RunRecord }>(`/api/flows/${flowId}/run`, { method: 'POST', body: JSON.stringify({ record }) }),
  listRuns: (projectId: string) => req<{ runs: RunRecord[] }>(`/api/projects/${projectId}/runs`),
  getRun: (id: string) => req<{ run: RunRecord }>(`/api/runs/${id}`),
};
