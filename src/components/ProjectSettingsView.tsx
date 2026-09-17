import React, { useState } from 'react';
import { Project } from '../types';
import { Settings, Trash2, Save, Server, Globe, Key, ShieldCheck, Check } from 'lucide-react';

interface ProjectSettingsViewProps {
  project: Project;
  onUpdateProject: (updates: Partial<Project>) => void;
  onDeleteProject: (projectId: string) => void;
}

export const ProjectSettingsView: React.FC<ProjectSettingsViewProps> = ({
  project,
  onUpdateProject,
  onDeleteProject
}) => {
  const [name, setName] = useState(project.name);
  const [baseUrl, setBaseUrl] = useState(project.baseUrl);
  const [description, setDescription] = useState(project.description);
  const [authHeader, setAuthHeader] = useState(
    project.defaultHeaders?.['Authorization'] || ''
  );
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const headers = { ...project.defaultHeaders };
    if (authHeader.trim()) {
      headers['Authorization'] = authHeader.trim();
    } else {
      delete headers['Authorization'];
    }

    onUpdateProject({
      name,
      baseUrl,
      description,
      defaultHeaders: headers
    });

    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
        <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
          <Settings className="w-4 h-4 text-cyan-400" />
          <span>Project Settings & Environment</span>
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Configure connection endpoints, default authorization tokens, and backend framework parameters for <strong>{project.name}</strong>.
        </p>
      </div>

      <form onSubmit={handleSave} className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4 text-xs">
        <div>
          <label className="block text-slate-300 font-semibold mb-1">
            Project Name
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-cyan-500"
          />
        </div>

        <div>
          <label className="block text-slate-300 font-semibold mb-1">
            Backend Base URL
          </label>
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-slate-500" />
            <input
              type="text"
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              className="flex-1 p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500"
            />
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Testeria attempts live network requests first. If the local host is behind a container firewall, it automatically engages the high-fidelity {project.stack.toUpperCase()} mock sandbox.
          </p>
        </div>

        <div>
          <label className="block text-slate-300 font-semibold mb-1">
            Description
          </label>
          <textarea
            rows={2}
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="w-full p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-cyan-500"
          />
        </div>

        <div>
          <label className="block text-slate-300 font-semibold mb-1">
            Default Authorization Header
          </label>
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Bearer <JWT_TOKEN>"
              value={authHeader}
              onChange={e => setAuthHeader(e.target.value)}
              className="flex-1 p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500"
            />
          </div>
        </div>

        <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
          <span className="text-xs text-emerald-400 flex items-center gap-1">
            {savedSuccess && (
              <>
                <Check className="w-4 h-4" />
                <span>Settings updated successfully</span>
              </>
            )}
          </span>

          <button
            type="submit"
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs shadow-md shadow-cyan-600/20 transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save Changes</span>
          </button>
        </div>
      </form>

      {/* Danger Zone: Delete Project */}
      <div className="p-5 rounded-xl bg-rose-500/5 border border-rose-500/20 space-y-3">
        <h3 className="text-xs font-bold text-rose-400 uppercase tracking-wider">
          Danger Zone
        </h3>
        <p className="text-xs text-slate-400">
          Permanently delete this project, along with its endpoints, generated test cases, and historical reports.
        </p>
        <button
          onClick={() => {
            if (confirm(`Are you sure you want to delete ${project.name}?`)) {
              onDeleteProject(project.id);
            }
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-medium transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Delete Project</span>
        </button>
      </div>
    </div>
  );
};
