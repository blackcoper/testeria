import React, { useState } from 'react';
import { Project, TestSuiteReport, TestRunExecution } from '../types';
import {
  History,
  Clock,
  CheckCircle2,
  XCircle,
  Play,
  RotateCcw,
  Calendar,
  Layers,
  ChevronRight,
  Sparkles,
  ArrowRight,
  ExternalLink,
  Filter
} from 'lucide-react';

interface HistoryViewProps {
  project: Project;
  onSelectRunToInspect?: (run: TestRunExecution) => void;
  onRerunSuite: () => void;
  onOpenLiveRunner: () => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  project,
  onSelectRunToInspect,
  onRerunSuite,
  onOpenLiveRunner
}) => {
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'passed' | 'failed'>('all');

  // Collect history reports. If reportsHistory isn't populated, fall back to project.latestReport
  const historyList: TestSuiteReport[] = project.reportsHistory && project.reportsHistory.length > 0
    ? project.reportsHistory
    : project.latestReport
      ? [project.latestReport]
      : [];

  const activeReport = historyList.find(r => r.id === selectedReportId) || historyList[0] || null;

  if (historyList.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-8 bg-zinc-950 text-zinc-300">
        <div className="max-w-md text-center space-y-4 bg-zinc-900 border border-zinc-800 p-8 rounded-xl">
          <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mx-auto text-zinc-400">
            <History className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-zinc-100">No Execution History Yet</h3>
            <p className="text-xs text-zinc-400 mt-1">
              You haven't run any test suites for <strong>{project.name}</strong>. Once you execute a test or an E2E pipeline, all past runs, latencies, and responses are tracked here.
            </p>
          </div>
          <button
            onClick={() => {
              onOpenLiveRunner();
              onRerunSuite();
            }}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-2 transition-colors"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Execute Test Pipeline Now</span>
          </button>
        </div>
      </div>
    );
  }

  const filteredRuns = activeReport
    ? activeReport.runs.filter(r => {
        if (filterMode === 'passed') return r.status === 'passed';
        if (filterMode === 'failed') return r.status === 'failed';
        return true;
      })
    : [];

  return (
    <div className="h-full flex flex-col bg-zinc-950 text-zinc-200 overflow-hidden">
      {/* Top Header */}
      <div className="h-14 border-b border-zinc-800 bg-zinc-900/80 px-6 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
            <History className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
              <span>Test Execution History</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">
                {historyList.length} Runs Recorded
              </span>
            </h2>
            <p className="text-[11px] text-zinc-400">
              Audit past test runs, compare latency regressions, and review individual request/response telemetry.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => {
              onOpenLiveRunner();
              onRerunSuite();
            }}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Run Suite Again</span>
          </button>
        </div>
      </div>

      {/* 2-Pane History Inspector */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column: List of Past Runs */}
        <div className="w-80 border-r border-zinc-800 bg-zinc-900/40 flex flex-col shrink-0 overflow-hidden">
          <div className="p-3 border-b border-zinc-800/80 text-xs font-medium text-zinc-400 flex items-center justify-between">
            <span>Execution Timeline</span>
            <span className="text-[10px] text-zinc-500 font-mono">Newest First</span>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1.5 custom-scrollbar">
            {historyList.map((hist, index) => {
              const isSelected = activeReport?.id === hist.id;
              const dateObj = new Date(hist.runAt);
              const timeFormatted = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
              const dateFormatted = dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' });

              return (
                <div
                  key={hist.id}
                  onClick={() => setSelectedReportId(hist.id)}
                  className={`p-3 rounded-lg border cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-blue-950/40 border-blue-500/50 shadow-sm'
                      : 'bg-zinc-900/80 border-zinc-800/70 hover:bg-zinc-800/60 text-zinc-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      {hist.passRate === 100 ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : hist.passRate >= 75 ? (
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
                      ) : (
                        <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                      )}
                      <span className="text-xs font-semibold text-zinc-100">
                        Run #{historyList.length - index}
                      </span>
                    </div>

                    <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded ${
                      hist.passRate === 100 ? 'bg-emerald-500/10 text-emerald-400' :
                      hist.passRate >= 70 ? 'bg-amber-500/10 text-amber-400' :
                      'bg-rose-500/10 text-rose-400'
                    }`}>
                      {hist.passRate}%
                    </span>
                  </div>

                  <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-400">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-zinc-500" />
                      <span>{dateFormatted}, {timeFormatted}</span>
                    </div>
                    <div className="font-mono text-zinc-400">
                      {hist.passed}/{hist.totalTests} passed
                    </div>
                  </div>

                  <div className="mt-1 flex items-center justify-between text-[10px] text-zinc-500 font-mono">
                    <span>Avg: {hist.avgLatencyMs}ms</span>
                    <span>Max: {hist.maxLatencyMs}ms</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Selected Run Breakdown & Steps */}
        {activeReport ? (
          <div className="flex-1 flex flex-col overflow-hidden bg-zinc-950">
            {/* Run Overview Bar */}
            <div className="p-4 border-b border-zinc-800 bg-zinc-900/30 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-6">
                <div>
                  <div className="text-[10px] uppercase font-mono text-zinc-500">Run Completed</div>
                  <div className="text-xs font-semibold text-zinc-200">
                    {new Date(activeReport.runAt).toLocaleString()}
                  </div>
                </div>

                <div className="border-l border-zinc-800 pl-4">
                  <div className="text-[10px] uppercase font-mono text-zinc-500">Pass Rate</div>
                  <div className={`text-sm font-extrabold font-mono ${
                    activeReport.passRate === 100 ? 'text-emerald-400' : 'text-amber-400'
                  }`}>
                    {activeReport.passRate}% ({activeReport.passed}/{activeReport.totalTests})
                  </div>
                </div>

                <div className="border-l border-zinc-800 pl-4">
                  <div className="text-[10px] uppercase font-mono text-zinc-500">Latency Profile</div>
                  <div className="text-xs font-mono text-zinc-300">
                    Avg: <strong className="text-zinc-100">{activeReport.avgLatencyMs}ms</strong> • P95: <strong className="text-zinc-100">{activeReport.p95LatencyMs}ms</strong>
                  </div>
                </div>
              </div>

              {/* Filters */}
              <div className="flex items-center gap-1.5 bg-zinc-900 p-1 rounded border border-zinc-800 text-xs">
                <button
                  onClick={() => setFilterMode('all')}
                  className={`px-2.5 py-1 rounded transition-colors ${
                    filterMode === 'all' ? 'bg-zinc-800 text-zinc-100 font-medium' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  All ({activeReport.runs.length})
                </button>
                <button
                  onClick={() => setFilterMode('passed')}
                  className={`px-2.5 py-1 rounded transition-colors ${
                    filterMode === 'passed' ? 'bg-emerald-950/60 text-emerald-400 font-medium' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Passed ({activeReport.passed})
                </button>
                <button
                  onClick={() => setFilterMode('failed')}
                  className={`px-2.5 py-1 rounded transition-colors ${
                    filterMode === 'failed' ? 'bg-rose-950/60 text-rose-400 font-medium' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Failed ({activeReport.failed})
                </button>
              </div>
            </div>

            {/* Step list / Table */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
              {filteredRuns.map((run, idx) => (
                <div
                  key={run.id}
                  className="bg-zinc-900/70 border border-zinc-800/80 rounded-lg p-3 hover:border-zinc-700 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <span className="font-mono text-xs text-zinc-500 w-5 text-right">
                        #{idx + 1}
                      </span>
                      <span className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                        run.requestSent.method === 'GET' ? 'bg-blue-500/20 text-blue-400' :
                        run.requestSent.method === 'POST' ? 'bg-emerald-500/20 text-emerald-400' :
                        'bg-amber-500/20 text-amber-400'
                      }`}>
                        {run.requestSent.method}
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-zinc-100 truncate">
                          {run.testCaseName}
                        </div>
                        <div className="text-[11px] font-mono text-zinc-400 truncate">
                          {run.requestSent.url}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3">
                      <div className="text-right">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold ${
                          run.status === 'passed' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                        }`}>
                          HTTP {run.httpStatus}
                        </span>
                        <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                          {run.latencyMs} ms
                        </div>
                      </div>

                      {onSelectRunToInspect && (
                        <button
                          onClick={() => {
                            onSelectRunToInspect(run);
                            onOpenLiveRunner();
                          }}
                          className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs flex items-center gap-1"
                          title="Inspect in Live Runner"
                        >
                          <span>Inspect</span>
                          <ChevronRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Assertion breakdown pills */}
                  <div className="mt-2.5 pt-2 border-t border-zinc-800/60 flex flex-wrap gap-2 text-[10px]">
                    {run.assertionResults.map((a, aIdx) => (
                      <div
                        key={aIdx}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded font-mono ${
                          a.passed ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-800/40' : 'bg-rose-950/40 text-rose-400 border border-rose-800/40'
                        }`}
                      >
                        {a.passed ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        <span>{a.name}</span>
                      </div>
                    ))}

                    {run.extractedVariables && Object.keys(run.extractedVariables).length > 0 && (
                      <div className="flex items-center gap-1 px-2 py-0.5 rounded font-mono bg-blue-950/40 text-blue-300 border border-blue-800/40">
                        <span>Piped vars: {Object.keys(run.extractedVariables).join(', ')}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-xs text-zinc-500">
            Select an execution run from the left to view details.
          </div>
        )}
      </div>
    </div>
  );
};
