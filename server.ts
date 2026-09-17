import express from 'express';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { projectStore, endpointStore, flowStore, runStore } from './server/storage';
import { importOpenApi } from './server/openapiImporter';
import { runFlow } from './server/runnerService';
import type { RunRecord } from './src/types';

const app = express();
app.use(express.json({ limit: '10mb' }));

// ─── health ────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'Testeria', time: Date.now() });
});

// ─── projects ──────────────────────────────────────────────────────────────
app.get('/api/projects', (_req, res) => {
  res.json({ projects: projectStore.list() });
});

app.get('/api/projects/:id', (req, res) => {
  const project = projectStore.get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json({ project });
});

app.post('/api/projects', (req, res) => {
  try {
    const project = projectStore.create(req.body || {});
    res.status(201).json({ project });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/projects/:id', (req, res) => {
  const project = projectStore.update(req.params.id, req.body || {});
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json({ project });
});

app.delete('/api/projects/:id', (req, res) => {
  res.json({ success: projectStore.remove(req.params.id) });
});

// ─── endpoints ─────────────────────────────────────────────────────────────
app.get('/api/projects/:id/endpoints', (req, res) => {
  res.json({ endpoints: endpointStore.listByProject(req.params.id) });
});

app.post('/api/projects/:id/endpoints', (req, res) => {
  if (!projectStore.get(req.params.id)) return res.status(404).json({ error: 'Project not found' });
  const endpoint = endpointStore.create(req.params.id, req.body || {});
  res.status(201).json({ endpoint });
});

app.put('/api/endpoints/:id', (req, res) => {
  const endpoint = endpointStore.update(req.params.id, req.body || {});
  if (!endpoint) return res.status(404).json({ error: 'Endpoint not found' });
  res.json({ endpoint });
});

app.delete('/api/endpoints/:id', (req, res) => {
  res.json({ success: endpointStore.remove(req.params.id) });
});

// OpenAPI/Swagger import (replaces the project's endpoint list)
app.post('/api/projects/:id/import-endpoints', (req, res) => {
  const project = projectStore.get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const { rawContent } = req.body || {};
  if (!rawContent) return res.status(400).json({ error: 'rawContent is required' });
  try {
    const result = importOpenApi(rawContent);
    endpointStore.removeByProject(req.params.id);
    for (const ep of result.endpoints) endpointStore.create(req.params.id, ep);
    res.json({ success: true, importedCount: result.endpoints.length, basePath: result.basePath, warnings: result.warnings, endpoints: result.endpoints });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ─── flows ─────────────────────────────────────────────────────────────────
app.get('/api/projects/:id/flows', (req, res) => {
  res.json({ flows: flowStore.listByProject(req.params.id) });
});

app.get('/api/flows/:id', (req, res) => {
  const flow = flowStore.get(req.params.id);
  if (!flow) return res.status(404).json({ error: 'Flow not found' });
  res.json({ flow });
});

app.post('/api/projects/:id/flows', (req, res) => {
  if (!projectStore.get(req.params.id)) return res.status(404).json({ error: 'Project not found' });
  const flow = flowStore.create(req.params.id, req.body || {});
  res.status(201).json({ flow });
});

app.put('/api/flows/:id', (req, res) => {
  const flow = flowStore.update(req.params.id, req.body || {});
  if (!flow) return res.status(404).json({ error: 'Flow not found' });
  res.json({ flow });
});

app.delete('/api/flows/:id', (req, res) => {
  res.json({ success: flowStore.remove(req.params.id) });
});

// ─── runs ──────────────────────────────────────────────────────────────────
app.get('/api/projects/:id/runs', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json({ runs: runStore.listByProject(req.params.id, limit) });
});

app.get('/api/runs/:id', (req, res) => {
  const run = runStore.get(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  res.json({ run });
});

app.post('/api/flows/:id/run', async (req, res) => {
  const flow = flowStore.get(req.params.id);
  if (!flow) return res.status(404).json({ error: 'Flow not found' });
  const project = projectStore.get(flow.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const record = req.body?.record === true;
  try {
    const run: RunRecord = await runFlow(project, flow, { record });
    res.json({ success: true, run });
  } catch (err: any) {
    console.error('Flow execution crashed:', err);
    res.status(500).json({ error: err?.message || 'Flow execution crashed' });
  }
});

// Serve recorded videos
app.get('/api/videos/:file', (req, res) => {
  const file = path.basename(req.params.file);
  const full = path.join(runStore.videosDir, file);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'Video not found' });
  res.setHeader('Content-Type', 'video/webm');
  fs.createReadStream(full).pipe(res);
});

// ─── SPA (Vite dev middleware / static prod) ───────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Testeria server listening on http://0.0.0.0:${PORT}`);
});
