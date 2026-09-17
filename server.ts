import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { projectStore } from './server/storage';
import { runTestSuite } from './server/runnerService';
import {
  parseControllerOrDocToEndpoints,
  generateTestCasesForEndpoints,
  runAutonomousAiExploration,
  isGeminiAvailable
} from './server/geminiService';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // Health Check
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'Testeria AI Backend Test Automation Hub',
      geminiAvailable: isGeminiAvailable(),
      projectCount: projectStore.getAllProjects().length
    });
  });

  // Projects CRUD
  app.get('/api/projects', (req, res) => {
    const projects = projectStore.getAllProjects();
    res.json({ projects });
  });

  app.get('/api/projects/:id', (req, res) => {
    const project = projectStore.getProjectById(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.json({ project });
  });

  app.post('/api/projects', (req, res) => {
    try {
      const created = projectStore.createProject(req.body);
      res.status(201).json({ project: created });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put('/api/projects/:id', (req, res) => {
    const updated = projectStore.updateProject(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.json({ project: updated });
  });

  app.delete('/api/projects/:id', (req, res) => {
    const success = projectStore.deleteProject(req.params.id);
    res.json({ success });
  });

  // Import Endpoints from NestJS / Swagger Code
  app.post('/api/projects/:id/import-endpoints', async (req, res) => {
    const project = projectStore.getProjectById(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const { rawContent } = req.body;
    if (!rawContent) {
      return res.status(400).json({ error: 'rawContent is required' });
    }

    try {
      const newEndpoints = await parseControllerOrDocToEndpoints(rawContent, project.stack);
      const combinedEndpoints = [...project.endpoints, ...newEndpoints];
      projectStore.updateProject(project.id, { endpoints: combinedEndpoints });
      res.json({
        success: true,
        importedCount: newEndpoints.length,
        endpoints: newEndpoints
      });
    } catch (err: any) {
      console.error('Failed to import endpoints:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // AI Test Generation
  app.post('/api/projects/:id/generate-tests', async (req, res) => {
    const project = projectStore.getProjectById(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const { endpointIds, instructions } = req.body;
    const targetEndpoints = endpointIds && endpointIds.length > 0
      ? project.endpoints.filter(e => endpointIds.includes(e.id))
      : project.endpoints;

    if (targetEndpoints.length === 0) {
      return res.status(400).json({ error: 'No endpoints selected for test generation.' });
    }

    try {
      const generatedTests = await generateTestCasesForEndpoints(project, targetEndpoints, instructions);
      // Append to project test cases
      const updatedTestCases = [...project.testCases, ...generatedTests];
      projectStore.updateProject(project.id, { testCases: updatedTestCases });
      res.json({
        success: true,
        generatedCount: generatedTests.length,
        testCases: generatedTests
      });
    } catch (err: any) {
      console.error('Failed to generate test cases:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Test Execution / Suite Runner
  app.post('/api/projects/:id/run-tests', async (req, res) => {
    const project = projectStore.getProjectById(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const { testCaseIds } = req.body;
    try {
      const report = await runTestSuite(project, testCaseIds);
      projectStore.saveReport(project.id, report);
      res.json({ success: true, report });
    } catch (err: any) {
      console.error('Test execution failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Autonomous AI Explorer
  app.post('/api/projects/:id/explore', async (req, res) => {
    const project = projectStore.getProjectById(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    try {
      const exploration = await runAutonomousAiExploration(project);
      projectStore.saveExploration(project.id, exploration);
      res.json({ success: true, exploration });
    } catch (err: any) {
      console.error('Autonomous exploration failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Add / Delete individual test case
  app.post('/api/projects/:id/test-cases', (req, res) => {
    const project = projectStore.getProjectById(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const newTestCase = {
      ...req.body,
      id: req.body.id || `tc_manual_${Date.now()}`
    };
    const updatedTestCases = [...project.testCases, newTestCase];
    projectStore.updateProject(project.id, { testCases: updatedTestCases });
    res.json({ success: true, testCase: newTestCase });
  });

  app.put('/api/projects/:id/test-cases/:tcId', (req, res) => {
    const project = projectStore.getProjectById(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const updatedTestCases = project.testCases.map(t =>
      t.id === req.params.tcId ? { ...t, ...req.body } : t
    );
    projectStore.updateProject(project.id, { testCases: updatedTestCases });
    res.json({ success: true, testCase: req.body });
  });

  app.delete('/api/projects/:id/test-cases/:tcId', (req, res) => {
    const project = projectStore.getProjectById(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const updatedTestCases = project.testCases.filter(t => t.id !== req.params.tcId);
    projectStore.updateProject(project.id, { testCases: updatedTestCases });
    res.json({ success: true });
  });

  // Vite middleware in dev or static serving in prod
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Testeria server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
