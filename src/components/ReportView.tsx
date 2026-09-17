import React, { useState } from 'react';
import { Project, TestSuiteReport, TestRunExecution } from '../types';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Activity,
  Code2,
  AlertTriangle,
  Play,
  Filter,
  Layers,
  Sparkles,
  Copy,
  Check,
  ChevronRight,
  ShieldAlert,
  Terminal
} from 'lucide-react';

interface ReportViewProps {
  project: Project;
  report: TestSuiteReport | null;
  onRerunTests: () => void;
  isRunningTests: boolean;
}

export const ReportView: React.FC<ReportViewProps> = ({
  project,
  report,
  onRerunTests,
  isRunningTests
}) => {
  const [selectedRun, setSelectedRun] = useState<TestRunExecution | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'passed' | 'failed'>('all');
  const [copiedCurl, setCopiedCurl] = useState(false);

  if (!report || report.runs.length === 0) {
    return (
      <div className="p-12 text-center rounded-xl bg-slate-900 border border-slate-800 space-y-4">
        <Activity className="w-10 h-10 text-slate-600 mx-auto" />
        <div className="max-w-md mx-auto space-y-1">
          <h3 className="text-sm font-semibold text-slate-200">No Execution Report Available</h3>
          <p className="text-xs text-slate-400">
            Run the test suite for <strong>{project.name}</strong> to generate comprehensive latency analysis, HTTP request/response traces, and AI failure diagnostics.
          </p>
        </div>
        <button
          onClick={onRerunTests}
          disabled={isRunningTests}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs shadow-md transition-colors"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>Execute {project.testCases.length} Tests Now</span>
        </button>
      </div>
    );
  }

  const filteredRuns = report.runs.filter(r => {
    if (filterStatus === 'passed') return r.status === 'passed';
    if (filterStatus === 'failed') return r.status === 'failed';
    return true;
  });

  const generateCurl = (run: TestRunExecution) => {
    const headers = Object.entries(run.requestSent.headers || {})
      .map(([k, v]) => `-H "${k}: ${v}"`)
      .join(' ');
    const body = run.requestSent.body
      ? `-d '${JSON.stringify(run.requestSent.body)}'`
      : '';
    return `curl -X ${run.requestSent.method} "${run.requestSent.url}" ${headers} ${body}`.trim();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* KPI Cards Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Pass Rate */}
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Pass Rate
            </div>
            <div className="text-2xl font-extrabold text-slate-100 mt-1">
              {report.passRate}%
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              {report.passed} of {report.totalTests} passed
            </div>
          </div>
          <div className="w-12 h-12 rounded-full border-4 border-slate-800 flex items-center justify-center relative">
            <span
              className={`text-xs font-bold ${
                report.passRate >= 80 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {report.passRate}%
            </span>
          </div>
        </div>

        {/* Failed Tests */}
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Failures & Violations
          </div>
          <div className="text-2xl font-extrabold text-slate-100 mt-1">
            <span className={report.failed > 0 ? 'text-rose-400' : 'text-emerald-400'}>
              {report.failed}
            </span>
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            {report.failed > 0 ? 'Requires AI diagnosis review' : 'All assertions green'}
          </div>
        </div>

        {/* Latency P95 */}
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Latency (P95 / Avg)
          </div>
          <div className="text-2xl font-extrabold text-slate-100 mt-1">
            {report.p95LatencyMs}
            <span className="text-xs font-normal text-slate-400 ml-1">ms p95</span>
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            Avg: {report.avgLatencyMs}ms • Max: {report.maxLatencyMs}ms
          </div>
        </div>

        {/* HTTP Status Breakdown */}
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
            HTTP Status Breakdown
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {Object.entries(report.statusDistribution).map(([code, count]) => {
              const is2xx = code.startsWith('2');
              const is4xx = code.startsWith('4');
              const is5xx = code.startsWith('5');
              return (
                <span
                  key={code}
                  className={`text-[10px] font-mono px-2 py-0.5 rounded border font-semibold ${
                    is2xx
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      : is4xx
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                      : is5xx
                      ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                      : 'bg-slate-800 text-slate-300 border-slate-700'
                  }`}
                >
                  {code}: {count}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* Filter and Re-run bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 rounded-xl bg-slate-900 border border-slate-800">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-400 font-medium mr-1">Filter:</span>
          <button
            onClick={() => setFilterStatus('all')}
            className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${
              filterStatus === 'all'
                ? 'bg-slate-800 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            All ({report.totalTests})
          </button>
          <button
            onClick={() => setFilterStatus('passed')}
            className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${
              filterStatus === 'passed'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Passed ({report.passed})
          </button>
          <button
            onClick={() => setFilterStatus('failed')}
            className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${
              filterStatus === 'failed'
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Failed ({report.failed})
          </button>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            Run timestamp: {new Date(report.runAt).toLocaleTimeString()}
          </span>
          <button
            onClick={onRerunTests}
            disabled={isRunningTests}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors"
          >
            <Play className="w-3 h-3 fill-current" />
            <span>Re-run Suite</span>
          </button>
        </div>
      </div>

      {/* Test Runs Table */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 text-slate-400 font-semibold border-b border-slate-800 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Test Case Name</th>
                <th className="px-4 py-3">Endpoint Target</th>
                <th className="px-4 py-3">HTTP Status</th>
                <th className="px-4 py-3">Latency</th>
                <th className="px-4 py-3">Assertions</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {filteredRuns.map(run => {
                const passedAssertions = run.assertionResults.filter(a => a.passed).length;
                const totalAssertions = run.assertionResults.length;

                return (
                  <tr
                    key={run.id}
                    onClick={() => setSelectedRun(run)}
                    className="hover:bg-slate-800/40 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      {run.status === 'passed' ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          <CheckCircle2 className="w-3 h-3" />
                          Passed
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-rose-500/10 text-rose-400 border border-rose-500/20">
                          <XCircle className="w-3 h-3" />
                          Failed
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3 font-medium text-slate-200">
                      <div>{run.testCaseName}</div>
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">
                        {run.category}
                      </div>
                    </td>

                    <td className="px-4 py-3 whitespace-nowrap font-mono text-slate-300">
                      <span className="text-cyan-400 font-bold mr-1.5">{run.requestSent.method}</span>
                      <span className="text-slate-400">{run.requestSent.url.replace(project.baseUrl, '')}</span>
                    </td>

                    <td className="px-4 py-3 whitespace-nowrap font-mono font-semibold">
                      <span className={run.httpStatus >= 400 ? 'text-amber-400' : 'text-emerald-400'}>
                        {run.httpStatus} {run.responseReceived.statusText}
                      </span>
                    </td>

                    <td className="px-4 py-3 whitespace-nowrap font-mono text-slate-300">
                      {run.latencyMs}ms
                    </td>

                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`text-[11px] font-mono px-2 py-0.5 rounded ${
                          passedAssertions === totalAssertions
                            ? 'bg-emerald-500/10 text-emerald-300'
                            : 'bg-rose-500/10 text-rose-300'
                        }`}
                      >
                        {passedAssertions}/{totalAssertions} Passed
                      </span>
                    </td>

                    <td className="px-4 py-3 whitespace-nowrap text-right">
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          setSelectedRun(run);
                        }}
                        className="text-xs text-cyan-400 hover:text-cyan-300 font-medium inline-flex items-center gap-1"
                      >
                        <span>Inspect</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Deep HTTP Inspector Modal / Drawer */}
      {selectedRun && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950">
              <div className="flex items-center gap-3">
                <span
                  className={`text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${
                    selectedRun.status === 'passed'
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                  }`}
                >
                  {selectedRun.status}
                </span>
                <div>
                  <h3 className="text-sm font-bold text-slate-100">{selectedRun.testCaseName}</h3>
                  <div className="text-xs font-mono text-slate-400 flex items-center gap-2 mt-0.5">
                    <span className="text-cyan-400 font-bold">{selectedRun.requestSent.method}</span>
                    <span>{selectedRun.requestSent.url}</span>
                    <span>•</span>
                    <span>HTTP {selectedRun.httpStatus}</span>
                    <span>•</span>
                    <span>{selectedRun.latencyMs}ms</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => copyToClipboard(generateCurl(selectedRun))}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono transition-colors"
                  title="Copy as cURL"
                >
                  {copiedCurl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedCurl ? 'Copied cURL' : 'cURL'}</span>
                </button>

                <button
                  onClick={() => setSelectedRun(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-5 flex-1 text-xs">
              {/* AI Failure Diagnosis Box if failed */}
              {selectedRun.status === 'failed' && selectedRun.aiDiagnosis && (
                <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 space-y-2.5">
                  <div className="flex items-center gap-2 text-rose-400 font-bold uppercase tracking-wider text-xs">
                    <Sparkles className="w-4 h-4" />
                    <span>AI Failure Root Cause & Fix Recommendation</span>
                  </div>

                  <div className="text-slate-200 text-xs font-medium">
                    {selectedRun.aiDiagnosis.rootCause}
                  </div>

                  <div className="text-slate-300 text-[11px] leading-relaxed">
                    <strong>{project.stack.toUpperCase()} Context:</strong> {selectedRun.aiDiagnosis.backendContext}
                  </div>

                  <div className="text-emerald-300 text-[11px] leading-relaxed pt-1">
                    <strong>Suggested Fix:</strong> {selectedRun.aiDiagnosis.suggestedFix}
                  </div>

                  {selectedRun.aiDiagnosis.sampleCodeFix && (
                    <pre className="p-2.5 rounded-lg bg-slate-950 font-mono text-[11px] text-emerald-400 overflow-x-auto border border-slate-800">
                      {selectedRun.aiDiagnosis.sampleCodeFix}
                    </pre>
                  )}
                </div>
              )}

              {/* Assertions Evaluation Breakdown */}
              <div className="space-y-2">
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Assertion Evaluation Breakdown
                </div>
                <div className="space-y-1.5">
                  {selectedRun.assertionResults.map((a, idx) => (
                    <div
                      key={idx}
                      className={`p-2.5 rounded-lg border flex items-center justify-between text-xs ${
                        a.passed
                          ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-300'
                          : 'bg-rose-500/5 border-rose-500/20 text-rose-300'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {a.passed ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                        )}
                        <span className="font-medium">{a.name}</span>
                        <span className="text-slate-400">— {a.message}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Request & Response Side-by-Side */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Request Inspector */}
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    Sent Request
                  </div>
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase font-semibold">Headers</span>
                      <pre className="text-[10px] font-mono text-slate-400 mt-1 max-h-24 overflow-y-auto">
                        {JSON.stringify(selectedRun.requestSent.headers, null, 2)}
                      </pre>
                    </div>

                    <div>
                      <span className="text-[10px] text-slate-500 uppercase font-semibold">Body Payload</span>
                      <pre className="text-[11px] font-mono text-slate-200 mt-1 max-h-48 overflow-y-auto p-2 bg-slate-900 rounded border border-slate-800">
                        {selectedRun.requestSent.body
                          ? JSON.stringify(selectedRun.requestSent.body, null, 2)
                          : '// No body sent'}
                      </pre>
                    </div>
                  </div>
                </div>

                {/* Response Inspector */}
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    Received Response ({selectedRun.latencyMs}ms)
                  </div>
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase font-semibold">Headers</span>
                      <pre className="text-[10px] font-mono text-slate-400 mt-1 max-h-24 overflow-y-auto">
                        {JSON.stringify(selectedRun.responseReceived.headers, null, 2)}
                      </pre>
                    </div>

                    <div>
                      <span className="text-[10px] text-slate-500 uppercase font-semibold">Body JSON</span>
                      <pre className="text-[11px] font-mono text-emerald-300 mt-1 max-h-48 overflow-y-auto p-2 bg-slate-900 rounded border border-slate-800">
                        {JSON.stringify(selectedRun.responseReceived.body, null, 2)}
                      </pre>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-3 border-t border-slate-800 bg-slate-950 text-right">
              <button
                onClick={() => setSelectedRun(null)}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
