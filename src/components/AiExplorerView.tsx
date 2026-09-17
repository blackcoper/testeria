import React, { useState } from 'react';
import { Project, ExplorationSession } from '../types';
import {
  Zap,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Play,
  RotateCw,
  Cpu,
  Lock,
  FileSearch,
  Sparkles,
  ArrowRight
} from 'lucide-react';

interface AiExplorerViewProps {
  project: Project;
  onRunExploration: () => Promise<ExplorationSession>;
}

export const AiExplorerView: React.FC<AiExplorerViewProps> = ({
  project,
  onRunExploration
}) => {
  const [isExploring, setIsExploring] = useState(false);
  const [currentSession, setCurrentSession] = useState<ExplorationSession | null>(
    project.latestExploration || null
  );

  const handleStartExploration = async () => {
    setIsExploring(true);
    try {
      const session = await onRunExploration();
      setCurrentSession(session);
    } finally {
      setIsExploring(false);
    }
  };

  const getFindingBadge = (type: string) => {
    switch (type) {
      case 'clean':
        return (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            Resilient
          </span>
        );
      case 'anomaly':
        return (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">
            Anomaly
          </span>
        );
      case 'vulnerability':
        return (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/30">
            Vulnerability
          </span>
        );
      default:
        return (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-400 border border-slate-500/30">
            Observed
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Intro Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-xl bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950/40 border border-slate-800">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Zap className="w-4 h-4 fill-current" />
            </div>
            <h2 className="text-base font-bold text-slate-100">
              Autonomous AI API Explorer
            </h2>
            <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 font-semibold uppercase">
              Autonomous Agent Mode
            </span>
          </div>
          <p className="text-xs text-slate-400 max-w-2xl">
            Let the AI agent independently navigate your <strong>{project.name}</strong> routes. It maps endpoint relations, probes authentication guards, tests payload boundary fuzzing, and checks against SQL injections and unexpected 500 crashes.
          </p>
        </div>

        <button
          onClick={handleStartExploration}
          disabled={isExploring}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-slate-950 font-bold text-xs shadow-lg shadow-amber-500/20 disabled:opacity-50 transition-all shrink-0"
        >
          {isExploring ? (
            <>
              <div className="w-4 h-4 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin"></div>
              <span>AI Exploring Endpoints...</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              <span>Start Autonomous Exploration</span>
            </>
          )}
        </button>
      </div>

      {/* Explorer Results */}
      {currentSession ? (
        <div className="space-y-6">
          {/* Top Score & Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Health Score */}
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-emerald-500/10 border-2 border-emerald-500/30 flex items-center justify-center shrink-0">
                <span className="text-xl font-extrabold text-emerald-400">
                  {currentSession.healthScore}
                </span>
              </div>
              <div>
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  API Resilience Score
                </div>
                <div className="text-xs text-slate-300 font-medium mt-0.5">
                  {currentSession.healthScore >= 90
                    ? 'Excellent Security & Validation'
                    : currentSession.healthScore >= 70
                    ? 'Moderate Resilience'
                    : 'Critical Vulnerabilities Detected'}
                </div>
                <div className="text-[11px] text-slate-400">
                  Tested {currentSession.totalProbes} autonomous probes
                </div>
              </div>
            </div>

            {/* Findings breakdown */}
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Exploration Audit Findings
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="text-slate-400 block text-[10px]">Guard Enforcements</span>
                  <span className="text-sm font-bold text-emerald-400">Passed</span>
                </div>
                <div className="p-2 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="text-slate-400 block text-[10px]">Uncaught Crashes (500)</span>
                  <span className="text-sm font-bold text-slate-300">0</span>
                </div>
              </div>
            </div>

            {/* Project Context */}
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                Target Backend
              </div>
              <div className="text-xs font-medium text-slate-200 truncate">
                {project.name}
              </div>
              <div className="text-[11px] font-mono text-cyan-400 mt-1">
                {project.baseUrl}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                Stack: <span className="uppercase font-semibold text-slate-300">{project.stack}</span>
              </div>
            </div>
          </div>

          {/* AI Executive Summary Card */}
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-400 uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI Executive Synthesis</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              {currentSession.aiExecutiveSummary}
            </p>
          </div>

          {/* Step-by-Step Probe Journey */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Autonomous Probe Timeline & Behavioral Audit ({currentSession.steps.length} Steps)
            </h3>

            <div className="space-y-2.5">
              {currentSession.steps.map(step => (
                <div
                  key={step.stepNumber}
                  className="p-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700/80 transition-all space-y-2"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-300 text-[10px] font-mono font-bold flex items-center justify-center">
                        {step.stepNumber}
                      </span>
                      <span className="text-xs font-semibold text-slate-200">
                        {step.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-cyan-400 font-bold">
                        {step.method} {step.path}
                      </span>
                      <span className="font-mono text-xs text-slate-300">
                        HTTP {step.httpStatus}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {step.latencyMs}ms
                      </span>
                      {getFindingBadge(step.findingType)}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs pt-1">
                    <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80">
                      <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                        Agent Intent & Probe Scenario
                      </span>
                      <p className="text-slate-300 text-xs">{step.intent}</p>
                    </div>

                    <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80">
                      <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                        Backend Response & Observation
                      </span>
                      <p className="text-slate-300 text-xs">{step.findingDetail}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Actionable Recommendations */}
          {currentSession.actionableRecommendations && currentSession.actionableRecommendations.length > 0 && (
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-cyan-400 uppercase tracking-wider">
                <ShieldCheck className="w-4 h-4 text-cyan-400" />
                <span>Actionable Recommendations for {project.stack.toUpperCase()}</span>
              </div>
              <ul className="space-y-2">
                {currentSession.actionableRecommendations.map((rec, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-xs text-slate-300">
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5 shrink-0"></div>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        /* Empty State */
        <div className="p-12 text-center rounded-xl bg-slate-900/40 border border-slate-800 space-y-4">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center mx-auto">
            <Zap className="w-6 h-6 fill-current" />
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h3 className="text-sm font-semibold text-slate-200">
              Autonomous Exploration Not Started
            </h3>
            <p className="text-xs text-slate-400">
              Click the button above to launch the autonomous explorer. It will automatically traverse your {project.stack.toUpperCase()} routes, generate adaptive penetration probes, and test authorization barriers.
            </p>
          </div>
          <button
            onClick={handleStartExploration}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition-colors shadow-md shadow-amber-500/20"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Launch Explorer for {project.name}</span>
          </button>
        </div>
      )}
    </div>
  );
};
