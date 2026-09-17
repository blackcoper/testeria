import React, { useState } from 'react';
import { Project, TestCase, TestStep, TestRunExecution } from '../types';
import {
  GitBranch,
  Play,
  Plus,
  Trash2,
  ChevronRight,
  ChevronDown,
  Layers,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  Code2,
  Sparkles,
  Link as LinkIcon,
  HelpCircle,
  Database,
  Key,
  FileCheck
} from 'lucide-react';

interface VisualFlowEditorProps {
  project: Project;
  testCase: TestCase;
  onUpdateTestCase: (updated: TestCase) => void;
  onRunTest: (testCaseId: string) => Promise<TestRunExecution>;
  onOpenLiveRunner: () => void;
  onSelectTestCase: (id: string) => void;
}

export const VisualFlowEditor: React.FC<VisualFlowEditorProps> = ({
  project,
  testCase,
  onUpdateTestCase,
  onRunTest,
  onOpenLiveRunner,
  onSelectTestCase
}) => {
  const [selectedStepIndex, setSelectedStepIndex] = useState<number>(0);
  const [isRunning, setIsRunning] = useState(false);
  const [lastExecution, setLastExecution] = useState<TestRunExecution | null>(
    project.latestReport?.runs.find(r => r.testCaseId === testCase.id) || null
  );

  // Check if testCase belongs to an E2E folder or is chained
  const isE2EFolder = testCase.folderPath?.includes('E2E') || testCase.category === 'chained_flow';

  // Sibling steps in the same folder if applicable (like in Checkout to Invoice Flow)
  const pipelineSiblings = isE2EFolder && testCase.folderPath
    ? project.testCases
        .filter(t => t.folderPath === testCase.folderPath)
        .sort((a, b) => (a.stepNumber || 0) - (b.stepNumber || 0))
    : [];

  // Internal steps in this testCase (if user created composite steps)
  const steps: TestStep[] = testCase.steps && testCase.steps.length > 0
    ? testCase.steps
    : [
        {
          id: 'step_root_1',
          name: testCase.name,
          description: testCase.description,
          method: testCase.request.method,
          path: testCase.request.path,
          headers: testCase.request.headers,
          queryParams: testCase.request.queryParams,
          body: testCase.request.body,
          assertions: testCase.assertions,
          chainedContext: testCase.chainedContext
        }
      ];

  const activeStep = steps[selectedStepIndex] || steps[0];

  const handleRunFullSequence = async () => {
    setIsRunning(true);
    try {
      const res = await onRunTest(testCase.id);
      setLastExecution(res);
    } finally {
      setIsRunning(false);
    }
  };

  const handleAddStep = () => {
    const newStepId = `step_${Date.now()}`;
    const newStep: TestStep = {
      id: newStepId,
      name: `Step ${steps.length + 1}: Follow-up Action`,
      method: 'POST',
      path: '/api/endpoint',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer {{accessToken}}'
      },
      body: {
        referenceId: '{{id}}'
      },
      assertions: {
        expectedStatuses: [200, 201],
        maxLatencyMs: 1000
      }
    };

    const updatedSteps = [...steps, newStep];
    const updatedTestCase: TestCase = {
      ...testCase,
      steps: updatedSteps
    };
    onUpdateTestCase(updatedTestCase);
    setSelectedStepIndex(updatedSteps.length - 1);
  };

  const handleUpdateActiveStep = (updatedStep: Partial<TestStep>) => {
    const updatedSteps = steps.map((s, idx) =>
      idx === selectedStepIndex ? { ...s, ...updatedStep } : s
    );

    // Also sync the primary request if modifying the root step
    const updatedTestCase: TestCase = {
      ...testCase,
      steps: updatedSteps,
      ...(selectedStepIndex === 0 && {
        request: {
          ...testCase.request,
          method: updatedStep.method || testCase.request.method,
          path: updatedStep.path || testCase.request.path,
          headers: updatedStep.headers !== undefined ? updatedStep.headers : testCase.request.headers,
          body: updatedStep.body !== undefined ? updatedStep.body : testCase.request.body
        }
      })
    };
    onUpdateTestCase(updatedTestCase);
  };

  const handleDeleteStep = (indexToDelete: number) => {
    if (steps.length <= 1) return; // keep at least 1
    const updatedSteps = steps.filter((_, idx) => idx !== indexToDelete);
    onUpdateTestCase({ ...testCase, steps: updatedSteps });
    setSelectedStepIndex(Math.max(0, indexToDelete - 1));
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 text-zinc-200 overflow-hidden">
      {/* Top Banner: Sequence Context & Actions */}
      <div className="h-14 border-b border-zinc-800 bg-zinc-900/90 px-6 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <GitBranch className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-zinc-100 truncate">
                {testCase.name}
              </h2>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-800/40">
                Visual Flow & Dependency Graph
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 truncate">
              {testCase.folderPath || 'General Workflow'} • Defines chronological prerequisites and piped variable context
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={handleAddStep}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 rounded text-xs font-medium flex items-center gap-1.5 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Step to Flow</span>
          </button>

          <button
            onClick={handleRunFullSequence}
            disabled={isRunning}
            className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>{isRunning ? 'Running Flow...' : 'Execute Sequence'}</span>
          </button>

          <button
            onClick={onOpenLiveRunner}
            className="p-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded border border-zinc-700"
            title="Inspect Execution in Live Runner"
          >
            <ExternalLink className="w-4 h-4 text-zinc-400" />
          </button>
        </div>
      </div>

      {/* Visual Sequence Pipeline Bar (Horizontal Graph Diagram) */}
      <div className="border-b border-zinc-800 bg-zinc-900/40 p-4 shrink-0 overflow-x-auto custom-scrollbar">
        <div className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            <span>End-to-End Sequence Diagram & Piped Variables</span>
          </div>
          <span className="text-[10px] text-zinc-500 font-mono">
            {pipelineSiblings.length > 0 ? `${pipelineSiblings.length} Pipeline Test Cases` : `${steps.length} Sequence Steps`}
          </span>
        </div>

        {/* If this test case is part of an E2E pipeline folder (e.g. Checkout to Invoice), show the cross-test case sequence node diagram */}
        {pipelineSiblings.length > 1 ? (
          <div className="flex items-center space-x-2 py-2">
            {pipelineSiblings.map((sibling, sIdx) => {
              const isCurrent = sibling.id === testCase.id;
              const hasRun = project.latestReport?.runs.find(r => r.testCaseId === sibling.id);

              return (
                <React.Fragment key={sibling.id}>
                  <div
                    onClick={() => onSelectTestCase(sibling.id)}
                    className={`group relative flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer min-w-[240px] max-w-[280px] ${
                      isCurrent
                        ? 'bg-indigo-950/40 border-indigo-500/80 shadow-md ring-1 ring-indigo-500/30'
                        : 'bg-zinc-900/80 border-zinc-800 hover:border-zinc-700 text-zinc-300'
                    }`}
                  >
                    <div className="flex flex-col items-center justify-center">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold font-mono ${
                        isCurrent ? 'bg-indigo-500 text-white' : 'bg-zinc-800 text-zinc-400'
                      }`}>
                        {sibling.stepNumber || sIdx + 1}
                      </div>
                      {hasRun && (
                        <div className="mt-1">
                          {hasRun.status === 'passed' ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <XCircle className="w-3.5 h-3.5 text-rose-400" />
                          )}
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`px-1.5 py-0.2 rounded font-mono text-[9px] font-bold ${
                          sibling.request.method === 'GET' ? 'bg-blue-500/20 text-blue-400' :
                          sibling.request.method === 'POST' ? 'bg-emerald-500/20 text-emerald-400' :
                          'bg-amber-500/20 text-amber-400'
                        }`}>
                          {sibling.request.method}
                        </span>
                        <span className="text-xs font-semibold text-zinc-100 truncate">
                          {sibling.name.replace(/^\d+\.\s*/, '')}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-zinc-400 truncate mt-0.5">
                        {sibling.request.path}
                      </div>
                      {sibling.chainedContext?.extractResponseKey && (
                        <div className="text-[10px] text-indigo-400 font-mono mt-1 flex items-center gap-1">
                          <span>↳ extracts:</span>
                          <span className="bg-indigo-950 text-indigo-300 px-1 rounded">
                            {sibling.chainedContext.extractResponseKey}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {sIdx < pipelineSiblings.length - 1 && (
                    <div className="flex flex-col items-center justify-center px-1 text-zinc-500">
                      <ArrowRight className="w-4 h-4 text-indigo-400/80" />
                      <span className="text-[9px] font-mono text-zinc-500">pipe</span>
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        ) : (
          /* Multi-step list within single test case */
          <div className="flex items-center space-x-2 py-2">
            {steps.map((step, sIdx) => {
              const isSelected = sIdx === selectedStepIndex;
              return (
                <React.Fragment key={step.id}>
                  <div
                    onClick={() => setSelectedStepIndex(sIdx)}
                    className={`flex items-center gap-2.5 p-2.5 rounded-xl border transition-all cursor-pointer min-w-[200px] ${
                      isSelected
                        ? 'bg-indigo-950/50 border-indigo-500 shadow-md ring-1 ring-indigo-500/40'
                        : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700 text-zinc-400'
                    }`}
                  >
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold font-mono ${
                      isSelected ? 'bg-indigo-500 text-white' : 'bg-zinc-800 text-zinc-400'
                    }`}>
                      {sIdx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`px-1 py-0.2 rounded font-mono text-[9px] font-bold ${
                          step.method === 'GET' ? 'bg-blue-500/20 text-blue-400' :
                          step.method === 'POST' ? 'bg-emerald-500/20 text-emerald-400' :
                          'bg-amber-500/20 text-amber-400'
                        }`}>
                          {step.method}
                        </span>
                        <span className="text-xs font-semibold text-zinc-200 truncate">
                          {step.name}
                        </span>
                      </div>
                      <div className="text-[10px] font-mono text-zinc-400 truncate mt-0.5">
                        {step.path}
                      </div>
                    </div>
                  </div>

                  {sIdx < steps.length - 1 && (
                    <ArrowRight className="w-4 h-4 text-zinc-600 shrink-0" />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>

      {/* Main Configuration Grid: Edit Current Action & Inspect Chained Context */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar max-w-5xl mx-auto w-full">
        {/* Real-World Workflow Explanation */}
        <div className="p-4 rounded-lg bg-indigo-950/20 border border-indigo-900/40 text-xs space-y-2">
          <div className="flex items-center gap-1.5 text-indigo-300 font-semibold">
            <Sparkles className="w-4 h-4" />
            <span>Why E2E Sequences Matter (Real-World Test Scenario)</span>
          </div>
          <p className="text-zinc-300 leading-relaxed">
            In production systems, you cannot simply test <code className="bg-zinc-800 px-1.5 py-0.5 rounded font-mono text-zinc-200">POST /api/invoices</code> in isolation because an invoice requires an authenticated user token (<code className="text-emerald-400">accessToken</code>) and an existing, registered order (<code className="text-blue-400">orderId</code>).
            This visual sequence pipes these prerequisites automatically in order:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
            <div className="p-2.5 rounded bg-zinc-900/80 border border-zinc-800 text-[11px]">
              <div className="font-semibold text-emerald-400 flex items-center gap-1">
                <Key className="w-3 h-3" /> 1. Auth & Login
              </div>
              <p className="text-zinc-400 mt-1">Acquires bearer JWT token, extracts <code className="text-zinc-200">accessToken</code>.</p>
            </div>
            <div className="p-2.5 rounded bg-zinc-900/80 border border-zinc-800 text-[11px]">
              <div className="font-semibold text-blue-400 flex items-center gap-1">
                <Database className="w-3 h-3" /> 2. Place Order
              </div>
              <p className="text-zinc-400 mt-1">Passes token in Authorization header, creates cart, extracts <code className="text-zinc-200">orderId</code>.</p>
            </div>
            <div className="p-2.5 rounded bg-zinc-900/80 border border-zinc-800 text-[11px]">
              <div className="font-semibold text-indigo-400 flex items-center gap-1">
                <FileCheck className="w-3 h-3" /> 3. Generate Invoice
              </div>
              <p className="text-zinc-400 mt-1">Injects <code className="text-zinc-200">{`{{orderId}}`}</code> into body to issue and verify the invoice.</p>
            </div>
          </div>
        </div>

        {/* Selected Step Action Details */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
            <div>
              <span className="text-[10px] font-mono text-indigo-400 uppercase tracking-wider block">
                Configuring Step #{selectedStepIndex + 1}
              </span>
              <input
                type="text"
                value={activeStep.name}
                onChange={e => handleUpdateActiveStep({ name: e.target.value })}
                className="bg-transparent text-sm font-semibold text-zinc-100 hover:bg-zinc-800/50 px-1 py-0.5 rounded focus:bg-zinc-800 focus:outline-none w-96 truncate"
              />
            </div>

            {steps.length > 1 && (
              <button
                onClick={() => handleDeleteStep(selectedStepIndex)}
                className="px-2.5 py-1 text-xs text-rose-400 hover:bg-rose-500/10 rounded flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Remove Step</span>
              </button>
            )}
          </div>

          {/* Endpoint contract for this step */}
          <div className="space-y-3">
            <div className="flex gap-2">
              <select
                value={activeStep.method}
                onChange={e => handleUpdateActiveStep({ method: e.target.value as any })}
                className="bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-xs font-mono font-bold focus:outline-none text-indigo-400"
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
                <option value="DELETE">DELETE</option>
              </select>

              <input
                type="text"
                value={activeStep.path}
                onChange={e => handleUpdateActiveStep({ path: e.target.value })}
                placeholder="/api/invoices"
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-xs font-mono text-zinc-200 focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Headers Configuration */}
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">
                Step Headers (JSON format with dynamic variable injection)
              </label>
              <textarea
                rows={2}
                value={activeStep.headers ? JSON.stringify(activeStep.headers, null, 2) : ''}
                onChange={e => {
                  try {
                    const parsed = e.target.value.trim() ? JSON.parse(e.target.value) : undefined;
                    handleUpdateActiveStep({ headers: parsed });
                  } catch {}
                }}
                className="w-full bg-zinc-950 border border-zinc-800 rounded p-2 text-xs font-mono text-zinc-200 focus:outline-none"
                placeholder='{"Authorization": "Bearer {{accessToken}}"}'
              />
            </div>

            {/* Request Payload */}
            {['POST', 'PUT', 'PATCH'].includes(activeStep.method) && (
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">
                  Request Payload (Supports dynamic template <code className="text-indigo-400">{`{{orderId}}`}</code>)
                </label>
                <textarea
                  rows={4}
                  value={activeStep.body ? JSON.stringify(activeStep.body, null, 2) : ''}
                  onChange={e => {
                    try {
                      const parsed = e.target.value.trim() ? JSON.parse(e.target.value) : undefined;
                      handleUpdateActiveStep({ body: parsed });
                    } catch {}
                  }}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded p-2 text-xs font-mono text-zinc-200 focus:outline-none"
                  placeholder='{"orderId": "{{orderId}}", "amount": 1299.00}'
                />
              </div>
            )}
          </div>
        </div>

        {/* Assertions & Variable Extraction for this Step */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4">
          <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            Assertions & Variable Piping to Downstream Steps
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-zinc-400 mb-1">Expected HTTP Statuses (e.g. 200, 201):</label>
              <input
                type="text"
                value={activeStep.assertions.expectedStatuses.join(', ')}
                onChange={e => {
                  const statuses = e.target.value
                    .split(',')
                    .map(s => parseInt(s.trim(), 10))
                    .filter(n => !isNaN(n));
                  handleUpdateActiveStep({
                    assertions: {
                      ...activeStep.assertions,
                      expectedStatuses: statuses
                    }
                  });
                }}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-xs font-mono text-zinc-200 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-zinc-400 mb-1">Variable Key to Extract for Next Steps:</label>
              <input
                type="text"
                value={activeStep.chainedContext?.extractResponseKey || ''}
                onChange={e => handleUpdateActiveStep({
                  chainedContext: {
                    ...activeStep.chainedContext,
                    extractResponseKey: e.target.value
                  }
                })}
                placeholder="e.g. invoiceId, orderId, accessToken"
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-xs font-mono text-zinc-200 focus:outline-none"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
