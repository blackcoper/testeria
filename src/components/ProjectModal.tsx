import React, { useState } from 'react';
import { Project, TechStack } from '../types';
import { Plus, Server, Code, X } from 'lucide-react';

interface ProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (projectData: Partial<Project>) => void;
  initialProject?: Project | null;
}

export const ProjectModal: React.FC<ProjectModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialProject
}) => {
  const [name, setName] = useState(initialProject?.name || '');
  const [description, setDescription] = useState(initialProject?.description || '');
  const [stack, setStack] = useState<TechStack>(initialProject?.stack || 'nestjs');
  const [baseUrl, setBaseUrl] = useState(initialProject?.baseUrl || 'http://localhost:3000');
  const [authHeader, setAuthHeader] = useState(
    initialProject?.defaultHeaders?.['Authorization'] || ''
  );

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !baseUrl.trim()) return;

    const defaultHeaders: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (authHeader.trim()) {
      defaultHeaders['Authorization'] = authHeader.trim();
    }

    onSave({
      name: name.trim(),
      description: description.trim(),
      stack,
      baseUrl: baseUrl.trim(),
      defaultHeaders
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-slate-100">
              {initialProject ? 'Edit Project Settings' : 'Create New Backend Project'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          <div>
            <label className="block text-slate-300 font-semibold mb-1">
              Project Name *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Project C: Payment Gateway API"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Tech Stack *
              </label>
              <select
                value={stack}
                onChange={e => setStack(e.target.value as TechStack)}
                className="w-full p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-cyan-500"
              >
                <option value="nestjs">NestJS (TypeScript)</option>
                <option value="nextjs">Next.js API Routes</option>
                <option value="php">PHP / Laravel</option>
                <option value="vue">Vue / Nuxt Server</option>
                <option value="other">Other REST Backend</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Base URL *
              </label>
              <input
                type="text"
                required
                placeholder="http://localhost:4000"
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                className="w-full p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 placeholder-slate-500 font-mono text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">
              Description / Microservice Scope
            </label>
            <input
              type="text"
              placeholder="Brief description of the backend responsibilities"
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">
              Default Authorization Header (Optional)
            </label>
            <input
              type="text"
              placeholder="Bearer eyJhbGciOiJIUzI1NiIsIn..."
              value={authHeader}
              onChange={e => setAuthHeader(e.target.value)}
              className="w-full p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 placeholder-slate-500 font-mono text-xs focus:outline-none focus:border-cyan-500"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Applied automatically to test requests unless overridden by chained login tokens.
            </p>
          </div>

          <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs shadow-md shadow-cyan-600/20 transition-colors"
            >
              {initialProject ? 'Update Project' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
