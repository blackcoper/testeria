import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import type { Project, Endpoint, Flow, RunRecord } from '../src/types';

const DATA_DIR = path.join(process.cwd(), 'data');
const VIDEOS_DIR = path.join(DATA_DIR, 'videos');
for (const dir of [DATA_DIR, VIDEOS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const db = new Database(path.join(DATA_DIR, 'testeria.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL DEFAULT '',
    ui_base_url TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS endpoints (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    description TEXT,
    tags TEXT,
    query_schema TEXT,
    body_schema TEXT,
    headers TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS flows (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    steps TEXT NOT NULL DEFAULT '[]',
    error_branches TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    flow_id TEXT NOT NULL,
    flow_name TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    steps TEXT NOT NULL DEFAULT '[]',
    video_path TEXT,
    error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_endpoints_project ON endpoints(project_id);
  CREATE INDEX IF NOT EXISTS idx_flows_project ON flows(project_id);
  CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id);
`);

export const newId = (prefix: string) =>
  `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

// ─── Projects ──────────────────────────────────────────────────────────────

const rowToProject = (r: any): Project => ({
  id: r.id,
  name: r.name,
  baseUrl: r.base_url,
  uiBaseUrl: r.ui_base_url ?? undefined,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const projectStore = {
  list(): Project[] {
    return db.prepare('SELECT * FROM projects ORDER BY created_at ASC').all().map(rowToProject);
  },
  get(id: string): Project | undefined {
    const r = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    return r ? rowToProject(r) : undefined;
  },
  create(data: Partial<Project>): Project {
    const now = Date.now();
    const p: Project = {
      id: newId('proj'),
      name: data.name?.trim() || 'Untitled Project',
      baseUrl: data.baseUrl?.trim() || 'http://localhost:3000',
      uiBaseUrl: data.uiBaseUrl?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    db.prepare(
      'INSERT INTO projects (id, name, base_url, ui_base_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(p.id, p.name, p.baseUrl, p.uiBaseUrl ?? null, p.createdAt, p.updatedAt);
    return p;
  },
  update(id: string, updates: Partial<Project>): Project | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const next = { ...existing, ...updates, id, updatedAt: Date.now() };
    db.prepare('UPDATE projects SET name = ?, base_url = ?, ui_base_url = ?, updated_at = ? WHERE id = ?')
      .run(next.name, next.baseUrl, next.uiBaseUrl ?? null, next.updatedAt, id);
    return next;
  },
  remove(id: string): boolean {
    const info = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return info.changes > 0;
  },
};

// ─── Endpoints ─────────────────────────────────────────────────────────────

const rowToEndpoint = (r: any): Endpoint => ({
  id: r.id,
  method: r.method,
  path: r.path,
  summary: r.summary,
  description: r.description ?? undefined,
  tags: r.tags ? JSON.parse(r.tags) : undefined,
  querySchema: r.query_schema ? JSON.parse(r.query_schema) : undefined,
  bodySchema: r.body_schema ? JSON.parse(r.body_schema) : undefined,
  headers: r.headers ? JSON.parse(r.headers) : undefined,
});

export const endpointStore = {
  listByProject(projectId: string): Endpoint[] {
    return db
      .prepare('SELECT * FROM endpoints WHERE project_id = ? ORDER BY created_at ASC, path ASC')
      .all(projectId)
      .map(rowToEndpoint);
  },
  get(id: string): Endpoint | undefined {
    const r = db.prepare('SELECT * FROM endpoints WHERE id = ?').get(id);
    return r ? rowToEndpoint(r) : undefined;
  },
  create(projectId: string, data: Partial<Endpoint>): Endpoint {
    const ep: Endpoint = {
      id: data.id || newId('ep'),
      method: (data.method || 'GET').toUpperCase() as Endpoint['method'],
      path: data.path || '/',
      summary: data.summary || '',
      description: data.description,
      tags: data.tags,
      querySchema: data.querySchema,
      bodySchema: data.bodySchema,
      headers: data.headers,
    };
    db.prepare(
      `INSERT INTO endpoints (id, project_id, method, path, summary, description, tags, query_schema, body_schema, headers, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      ep.id, projectId, ep.method, ep.path, ep.summary,
      ep.description ?? null,
      ep.tags ? JSON.stringify(ep.tags) : null,
      ep.querySchema ? JSON.stringify(ep.querySchema) : null,
      ep.bodySchema === undefined ? null : JSON.stringify(ep.bodySchema),
      ep.headers ? JSON.stringify(ep.headers) : null,
      Date.now()
    );
    return ep;
  },
  update(id: string, data: Partial<Endpoint>): Endpoint | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const next = { ...existing, ...data, id };
    db.prepare(
      `UPDATE endpoints SET method = ?, path = ?, summary = ?, description = ?, tags = ?, query_schema = ?, body_schema = ?, headers = ? WHERE id = ?`
    ).run(
      next.method, next.path, next.summary,
      next.description ?? null,
      next.tags ? JSON.stringify(next.tags) : null,
      next.querySchema ? JSON.stringify(next.querySchema) : null,
      next.bodySchema === undefined ? null : JSON.stringify(next.bodySchema),
      next.headers ? JSON.stringify(next.headers) : null,
      id
    );
    return next;
  },
  remove(id: string): boolean {
    return db.prepare('DELETE FROM endpoints WHERE id = ?').run(id).changes > 0;
  },
  removeByProject(projectId: string) {
    db.prepare('DELETE FROM endpoints WHERE project_id = ?').run(projectId);
  },
};

// ─── Flows ─────────────────────────────────────────────────────────────────

const rowToFlow = (r: any): Flow => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  description: r.description ?? undefined,
  steps: JSON.parse(r.steps),
  errorBranches: JSON.parse(r.error_branches),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const flowStore = {
  listByProject(projectId: string): Flow[] {
    return db.prepare('SELECT * FROM flows WHERE project_id = ? ORDER BY created_at ASC').all(projectId).map(rowToFlow);
  },
  get(id: string): Flow | undefined {
    const r = db.prepare('SELECT * FROM flows WHERE id = ?').get(id);
    return r ? rowToFlow(r) : undefined;
  },
  create(projectId: string, data: Partial<Flow>): Flow {
    const now = Date.now();
    const f: Flow = {
      id: newId('flow'),
      projectId,
      name: data.name?.trim() || 'New Flow',
      description: data.description,
      steps: data.steps || [],
      errorBranches: data.errorBranches || [],
      createdAt: now,
      updatedAt: now,
    };
    db.prepare(
      `INSERT INTO flows (id, project_id, name, description, steps, error_branches, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(f.id, f.projectId, f.name, f.description ?? null, JSON.stringify(f.steps), JSON.stringify(f.errorBranches), f.createdAt, f.updatedAt);
    return f;
  },
  update(id: string, data: Partial<Flow>): Flow | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const next: Flow = {
      ...existing,
      ...data,
      id,
      projectId: existing.projectId,
      updatedAt: Date.now(),
    };
    db.prepare(
      `UPDATE flows SET name = ?, description = ?, steps = ?, error_branches = ?, updated_at = ? WHERE id = ?`
    ).run(next.name, next.description ?? null, JSON.stringify(next.steps), JSON.stringify(next.errorBranches), next.updatedAt, id);
    return next;
  },
  remove(id: string): boolean {
    return db.prepare('DELETE FROM flows WHERE id = ?').run(id).changes > 0;
  },
};

// ─── Runs ──────────────────────────────────────────────────────────────────

export const runStore = {
  listByProject(projectId: string, limit = 50): RunRecord[] {
    return db
      .prepare('SELECT * FROM runs WHERE project_id = ? ORDER BY started_at DESC LIMIT ?')
      .all(projectId, limit)
      .map(rowToRun);
  },
  get(id: string): RunRecord | undefined {
    const r = db.prepare('SELECT * FROM runs WHERE id = ?').get(id);
    return r ? rowToRun(r) : undefined;
  },
  create(run: RunRecord) {
    db.prepare(
      `INSERT INTO runs (id, project_id, flow_id, flow_name, status, started_at, duration_ms, steps, video_path, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      run.id, run.projectId, run.flowId, run.flowName, run.status,
      run.startedAt, run.durationMs, JSON.stringify(run.steps),
      run.videoPath ?? null, run.error ?? null
    );
  },
  videosDir: VIDEOS_DIR,
};

const rowToRun = (r: any): RunRecord => ({
  id: r.id,
  projectId: r.project_id,
  flowId: r.flow_id,
  flowName: r.flow_name,
  status: r.status,
  startedAt: r.started_at,
  durationMs: r.duration_ms,
  steps: JSON.parse(r.steps),
  videoPath: r.video_path ?? undefined,
  error: r.error ?? undefined,
});
