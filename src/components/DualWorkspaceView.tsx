import React, { useState } from 'react';
import { Project, TestCase, TestRunExecution, TestSuiteReport } from '../types';
import {
  Layers,
  Play,
  CheckCircle2,
  XCircle,
  Folder,
  ArrowRight,
  ExternalLink,
  Split,
  ChevronRight,
  ChevronDown
} from 'lucide-react';

interface DualWorkspaceViewProps {
  projects: Project[];
  activeProject: Project;
  onSelectTestCase: (projectId: string, testCaseId: string) => void;
  onRunTest: (projectId: string, testCaseId: string) => Promise<TestRunExecution>;
  onRunSuite: (projectId: string) => Promise<TestSuiteReport>;
  onCloseDualMode: () => void;
}

export const DualWorkspaceView: React.FC<DualWorkspaceViewProps> = ({
  projects,
  activeProject,
  onSelectTestCase,
  onRunTest,
  onRunSuite,
  onCloseDualMode
}) => {
  const [leftProjectId, setLeftProjectId] = useState<string>(activeProject.id);
  const [rightProjectId, setRightProjectId] = useState<string>(
    projects.find(p => p.id !== activeProject.id)?.id || projects[0]?.id || activeProject.id
  );

  const leftProject = projects.find(p => p.id === leftProjectId) || activeProject;
  const rightProject = projects.find(p => p.id === rightProjectId) || projects[0] || activeProject;

  const [leftRunning, setLeftRunning] = useState(false);
  const [rightRunning, setRightRunning] = useState(false);

  const handleRunLeftSuite = async () => {
    setLeftRunning(true);
    try {
      await onRunSuite(leftProject.id);
    } finally {
      setLeftRunning(false);
    }
  };

  const handleRunRightSuite = async () => {
    setRightRunning(true);
    try {
      await onRunSuite(rightProject.id);
    } finally {
      setRightRunning(false);
    }
  };

  const renderProjectPane = (
    proj: Project,
    isLeft: boolean,
    isRunning: boolean,
    onRunSuite: () => void,
    selectedProjId: string,
    onChangeProj: (id: string) => void
  ) => {
    // Group test cases by folderPath
    const groups: Record<string, TestCase[]> = {};
    for (const tc of proj.testCases) {
      const folder = tc.folderPath || '/General';
      if (!groups[folder]) groups[folder] = [];
      groups[folder].push(tc);
    }

    return (
      <div className="flex-1 flex flex-col h-full bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        {/* Pane Header */}
        <div className="p-3 border-b border-zinc-800 bg-zinc-950/60 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              {isLeft ? 'Workspace Pane A' : 'Workspace Pane B'}:
            </span>
            <select
              value={selectedProjId}
              onChange={e => onChangeProj(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 font-semibold focus:outline-none"
            >
              {projects.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.stack.toUpperCase()})
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={onRunSuite}
            disabled={isRunning}
            className="px-2.5 py-1 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <Play className="w-3 h-3 fill-current" />
            <span>{isRunning ? 'Running...' : 'Run All'}</span>
          </button>
        </div>

        {/* Project Meta Bar */}
        <div className="px-3 py-2 bg-zinc-900/80 border-b border-zinc-800/80 flex items-center justify-between text-xs text-zinc-400">
          <span className="font-mono text-[11px] text-zinc-500">Base URL: {proj.baseUrl}</span>
          <span className="font-mono text-[11px] text-zinc-400">{proj.testCases.length} Test Cases</span>
        </div>

        {/* Tree & Tests List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
          {Object.entries(groups).map(([folder, tests]) => (
            <div key={folder} className="space-y-1">
              <div className="flex items-center space-x-1.5 text-xs font-medium text-amber-400/90 py-1">
                <Folder className="w-3.5 h-3.5" />
                <span>{folder}</span>
                <span className="text-[10px] text-zinc-500 bg-zinc-800 px-1.5 rounded-full">
                  {tests.length}
                </span>
              </div>

              <div className="pl-4 space-y-1">
                {tests.map(tc => {
                  const run = proj.latestReport?.runs.find(r => r.testCaseId === tc.id);
                  return (
                    <div
                      key={tc.id}
                      onClick={() => onSelectTestCase(proj.id, tc.id)}
                      className="group flex items-center justify-between px-2.5 py-1.5 rounded bg-zinc-950/60 hover:bg-zinc-800/60 border border-zinc-800/60 text-xs cursor-pointer transition-colors"
                    >
                      <div className="flex items-center space-x-2 truncate pr-2">
                        <span className={`text-[9px] font-mono font-bold px-1 py-0.2 rounded ${
                          tc.request.method === 'GET' ? 'bg-blue-500/20 text-blue-400' :
                          tc.request.method === 'POST' ? 'bg-emerald-500/20 text-emerald-400' :
                          'bg-amber-500/20 text-amber-400'
                        }`}>
                          {tc.request.method}
                        </span>
                        <span className="truncate text-zinc-200">{tc.name}</span>
                      </div>

                      <div className="flex items-center space-x-2 shrink-0">
                        {run ? (
                          <span className={`text-[10px] font-mono flex items-center gap-1 ${
                            run.status === 'passed' ? 'text-emerald-400' : 'text-rose-400'
                          }`}>
                            {run.status === 'passed' ? (
                              <CheckCircle2 className="w-3 h-3" />
                            ) : (
                              <XCircle className="w-3 h-3" />
                            )}
                            <span>{run.latencyMs}ms</span>
                          </span>
                        ) : (
                          <span className="text-[10px] text-zinc-600 font-mono">not run</span>
                        )}

                        <button
                          title="Run single test"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRunTest(proj.id, tc.id);
                          }}
                          className="p-1 hover:bg-emerald-500/20 hover:text-emerald-400 rounded text-zinc-400 opacity-0 group-hover:opacity-100"
                        >
                          <Play className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 text-zinc-200 overflow-hidden p-4 space-y-3">
      {/* Top Banner */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Split className="w-4 h-4 text-blue-400" />
          <span className="font-semibold text-sm text-zinc-100">Dual Workspace Split Stage</span>
          <span className="text-xs text-zinc-400">
            (Work on and cross-test multiple microservices or backend projects side-by-side)
          </span>
        </div>

        <button
          onClick={onCloseDualMode}
          className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs border border-zinc-700 transition-colors"
        >
          Exit Dual View
        </button>
      </div>

      {/* 2-Pane Side-by-Side Area */}
      <div className="flex-1 flex space-x-4 overflow-hidden">
        {renderProjectPane(leftProject, true, leftRunning, handleRunLeftSuite, leftProjectId, setLeftProjectId)}
        {renderProjectPane(rightProject, false, rightRunning, handleRunRightSuite, rightProjectId, setRightProjectId)}
      </div>
    </div>
  );
};
