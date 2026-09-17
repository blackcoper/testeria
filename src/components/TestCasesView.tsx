import React, { useState } from 'react';
import { Project, TestCase, TestCaseCategory, TestRunExecution } from '../types';
import {
  Play,
  Trash2,
  Filter,
  CheckCircle2,
  XCircle,
  Clock,
  Sparkles,
  Search,
  Code,
  ArrowRight,
  ShieldAlert,
  SlidersHorizontal,
  ChevronRight
} from 'lucide-react';

interface TestCasesViewProps {
  project: Project;
  onRunSingleTest: (testCaseId: string) => Promise<TestRunExecution>;
  onDeleteTestCase: (testCaseId: string) => void;
  onNavigateToGenerate: () => void;
  onOpenReport: () => void;
}

export const TestCasesView: React.FC<TestCasesViewProps> = ({
  project,
  onRunSingleTest,
  onDeleteTestCase,
  onNavigateToGenerate,
  onOpenReport
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [runningTestId, setRunningTestId] = useState<string | null>(null);
  const [lastResults, setLastResults] = useState<Record<string, TestRunExecution>>({});
  const [expandedTestId, setExpandedTestId] = useState<string | null>(null);

  const categories: Array<{ id: string; label: string; count: number }> = [
    { id: 'all', label: 'All Tests', count: project.testCases.length },
    {
      id: 'happy_path',
      label: 'Happy Path',
      count: project.testCases.filter(t => t.category === 'happy_path').length
    },
    {
      id: 'negative_validation',
      label: 'Validation (400)',
      count: project.testCases.filter(t => t.category === 'negative_validation').length
    },
    {
      id: 'auth_security',
      label: 'Auth & Guard (401/403)',
      count: project.testCases.filter(t => t.category === 'auth_security').length
    },
    {
      id: 'boundary_edge',
      label: 'Boundary & Fuzzing',
      count: project.testCases.filter(t => t.category === 'boundary_edge').length
    },
    {
      id: 'chained_flow',
      label: 'Chained Flows',
      count: project.testCases.filter(t => t.category === 'chained_flow').length
    }
  ];

  const filteredTests = project.testCases.filter(tc => {
    if (selectedCategory !== 'all' && tc.category !== selectedCategory) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        tc.name.toLowerCase().includes(q) ||
        tc.request.path.toLowerCase().includes(q) ||
        tc.description.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleRun = async (testId: string) => {
    setRunningTestId(testId);
    try {
      const result = await onRunSingleTest(testId);
      setLastResults(prev => ({ ...prev, [testId]: result }));
    } finally {
      setRunningTestId(null);
    }
  };

  const getMethodColor = (method: string) => {
    switch (method.toUpperCase()) {
      case 'GET':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
      case 'POST':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
      case 'PUT':
      case 'PATCH':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
      case 'DELETE':
        return 'bg-rose-500/10 text-rose-400 border-rose-500/30';
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/30';
    }
  };

  const getCategoryBadge = (cat: TestCaseCategory) => {
    switch (cat) {
      case 'happy_path':
        return <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">Happy Path</span>;
      case 'negative_validation':
        return <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-300 border border-orange-500/20">Validation 400</span>;
      case 'auth_security':
        return <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20">Auth Guard</span>;
      case 'boundary_edge':
        return <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-300 border border-sky-500/20">Boundary Fuzz</span>;
      case 'chained_flow':
        return <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-pink-500/10 text-pink-300 border border-pink-500/20">Chained Flow</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Stats */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-slate-900 border border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-slate-100">Test Cases Suite</h2>
            <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
              Target: {project.baseUrl}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Configured automated assertions for {project.endpoints.length} endpoints with status code, schema, and latency checks.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onNavigateToGenerate}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-xs font-medium transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            AI Generate Tests
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
          {categories.map(c => (
            <button
              key={c.id}
              onClick={() => setSelectedCategory(c.id)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                selectedCategory === c.id
                  ? 'bg-slate-800 text-cyan-300 border border-cyan-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <span>{c.label}</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-900 text-slate-400">
                {c.count}
              </span>
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search endpoint or test..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
          />
        </div>
      </div>

      {/* Test Cases List */}
      <div className="space-y-3">
        {filteredTests.length === 0 ? (
          <div className="p-12 text-center rounded-xl bg-slate-900/50 border border-slate-800">
            <SlidersHorizontal className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <h3 className="text-sm font-medium text-slate-300">No test cases found</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              No tests match your category filter or search query. Click below to generate automated test cases using AI.
            </p>
            <button
              onClick={onNavigateToGenerate}
              className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Generate Test Cases
            </button>
          </div>
        ) : (
          filteredTests.map((tc) => {
            const isRunning = runningTestId === tc.id;
            const lastResult = lastResults[tc.id];
            const isExpanded = expandedTestId === tc.id;

            return (
              <div
                key={tc.id}
                className="rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700/80 transition-all overflow-hidden"
              >
                {/* Main Card Row */}
                <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${getMethodColor(tc.request.method)}`}>
                        {tc.request.method}
                      </span>
                      <span className="text-xs font-mono text-slate-300 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                        {tc.request.path}
                      </span>
                      {getCategoryBadge(tc.category)}
                      {tc.chainedContext && (
                        <span className="text-[10px] font-mono text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-1.5 py-0.5 rounded">
                          🔗 Chained Token
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-medium text-slate-200">{tc.name}</h4>
                    </div>

                    <p className="text-xs text-slate-400">{tc.description}</p>
                  </div>

                  {/* Right Controls */}
                  <div className="flex items-center gap-2 self-end md:self-center shrink-0">
                    {/* Expected Status pill */}
                    <div className="text-right hidden sm:block">
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Expected</div>
                      <div className="text-xs font-mono text-slate-300">
                        HTTP {tc.assertions.expectedStatuses.join(' / ')}
                      </div>
                    </div>

                    {/* Single Run Button */}
                    <button
                      onClick={() => handleRun(tc.id)}
                      disabled={isRunning}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors border border-slate-700 disabled:opacity-50"
                    >
                      {isRunning ? (
                        <div className="w-3.5 h-3.5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>
                      ) : (
                        <Play className="w-3.5 h-3.5 text-cyan-400 fill-cyan-400" />
                      )}
                      <span>{isRunning ? 'Probing...' : 'Run'}</span>
                    </button>

                    {/* Toggle details */}
                    <button
                      onClick={() => setExpandedTestId(isExpanded ? null : tc.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                      title="View Request & Assertions"
                    >
                      <Code className="w-4 h-4" />
                    </button>

                    {/* Delete button */}
                    <button
                      onClick={() => onDeleteTestCase(tc.id)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                      title="Delete Test Case"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Inline execution result indicator */}
                {lastResult && (
                  <div
                    className={`px-4 py-2 border-t text-xs flex items-center justify-between ${
                      lastResult.status === 'passed'
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                        : 'bg-rose-500/10 border-rose-500/20 text-rose-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {lastResult.status === 'passed' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <XCircle className="w-4 h-4 text-rose-400" />
                      )}
                      <span className="font-semibold uppercase tracking-wider">
                        {lastResult.status === 'passed' ? 'PASSED' : 'FAILED'}
                      </span>
                      <span>—</span>
                      <span>HTTP {lastResult.httpStatus}</span>
                      <span>•</span>
                      <span>{lastResult.latencyMs}ms</span>
                    </div>

                    <button
                      onClick={onOpenReport}
                      className="underline font-medium hover:opacity-80"
                    >
                      View in Report →
                    </button>
                  </div>
                )}

                {/* Expanded Details Drawer */}
                {isExpanded && (
                  <div className="p-4 bg-slate-950 border-t border-slate-800 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                          Request Payload (Body)
                        </div>
                        <pre className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-40">
                          {tc.request.body ? JSON.stringify(tc.request.body, null, 2) : '// No body (empty)'}
                        </pre>
                      </div>

                      <div>
                        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                          Configured Assertions
                        </div>
                        <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5 text-xs text-slate-300">
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">HTTP Status:</span>
                            <span className="font-mono text-cyan-400">[{tc.assertions.expectedStatuses.join(', ')}]</span>
                          </div>
                          {tc.assertions.requiredBodyKeys && (
                            <div className="flex items-center justify-between">
                              <span className="text-slate-400">Required Keys:</span>
                              <span className="font-mono text-slate-300">{tc.assertions.requiredBodyKeys.join(', ')}</span>
                            </div>
                          )}
                          {tc.assertions.forbiddenBodyKeys && (
                            <div className="flex items-center justify-between">
                              <span className="text-slate-400">Forbidden Keys:</span>
                              <span className="font-mono text-rose-400">{tc.assertions.forbiddenBodyKeys.join(', ')}</span>
                            </div>
                          )}
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">Max Latency SLA:</span>
                            <span className="font-mono text-slate-300">{tc.assertions.maxLatencyMs || 1000}ms</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
