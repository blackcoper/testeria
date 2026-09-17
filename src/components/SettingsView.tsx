import { useState } from 'react';
import type { Project } from '../types';
import { api } from '../api';
import { Button, Input, Label } from './ui';

export function SettingsView({ project, onUpdated, onDeleted }: {
  project: Project; onUpdated: (p: Project) => void; onDeleted: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [baseUrl, setBaseUrl] = useState(project.baseUrl);
  const [uiBaseUrl, setUiBaseUrl] = useState(project.uiBaseUrl || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true); setSaved(false);
    try {
      const { project: p } = await api.updateProject(project.id, { name, baseUrl: baseUrl.trim(), uiBaseUrl: uiBaseUrl.trim() });
      onUpdated(p);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  };

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="max-w-md mx-auto p-6 space-y-4">
        <h2 className="text-sm font-semibold">Project settings</h2>
        <div><Label>Project name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div>
          <Label>API base URL</Label>
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:4000" />
          <p className="mt-1 text-[11px] text-zinc-400">Used by API steps. Path in each step is appended to this base.</p>
        </div>
        <div>
          <Label>UI base URL (optional)</Label>
          <Input value={uiBaseUrl} onChange={(e) => setUiBaseUrl(e.target.value)} placeholder="http://localhost:5173" />
          <p className="mt-1 text-[11px] text-zinc-400">Used by UI steps (Playwright). Relative paths in goto/fill actions resolve against this.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved ✓</span>}
        </div>

        <div className="pt-6 border-t border-zinc-200 dark:border-zinc-800">
          <Button variant="danger" onClick={async () => {
            if (confirm(`Delete project "${project.name}" and all its endpoints, flows, runs, and videos?`)) {
              await api.deleteProject(project.id);
              onDeleted();
            }
          }}>Delete project</Button>
          <p className="mt-2 text-[11px] text-zinc-400">Data lives in SQLite (data/testeria.db) — it survives restarts.</p>
        </div>
      </div>
    </div>
  );
}
