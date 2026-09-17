import React, { useState, useEffect } from 'react';
import { Project, TestCase, TestRunExecution } from '../types';
import {
  Play,
  Save,
  Trash2,
  Link,
  ShieldAlert,
  Clock,
  CheckCircle2,
  XCircle,
  Folder,
  ArrowRight,
  Sparkles,
  ExternalLink,
  Copy,
  Plus,
  GitBranch
} from 'lucide-react';

interface TestCaseEditorProps {
  project: Project;
  testCase: TestCase;
  onUpdateTestCase: (updated: TestCase) => void;
  onDeleteTestCase: (testCaseId: string) => void;
  onRunTest: (testCaseId: string) => Promise<TestRunExecution>;
  onOpenLiveRunner: () => void;
  onOpenVisualFlow?: () => void;
}

export const TestCaseEditor: React.FC<TestCaseEditorProps> = ({
  project,
  testCase,
  onUpdateTestCase,
  onDeleteTestCase,
  onRunTest,
  onOpenLiveRunner,
  onOpenVisualFlow
}) => {
  const [edited, setEdited] = useState<TestCase>({ ...testCase });
  const [bodyText, setBodyText] = useState(
    testCase.request.body ? JSON.stringify(testCase.request.body, null, 2) : ''
  );
  const [headersText, setHeadersText] = useState(
    testCase.request.headers ? JSON.stringify(testCase.request.headers, null, 2) : ''
  );
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [lastRun, setLastRun] = useState<TestRunExecution | null>(
    project.latestReport?.runs.find(r => r.testCaseId === testCase.id) || null
  );
  const [isSavedNotice, setIsSavedNotice] = useState(false);

  useEffect(() => {
    setEdited({ ...testCase });
    setBodyText(testCase.request.body ? JSON.stringify(testCase.request.body, null, 2) : '');
    setHeadersText(testCase.request.headers ? JSON.stringify(testCase.request.headers, null, 2) : '');
    setLastRun(project.latestReport?.runs.find(r => r.testCaseId === testCase.id) || null);
  }, [testCase, project.latestReport]);

  const handleSave = () => {
    try {
      const parsedBody = bodyText.trim() ? JSON.parse(bodyText) : undefined;
      const parsedHeaders = headersText.trim() ? JSON.parse(headersText) : undefined;
      setJsonError(null);

      const updated: TestCase = {
        ...edited,
        request: {
          ...edited.request,
          body: parsedBody,
          headers: parsedHeaders
        }
      };

      onUpdateTestCase(updated);
      setIsSavedNotice(true);
      setTimeout(() => setIsSavedNotice(false), 2000);
    } catch (e: any) {
      setJsonError(e.message);
    }
  };

  const handleRun = async () => {
    setIsRunning(true);
    try {
      const result = await onRunTest(testCase.id);
      setLastRun(result);
    } finally {
      setIsRunning(false);
    }
  };

  // Get list of existing folders across the project for quick autocomplete
  const existingFolders = Array.from(
    new Set(project.testCases.map(t => t.folderPath).filter(Boolean))
  ) as string[];

  // Candidate prerequisites (all test cases except itself)
  const candidatePrereqs = project.testCases.filter(t => t.id !== testCase.id);

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 text-zinc-200 overflow-hidden">
      {/* Top Header Bar */}
      <div className="h-14 border-b border-zinc-800 bg-zinc-900/80 px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-3 min-w-0">
          <span className={`px-2 py-0.5 rounded font-mono font-bold text-xs ${
            edited.request.method === 'GET' ? 'bg-blue-500/20 text-blue-400' :
            edited.request.method === 'POST' ? 'bg-emerald-500/20 text-emerald-400' :
            'bg-amber-500/20 text-amber-400'
          }`}>
            {edited.request.method}
          </span>
          <div className="min-w-0">
            <input
              type="text"
              value={edited.name}
              onChange={e => setEdited({ ...edited, name: e.target.value })}
              className="bg-transparent text-sm font-semibold text-zinc-100 hover:bg-zinc-800/50 px-1 py-0.5 rounded focus:bg-zinc-800 focus:outline-none w-80 truncate"
            />
            <div className="text-[10px] text-zinc-500 font-mono flex items-center gap-1">
              <span>{edited.folderPath || '/General Tests'}</span>
              <span>•</span>
              <span>ID: {edited.id}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {isSavedNotice && (
            <span className="text-xs text-emerald-400 flex items-center gap-1 font-medium mr-2">
              <CheckCircle2 className="w-3.5 h-3.5" /> Saved
            </span>
          )}

          <button
            onClick={handleSave}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 rounded text-xs font-medium flex items-center gap-1.5 transition-colors"
          >
            <Save className="w-3.5 h-3.5 text-zinc-400" />
            <span>Save</span>
          </button>

          {onOpenVisualFlow && (
            <button
              onClick={onOpenVisualFlow}
              title="Open Visual Sequence & Dependency Diagram Flow"
              className="px-3 py-1.5 bg-indigo-950/70 hover:bg-indigo-900 text-indigo-300 border border-indigo-800/60 rounded text-xs font-medium flex items-center gap-1.5 transition-colors"
            >
              <GitBranch className="w-3.5 h-3.5 text-indigo-400" />
              <span>Visual Flow</span>
            </button>
          )}

          <button
            onClick={handleRun}
            disabled={isRunning}
            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>{isRunning ? 'Running...' : 'Run Test'}</span>
          </button>

          <button
            onClick={onOpenLiveRunner}
            title="Open Live Runner with iFrame Viewport"
            className="p-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded border border-zinc-700"
          >
            <ExternalLink className="w-4 h-4 text-zinc-400" />
          </button>

          <button
            onClick={() => onDeleteTestCase(testCase.id)}
            title="Delete Test Case"
            className="p-1.5 hover:bg-rose-500/20 text-zinc-400 hover:text-rose-400 rounded"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar max-w-5xl mx-auto w-full">
        {/* Folder Hierarchy & Organization */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Folder className="w-3.5 h-3.5 text-amber-400" />
            <span>Sidebar Folder & Module Location</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Folder Path (Grouping)</label>
              <input
                type="text"
                value={edited.folderPath || ''}
                onChange={e => setEdited({ ...edited, folderPath: e.target.value })}
                placeholder="e.g. /Auth Module/Login Feature/Happy Path"
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-xs text-zinc-200 font-mono focus:outline-none focus:border-blue-500"
              />
              <span className="text-[10px] text-zinc-500 mt-1 block">
                Use slashes to create nested subfolders (e.g. Module A / Feature B / Positive).
              </span>
            </div>

            <div>
              <label className="block text-xs text-zinc-400 mb-1">Existing Folders Shortcut</label>
              <select
                onChange={e => e.target.value && setEdited({ ...edited, folderPath: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-xs text-zinc-200 font-mono focus:outline-none"
                defaultValue=""
              >
                <option value="" disabled>Select existing folder...</option>
                {existingFolders.map(f => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* E2E Dependencies & Prerequisite Chaining (User Requested) */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
              <Link className="w-3.5 h-3.5 text-blue-400" />
              <span>E2E Nested Dependencies & Variable Piping</span>
            </div>

            {onOpenVisualFlow && (
              <button
                onClick={onOpenVisualFlow}
                className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1 transition-colors"
              >
                <GitBranch className="w-3.5 h-3.5" />
                <span>Open Visual Flow Diagram →</span>
              </button>
            )}
          </div>

          <div className="space-y-4 text-xs">
            <div>
              <label className="block text-zinc-400 mb-1">
                Prerequisite Test (Must succeed before running this test):
              </label>
              <select
                value={edited.dependsOn?.[0] || ''}
                onChange={e => {
                  const val = e.target.value;
                  setEdited({
                    ...edited,
                    dependsOn: val ? [val] : undefined,
                    chainedContext: {
                      ...edited.chainedContext,
                      sourceTestCaseId: val || undefined
                    }
                  });
                }}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-xs text-zinc-200 font-mono focus:outline-none"
              >
                <option value="">None (Standalone independent test)</option>
                {candidatePrereqs.map(p => (
                  <option key={p.id} value={p.id}>
                    [{p.request.method}] {p.name} ({p.folderPath || 'General'})
                  </option>
                ))}
              </select>
              <span className="text-[10px] text-zinc-500 mt-1 block">
                The test runner automatically traces dependencies and executes prerequisite tests first (e.g. Login before Order, Order before Invoice).
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-zinc-800/80">
              <div>
                <label className="block text-zinc-400 mb-1">Extract Variable From Response:</label>
                <input
                  type="text"
                  value={edited.chainedContext?.extractResponseKey || ''}
                  onChange={e => setEdited({
                    ...edited,
                    chainedContext: {
                      ...edited.chainedContext,
                      extractResponseKey: e.target.value
                    }
                  })}
                  placeholder="e.g. accessToken, orderId, or data.id"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-xs text-zinc-200 font-mono focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-zinc-400 mb-1">Inject Variable Into Header:</label>
                <input
                  type="text"
                  value={edited.chainedContext?.injectIntoHeader || ''}
                  onChange={e => setEdited({
                    ...edited,
                    chainedContext: {
                      ...edited.chainedContext,
                      injectIntoHeader: e.target.value
                    }
                  })}
                  placeholder="e.g. Authorization (Bearer {{val}})"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-xs text-zinc-200 font-mono focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>

        {/* HTTP Request Definition */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-4">
          <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
            HTTP Request Contract
          </div>

          <div className="flex gap-3">
            <select
              value={edited.request.method}
              onChange={e => setEdited({
                ...edited,
                request: { ...edited.request, method: e.target.value as any }
              })}
              className="bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-xs font-mono font-semibold focus:outline-none text-blue-400"
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>

            <input
              type="text"
              value={edited.request.path}
              onChange={e => setEdited({
                ...edited,
                request: { ...edited.request, path: e.target.value }
              })}
              placeholder="/api/endpoint"
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-xs font-mono text-zinc-200 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Headers Editor */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Headers (JSON format)</label>
            <textarea
              rows={2}
              value={headersText}
              onChange={e => setHeadersText(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded p-2 text-xs font-mono text-zinc-200 focus:outline-none"
              placeholder='{"Authorization": "Bearer {{accessToken}}"}'
            />
          </div>

          {/* Request Body Editor */}
          {['POST', 'PUT', 'PATCH'].includes(edited.request.method) && (
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Request Payload Body (JSON)</label>
              <textarea
                rows={5}
                value={bodyText}
                onChange={e => setBodyText(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded p-2 text-xs font-mono text-zinc-200 focus:outline-none"
                placeholder='{"orderId": "{{orderId}}", "amount": 99.98}'
              />
              {jsonError && (
                <div className="text-xs text-rose-400 mt-1 font-mono">Invalid JSON: {jsonError}</div>
              )}
            </div>
          )}
        </div>

        {/* Assertions & Verification */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-4">
          <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
            Assertions & Quality Gates
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-zinc-400 mb-1">Expected HTTP Statuses (comma separated):</label>
              <input
                type="text"
                value={edited.assertions.expectedStatuses.join(', ')}
                onChange={e => {
                  const statuses = e.target.value
                    .split(',')
                    .map(s => parseInt(s.trim()))
                    .filter(n => !isNaN(n));
                  setEdited({
                    ...edited,
                    assertions: { ...edited.assertions, expectedStatuses: statuses }
                  });
                }}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-xs font-mono text-zinc-200 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-zinc-400 mb-1">Max Latency SLA (ms):</label>
              <input
                type="number"
                value={edited.assertions.maxLatencyMs || 1000}
                onChange={e => setEdited({
                  ...edited,
                  assertions: { ...edited.assertions, maxLatencyMs: parseInt(e.target.value) || 1000 }
                })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-xs font-mono text-zinc-200 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Latest Execution Report Card (if run) */}
        {lastRun && (
          <div className={`p-4 rounded-lg border text-xs ${
            lastRun.status === 'passed' ? 'bg-emerald-950/20 border-emerald-500/40' : 'bg-rose-950/20 border-rose-500/40'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 font-semibold">
                {lastRun.status === 'passed' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-rose-400" />
                )}
                <span>Last Execution: HTTP {lastRun.httpStatus} ({lastRun.latencyMs}ms)</span>
              </div>
              <span className="text-[10px] text-zinc-500 font-mono">
                {new Date(lastRun.timestamp).toLocaleTimeString()}
              </span>
            </div>

            <div className="space-y-1 mt-3 border-t border-zinc-800/80 pt-2">
              {lastRun.assertionResults.map((a, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-zinc-400">{a.name}</span>
                  <span className={a.passed ? 'text-emerald-400 font-medium' : 'text-rose-400 font-medium'}>
                    {a.passed ? '✓ PASSED' : '✕ FAILED'}
                  </span>
                </div>
              ))}
            </div>

            {lastRun.aiDiagnosis && (
              <div className="mt-3 bg-zinc-900 p-3 rounded border border-rose-500/30 text-zinc-300">
                <div className="font-semibold text-rose-400 flex items-center gap-1.5 mb-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>AI Root Cause Diagnosis</span>
                </div>
                <div className="text-[11px] text-zinc-400 mb-1">{lastRun.aiDiagnosis.rootCause}</div>
                <div className="text-[11px] text-blue-300 font-mono">{lastRun.aiDiagnosis.suggestedFix}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
