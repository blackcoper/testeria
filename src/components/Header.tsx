import React, { useState } from 'react';
import { Project } from '../types';
import {
  Layers,
  Play,
  Plus,
  Server,
  Sparkles,
  ChevronDown,
  Settings,
  Zap,
  CheckCircle2
} from 'lucide-react';

interface HeaderProps {
  projects: Project[];
  currentProject: Project | null;
  onSelectProject: (projectId: string) => void;
  onOpenNewProjectModal: () => void;
  onOpenSettingsModal: () => void;
  onRunAllTests: () => void;
  isRunningTests: boolean;
  activeTab: 'test_cases' | 'ai_generate' | 'ai_explorer' | 'report' | 'settings';
  setActiveTab: (tab: 'test_cases' | 'ai_generate' | 'ai_explorer' | 'report' | 'settings') => void;
}

export const Header: React.FC<HeaderProps> = ({
  projects,
  currentProject,
  onSelectProject,
  onOpenNewProjectModal,
  onOpenSettingsModal,
  onRunAllTests,
  isRunningTests,
  activeTab,
  setActiveTab
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const getStackBadgeColor = (stack: string) => {
    switch (stack) {
      case 'nestjs':
        return 'bg-red-500/10 text-red-400 border-red-500/30';
      case 'nextjs':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
      case 'php':
        return 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30';
      case 'vue':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/30';
    }
  };

  return (
    <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          
          {/* App Brand & Project Switcher */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
                <Layers className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-100 tracking-tight text-lg">Testeria</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                    AI Backend QA
                  </span>
                </div>
                <p className="text-xs text-slate-400">Automated Testing & Autonomous Exploration</p>
              </div>
            </div>

            {/* Project Selector Dropdown */}
            <div className="relative">
              <button
                id="project-selector-btn"
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-800 border border-slate-700 text-sm font-medium text-slate-200 transition-colors"
              >
                <Server className="w-4 h-4 text-cyan-400" />
                <span className="max-w-[200px] truncate">
                  {currentProject ? currentProject.name : 'Select Project'}
                </span>
                {currentProject && (
                  <span className={`text-[10px] font-mono uppercase px-1.5 py-0.2 rounded border ${getStackBadgeColor(currentProject.stack)}`}>
                    {currentProject.stack}
                  </span>
                )}
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {dropdownOpen && (
                <div className="absolute left-0 mt-2 w-72 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl p-1.5 z-50">
                  <div className="text-[11px] font-semibold text-slate-400 px-2.5 py-1 uppercase tracking-wider">
                    Your Projects
                  </div>
                  <div className="space-y-1 my-1 max-h-60 overflow-y-auto">
                    {projects.map((proj) => (
                      <button
                        key={proj.id}
                        onClick={() => {
                          onSelectProject(proj.id);
                          setDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-left text-xs transition-colors ${
                          currentProject?.id === proj.id
                            ? 'bg-cyan-500/10 text-cyan-300 font-medium'
                            : 'text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        <div className="truncate pr-2">
                          <div className="truncate font-medium">{proj.name}</div>
                          <div className="text-[11px] text-slate-400 truncate">{proj.baseUrl}</div>
                        </div>
                        <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border shrink-0 ${getStackBadgeColor(proj.stack)}`}>
                          {proj.stack}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="border-t border-slate-800 pt-1 mt-1">
                    <button
                      onClick={() => {
                        onOpenNewProjectModal();
                        setDropdownOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-cyan-400 hover:bg-cyan-500/10 rounded-lg transition-colors font-medium"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add New Project
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Action: Run Test Suite & AI Indicator */}
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800/60 border border-slate-700/50 text-[11px] text-slate-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>Gemini 3.8 Flash Ready</span>
            </div>

            <button
              id="run-all-tests-btn"
              onClick={onRunAllTests}
              disabled={isRunningTests || !currentProject || currentProject.testCases.length === 0}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-medium text-xs shadow-md shadow-emerald-700/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isRunningTests ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <span>Running {currentProject?.testCases.length || 0} Tests...</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Run All Tests ({currentProject?.testCases.length || 0})</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center space-x-1 border-t border-slate-800/60 pt-1">
          <button
            onClick={() => setActiveTab('test_cases')}
            className={`px-3 py-2 text-xs font-medium rounded-t-lg transition-colors border-b-2 ${
              activeTab === 'test_cases'
                ? 'text-cyan-400 border-cyan-400 bg-cyan-500/5'
                : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/30'
            }`}
          >
            Test Cases ({currentProject?.testCases.length || 0})
          </button>

          <button
            onClick={() => setActiveTab('ai_generate')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg transition-colors border-b-2 ${
              activeTab === 'ai_generate'
                ? 'text-cyan-400 border-cyan-400 bg-cyan-500/5'
                : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/30'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            AI Generator & Import
          </button>

          <button
            onClick={() => setActiveTab('ai_explorer')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg transition-colors border-b-2 ${
              activeTab === 'ai_explorer'
                ? 'text-cyan-400 border-cyan-400 bg-cyan-500/5'
                : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/30'
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            Autonomous AI Explorer
          </button>

          <button
            onClick={() => setActiveTab('report')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg transition-colors border-b-2 ${
              activeTab === 'report'
                ? 'text-cyan-400 border-cyan-400 bg-cyan-500/5'
                : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/30'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            Execution Report
            {currentProject?.latestReport && (
              <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                currentProject.latestReport.passRate === 100
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-amber-500/20 text-amber-400'
              }`}>
                {currentProject.latestReport.passRate}%
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg transition-colors border-b-2 ${
              activeTab === 'settings'
                ? 'text-cyan-400 border-cyan-400 bg-cyan-500/5'
                : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/30'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            Project Settings
          </button>
        </div>

      </div>
    </header>
  );
};
