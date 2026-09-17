import { useCallback, useEffect, useState } from 'react';
import { Box, FlaskConical, History, Plus, Settings2, Waypoints, ListTree } from 'lucide-react';
import type { Project, Endpoint, Flow } from './types';
import { api } from './api';
import { Button, EmptyState, Input, Label, Spinner } from './components/ui';
import { ThemeToggle } from './components/ThemeToggle';
import { EndpointsView } from './components/EndpointsView';
import { FlowEditorView } from './components/FlowEditorView';
import { RunView } from './components/RunView';
import { RunsHistoryView } from './components/RunsHistoryView';
import { SettingsView } from './components/SettingsView';
import { Modal } from './components/EndpointsView';

type Section = 'endpoints' | 'flows' | 'run' | 'history' | 'settings';

export default function App() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [section, setSection] = useState<Section>('endpoints');
  const [runTarget, setRunTarget] = useState<{ flowId: string; record: boolean; nonce: number } | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);

  const project = projects?.find((p) => p.id === projectId) ?? null;

  const refresh = useCallback(async () => {
    if (!projectId) return;
    const [eps, fls] = await Promise.all([api.listEndpoints(projectId), api.listFlows(projectId)]);
    setEndpoints(eps.endpoints);
    setFlows(fls.flows);
  }, [projectId]);

  useEffect(() => {
    api.listProjects().then(({ projects }) => {
      setProjects(projects);
      if (projects.length > 0) setProjectId((cur) => cur ?? projects[0].id);
      else setShowNewProject(true);
    }).catch(() => setProjects([]));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (projects === null) return <div className="h-full"><Spinner label="Loading…" /></div>;

  return (
    <div className="h-full flex flex-col">
      {/* top bar */}
      <header className="h-12 shrink-0 border-b border-zinc-200 dark:border-zinc-800 flex items-center px-3 gap-3">
        <div className="flex items-center gap-2 font-semibold text-sm tracking-tight">
          <FlaskConical className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          Testeria
        </div>
        <ProjectSwitcher projects={projects} currentId={projectId} onSelect={setProjectId} />
        <div className="ml-auto flex items-center gap-1">
          <Button variant="subtle" onClick={() => setShowNewProject(true)}><Plus className="w-3.5 h-3.5" /> New project</Button>
          <ThemeToggle />
        </div>
      </header>

      {/* section tabs */}
      {project ? (
        <nav className="h-9 shrink-0 border-b border-zinc-200 dark:border-zinc-800 flex items-center px-3 gap-1">
          {([
            ['endpoints', 'Endpoints', ListTree],
            ['flows', 'Flows', Waypoints],
            ['run', 'Run', null],
            ['history', 'History', History],
            ['settings', 'Settings', Settings2],
          ] as [Section, string, any][]).map(([id, label, Icon]) => (
            <button key={id} onClick={() => setSection(id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${
                section === id ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>
              {Icon && <Icon className="w-3.5 h-3.5" />}{label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 text-[11px] text-zinc-400 font-mono">
            <span>{project.baseUrl}</span>
            {project.uiBaseUrl && <span>· {project.uiBaseUrl}</span>}
          </div>
        </nav>
      ) : null}

      {/* content */}
      <main className="flex-1 overflow-hidden">
        {!project ? (
          <EmptyState icon={<Box className="w-8 h-8" />} title="No project selected"
            hint="Create a project to start."
            action={<Button variant="primary" onClick={() => setShowNewProject(true)}><Plus className="w-3.5 h-3.5" /> Create project</Button>} />
        ) : section === 'endpoints' ? (
          <EndpointsView projectId={project.id} endpoints={endpoints} onChanged={refresh} />
        ) : section === 'flows' ? (
          <FlowEditorView projectId={project.id} endpoints={endpoints} flows={flows} onChanged={refresh}
            onOpenRun={(flowId, record) => { setRunTarget({ flowId, record, nonce: Date.now() }); setSection('run'); }} />
        ) : section === 'run' ? (
          <RunView key={runTarget?.nonce ?? 'idle'} project={project} flows={flows}
            preRun={runTarget ? { flowId: runTarget.flowId, record: runTarget.record } : null}
            onDone={() => refresh()} />
        ) : section === 'history' ? (
          <RunsHistoryView projectId={project.id} />
        ) : (
          <SettingsView project={project} onUpdated={(p) => setProjects((ps) => (ps ?? []).map((x) => (x.id === p.id ? p : x)))}
            onDeleted={() => { setProjectId(null); setSection('endpoints'); api.listProjects().then(({ projects }) => { setProjects(projects); if (projects[0]) setProjectId(projects[0].id); }); }} />
        )}
      </main>

      {showNewProject && (
        <NewProjectModal onClose={() => setShowNewProject(false)} onCreated={(p) => {
          setProjects((ps) => [...(ps ?? []), p]);
          setProjectId(p.id);
          setShowNewProject(false);
          setSection('endpoints');
        }} />
      )}
    </div>
  );
}

// ─── project switcher ──────────────────────────────────────────────────────

function ProjectSwitcher({ projects, currentId, onSelect }: {
  projects: Project[]; currentId: string | null; onSelect: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto max-w-[45vw] custom-scrollbar">
      {projects.map((p) => (
        <button key={p.id} onClick={() => onSelect(p.id)}
          className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors shrink-0 ${
            p.id === currentId ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>
          <span className="max-w-[160px] truncate">{p.name}</span>
        </button>
      ))}
    </div>
  );
}

// ─── new project modal ─────────────────────────────────────────────────────

function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Project) => void }) {
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('http://localhost:3000');
  const [uiBaseUrl, setUiBaseUrl] = useState('');
  const [saving, setSaving] = useState(false);

  return (
    <Modal title="New project" onClose={onClose}>
      <div className="space-y-3">
        <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Service" autoFocus /></div>
        <div><Label>API base URL</Label><Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} /></div>
        <div><Label>UI base URL (optional)</Label><Input value={uiBaseUrl} onChange={(e) => setUiBaseUrl(e.target.value)} placeholder="http://localhost:5173" /></div>
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={saving || !name.trim()} onClick={async () => {
            setSaving(true);
            try {
              const { project } = await api.createProject({ name, baseUrl, uiBaseUrl });
              onCreated(project);
            } finally { setSaving(false); }
          }}>{saving ? 'Creating…' : 'Create'}</Button>
        </div>
      </div>
    </Modal>
  );
}
