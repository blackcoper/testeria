import React, { useState, useEffect } from 'react';
import { Project, TestCase, Endpoint, TestRunExecution, TestSuiteReport, ExplorationSession } from './types';
import { FileExplorerSidebar } from './components/FileExplorerSidebar';
import { LiveTestRunnerIframe } from './components/LiveTestRunnerIframe';
import { TestCaseEditor } from './components/TestCaseEditor';
import { DualWorkspaceView } from './components/DualWorkspaceView';
import { AiGeneratorView } from './components/AiGeneratorView';
import { AiExplorerView } from './components/AiExplorerView';
import { ReportView } from './components/ReportView';
import { ProjectSettingsView } from './components/ProjectSettingsView';
import { VisualFlowEditor } from './components/VisualFlowEditor';
import { HistoryView } from './components/HistoryView';
import { ProjectModal } from './components/ProjectModal';
import { NewFolderModal } from './components/NewFolderModal';
import {
  Play,
  Sparkles,
  Compass,
  FileSpreadsheet,
  Settings,
  X,
  Code2,
  Layers,
  AlertCircle,
  FileCode2,
  FolderPlus,
  GitBranch,
  History
} from 'lucide-react';

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string>('');
  const [selectedTestCaseId, setSelectedTestCaseId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'runner' | 'editor' | 'flow' | 'ai-generator' | 'ai-explorer' | 'reports' | 'histories' | 'settings'>('editor');
  const [isDualWorkspaceMode, setIsDualWorkspaceMode] = useState<boolean>(false);

  // Modals
  const [isProjectModalOpen, setIsProjectModalOpen] = useState<boolean>(false);
  const [isFolderModalOpen, setIsFolderModalOpen] = useState<boolean>(false);
  const [folderParentPath, setFolderParentPath] = useState<string>('/');

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Target run scope
  const [targetFolderRun, setTargetFolderRun] = useState<string | null>(null);
  const [targetTestCaseRun, setTargetTestCaseRun] = useState<string | null>(null);

  // Fetch projects on load
  const fetchProjects = async (targetProjectId?: string) => {
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      if (data.projects && Array.isArray(data.projects)) {
        setProjects(data.projects);
        const proj = targetProjectId
          ? data.projects.find((p: Project) => p.id === targetProjectId)
          : data.projects[0];
        if (targetProjectId) {
          setCurrentProjectId(targetProjectId);
        } else if (!currentProjectId && data.projects.length > 0) {
          setCurrentProjectId(data.projects[0].id);
        }
        if (proj && proj.testCases && proj.testCases.length > 0 && !selectedTestCaseId) {
          setSelectedTestCaseId(proj.testCases[0].id);
        }
      }
    } catch (err: any) {
      console.error('Failed to load projects:', err);
      setErrorBanner('Failed to connect to backend runner server.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const currentProject = projects.find(p => p.id === currentProjectId) || (projects.length > 0 ? projects[0] : null);
  const selectedTestCase = currentProject?.testCases.find(t => t.id === selectedTestCaseId) || null;

  // Run suite
  const handleRunSuite = async (testCaseIds?: string[]): Promise<TestSuiteReport> => {
    if (!currentProject) throw new Error('No project selected');
    const res = await fetch(`/api/projects/${currentProject.id}/run-tests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testCaseIds })
    });

    const data = await res.json();
    if (!data.success || !data.report) {
      throw new Error(data.error || 'Failed to run test suite');
    }

    setProjects(prev =>
      prev.map(p => (p.id === currentProject.id ? { ...p, latestReport: data.report } : p))
    );

    return data.report;
  };

  // Run single test
  const handleRunSingleTest = async (testCaseId: string): Promise<TestRunExecution> => {
    if (!currentProject) throw new Error('No project selected');

    const res = await fetch(`/api/projects/${currentProject.id}/run-tests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testCaseIds: [testCaseId] })
    });

    const data = await res.json();
    if (!data.report || !data.report.runs || data.report.runs.length === 0) {
      throw new Error(data.error || 'Failed to run test');
    }

    const singleRun = data.report.runs[0];

    // Merge run into project latestReport
    if (currentProject.latestReport) {
      const existingRuns = currentProject.latestReport.runs.filter(r => r.testCaseId !== testCaseId);
      const updatedRuns = [...existingRuns, singleRun];
      const passed = updatedRuns.filter(r => r.status === 'passed').length;
      const updatedReport: TestSuiteReport = {
        ...currentProject.latestReport,
        runs: updatedRuns,
        passed,
        failed: updatedRuns.length - passed,
        passRate: Math.round((passed / updatedRuns.length) * 100)
      };

      setProjects(prev =>
        prev.map(p => (p.id === currentProject.id ? { ...p, latestReport: updatedReport } : p))
      );
    }

    return singleRun;
  };

  // Run test from sidebar
  const handleSidebarRunTest = (testCaseId: string) => {
    setTargetTestCaseRun(testCaseId);
    setTargetFolderRun(null);
    setActiveView('runner');
    handleRunSingleTest(testCaseId).catch(console.error);
  };

  // Run folder from sidebar
  const handleSidebarRunFolder = (folderPath: string, testCaseIds: string[]) => {
    setTargetFolderRun(folderPath);
    setTargetTestCaseRun(null);
    setActiveView('runner');
    handleRunSuite(testCaseIds).catch(console.error);
  };

  // Update test case (e.g. from editor)
  const handleUpdateTestCase = async (updated: TestCase) => {
    if (!currentProject) return;
    try {
      await fetch(`/api/projects/${currentProject.id}/test-cases/${updated.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });

      setProjects(prev =>
        prev.map(p =>
          p.id === currentProject.id
            ? {
                ...p,
                testCases: p.testCases.map(t => (t.id === updated.id ? updated : t))
              }
            : p
        )
      );
    } catch (err) {
      console.error('Failed to update test case:', err);
    }
  };

  // Delete test case
  const handleDeleteTestCase = async (testCaseId: string) => {
    if (!currentProject) return;
    try {
      await fetch(`/api/projects/${currentProject.id}/test-cases/${testCaseId}`, {
        method: 'DELETE'
      });
      setProjects(prev =>
        prev.map(p =>
          p.id === currentProject.id
            ? { ...p, testCases: p.testCases.filter(t => t.id !== testCaseId) }
            : p
        )
      );
      if (selectedTestCaseId === testCaseId) {
        setSelectedTestCaseId(null);
        setActiveView('runner');
      }
    } catch (err: any) {
      console.error('Failed to delete test case:', err);
    }
  };

  // Create new folder
  const handleCreateFolder = (folderPath: string) => {
    // Add a placeholder test case in this folder so it appears in the tree
    if (!currentProject) return;
    const placeholderTest: TestCase = {
      id: `tc_init_${Date.now()}`,
      endpointId: currentProject.endpoints[0]?.id || 'ep_auth_login',
      name: 'Sample Test Case',
      category: 'happy_path',
      folderPath,
      description: `Initial test case in ${folderPath}`,
      request: {
        method: 'GET',
        path: '/api/health',
        headers: { 'Content-Type': 'application/json' }
      },
      assertions: {
        expectedStatuses: [200],
        maxLatencyMs: 1000
      }
    };

    fetch(`/api/projects/${currentProject.id}/test-cases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(placeholderTest)
    }).then(() => {
      setProjects(prev =>
        prev.map(p =>
          p.id === currentProject.id
            ? { ...p, testCases: [...p.testCases, placeholderTest] }
            : p
        )
      );
      setSelectedTestCaseId(placeholderTest.id);
      setActiveView('editor');
    });
  };

  // Create new test case
  const handleCreateTestCase = (targetFolder?: string) => {
    if (!currentProject) return;
    const newTest: TestCase = {
      id: `tc_custom_${Date.now()}`,
      endpointId: currentProject.endpoints[0]?.id || 'ep_auth_login',
      name: 'New Custom Test Case',
      category: 'happy_path',
      folderPath: targetFolder || '/General Tests',
      description: 'Custom test case specification.',
      request: {
        method: 'GET',
        path: '/api/health',
        headers: { 'Content-Type': 'application/json' }
      },
      assertions: {
        expectedStatuses: [200],
        maxLatencyMs: 1000
      }
    };

    fetch(`/api/projects/${currentProject.id}/test-cases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newTest)
    }).then(() => {
      setProjects(prev =>
        prev.map(p =>
          p.id === currentProject.id
            ? { ...p, testCases: [...p.testCases, newTest] }
            : p
        )
      );
      setSelectedTestCaseId(newTest.id);
      setActiveView('editor');
    });
  };

  // Import endpoints from code / Swagger
  const handleImportEndpoints = async (rawContent: string): Promise<Endpoint[]> => {
    if (!currentProject) throw new Error('No project selected');
    const res = await fetch(`/api/projects/${currentProject.id}/import-endpoints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawContent })
    });
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || 'Failed to import endpoints');
    }

    setProjects(prev =>
      prev.map(p =>
        p.id === currentProject.id
          ? { ...p, endpoints: [...p.endpoints, ...data.endpoints] }
          : p
      )
    );

    return data.endpoints;
  };

  // Generate test cases with Gemini
  const handleGenerateTests = async (
    endpointIds: string[],
    instructions: string
  ): Promise<TestCase[]> => {
    if (!currentProject) throw new Error('No project selected');
    const res = await fetch(`/api/projects/${currentProject.id}/generate-tests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpointIds, instructions })
    });
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || 'Failed to generate test cases');
    }

    setProjects(prev =>
      prev.map(p =>
        p.id === currentProject.id
          ? { ...p, testCases: [...p.testCases, ...data.testCases] }
          : p
      )
    );

    return data.testCases;
  };

  // Autonomous AI Explorer
  const handleRunExploration = async (): Promise<ExplorationSession> => {
    if (!currentProject) throw new Error('No project selected');
    const res = await fetch(`/api/projects/${currentProject.id}/explore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || 'Exploration failed');
    }

    setProjects(prev =>
      prev.map(p =>
        p.id === currentProject.id
          ? { ...p, latestExploration: data.exploration }
          : p
      )
    );

    return data.exploration;
  };

  // Create new project
  const handleCreateProject = async (projectData: Partial<Project>) => {
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(projectData)
      });
      const data = await res.json();
      if (data.project) {
        setProjects(prev => [...prev, data.project]);
        setCurrentProjectId(data.project.id);
        setActiveView('runner');
      }
    } catch (err) {
      console.error('Failed to create project:', err);
    }
  };

  // Update project settings
  const handleUpdateProject = async (updates: Partial<Project>) => {
    if (!currentProject) return;
    try {
      const res = await fetch(`/api/projects/${currentProject.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      const data = await res.json();
      if (data.project) {
        setProjects(prev =>
          prev.map(p => (p.id === currentProject.id ? data.project : p))
        );
      }
    } catch (err) {
      console.error('Failed to update project:', err);
    }
  };

  // Delete project
  const handleDeleteProject = async (projectId: string) => {
    try {
      await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
      const remaining = projects.filter(p => p.id !== projectId);
      setProjects(remaining);
      if (remaining.length > 0) {
        setCurrentProjectId(remaining[0].id);
      } else {
        setCurrentProjectId('');
      }
      setActiveView('runner');
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-xs text-zinc-400 font-mono">Initializing Testeria Hub...</p>
        </div>
      </div>
    );
  }

  if (!currentProject) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-300 flex items-center justify-center p-6">
        <div className="text-center space-y-4 max-w-md">
          <h2 className="text-lg font-semibold text-zinc-100">No Projects Found</h2>
          <p className="text-xs text-zinc-400">
            Create your first test automation project or import a NestJS/REST API to begin.
          </p>
          <button
            onClick={() => setIsProjectModalOpen(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold"
          >
            Create New Project
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-zinc-950 text-zinc-100 flex flex-col overflow-hidden font-sans select-none">
      {/* Top Application Bar */}
      <header className="h-10 border-b border-zinc-800 bg-zinc-900/90 px-3 flex items-center justify-between shrink-0 text-xs">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2 font-bold text-zinc-100 tracking-wide text-xs">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            <span>TESTERIA</span>
            <span className="text-[10px] text-zinc-500 font-mono uppercase bg-zinc-800 px-1.5 py-0.2 rounded">
              QA IDE
            </span>
          </div>

          {/* Quick Breadcrumbs */}
          <div className="flex items-center text-zinc-500 space-x-1 font-mono text-[11px]">
            <span>/</span>
            <span className="text-zinc-300">{currentProject.name}</span>
            {selectedTestCase && (
              <>
                <span>/</span>
                <span className="text-blue-400 truncate max-w-[200px]">{selectedTestCase.name}</span>
              </>
            )}
          </div>
        </div>

        {/* Global actions */}
        <div className="flex items-center space-x-2">
          {errorBanner && (
            <div className="flex items-center gap-1.5 text-rose-400 text-[11px] bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
              <AlertCircle className="w-3 h-3" />
              <span>{errorBanner}</span>
              <button onClick={() => setErrorBanner(null)} className="ml-1 text-rose-400 hover:text-white">✕</button>
            </div>
          )}

          <button
            onClick={() => setIsDualWorkspaceMode(!isDualWorkspaceMode)}
            className={`px-2 py-1 rounded text-[11px] font-mono flex items-center gap-1 transition-colors ${
              isDualWorkspaceMode
                ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
            }`}
          >
            <Layers className="w-3 h-3" />
            <span>Dual View</span>
          </button>
        </div>
      </header>

      {/* Main Workspace Frame */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Code-Editor Style File Explorer Sidebar */}
        <FileExplorerSidebar
          projects={projects}
          activeProject={currentProject}
          onSelectProject={id => {
            setCurrentProjectId(id);
            setSelectedTestCaseId(null);
          }}
          onOpenNewProjectModal={() => setIsProjectModalOpen(true)}
          selectedTestCaseId={selectedTestCaseId}
          onSelectTestCase={id => {
            setSelectedTestCaseId(id);
            setActiveView('editor');
          }}
          onOpenLiveRunner={() => {
            setTargetTestCaseRun(null);
            setTargetFolderRun(null);
            setActiveView('runner');
          }}
          onOpenAiGenerator={() => setActiveView('ai-generator')}
          onOpenAiExplorer={() => setActiveView('ai-explorer')}
          onOpenReports={() => setActiveView('reports')}
          onOpenHistories={() => setActiveView('histories')}
          onOpenSettings={() => setActiveView('settings')}
          onRunTest={handleSidebarRunTest}
          onRunFolder={handleSidebarRunFolder}
          onRunEntireSuite={() => {
            setTargetTestCaseRun(null);
            setTargetFolderRun(null);
            setActiveView('runner');
            handleRunSuite().catch(console.error);
          }}
          onCreateFolder={(parentFolder) => {
            setFolderParentPath(parentFolder || '/');
            setIsFolderModalOpen(true);
          }}
          onCreateTestCase={handleCreateTestCase}
          isDualWorkspaceMode={isDualWorkspaceMode}
          onToggleDualWorkspace={() => setIsDualWorkspaceMode(!isDualWorkspaceMode)}
          activeView={activeView}
        />

        {/* Center / Main Content Tabs & Viewport */}
        <div className="flex-1 flex flex-col overflow-hidden bg-zinc-950">
          {/* Top Tabs Bar (Action & Context-specific tabs) */}
          <div className="h-9 border-b border-zinc-800 bg-zinc-900/60 flex items-center overflow-x-auto shrink-0 custom-scrollbar">
            {/* Active Test Case Editor Tab (Main workspace tab when a test case is selected) */}
            {selectedTestCase && (
              <div
                onClick={() => setActiveView('editor')}
                className={`h-full px-3 text-xs flex items-center gap-2 border-r border-zinc-800 cursor-pointer transition-colors ${
                  activeView === 'editor'
                    ? 'bg-zinc-950 text-blue-300 font-semibold border-t-2 border-t-blue-500'
                    : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200'
                }`}
              >
                <Code2 className="w-3 h-3 text-blue-400" />
                <span className="truncate max-w-[180px]">{selectedTestCase.name}</span>
                <button
                  title="Close Tab"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedTestCaseId(null);
                    if (activeView === 'editor') setActiveView('reports');
                  }}
                  className="p-0.5 hover:bg-zinc-800 rounded text-zinc-500 hover:text-zinc-200"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            )}

            {/* Visual Sequence Flow Tab */}
            {selectedTestCase && (
              <div
                onClick={() => setActiveView('flow')}
                className={`h-full px-3 text-xs flex items-center gap-2 border-r border-zinc-800 cursor-pointer transition-colors ${
                  activeView === 'flow'
                    ? 'bg-zinc-950 text-indigo-300 font-semibold border-t-2 border-t-indigo-500'
                    : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200'
                }`}
              >
                <GitBranch className="w-3 h-3 text-indigo-400" />
                <span>Visual Flow Diagram</span>
              </div>
            )}

            {/* Live Runner Tab (Contextual: Shows when active, or user can toggle to inspect runner iframe) */}
            {(activeView === 'runner' || targetTestCaseRun !== null || targetFolderRun !== null) && (
              <div
                onClick={() => setActiveView('runner')}
                className={`h-full px-3 text-xs flex items-center gap-1.5 border-r border-zinc-800 cursor-pointer transition-colors ${
                  activeView === 'runner'
                    ? 'bg-zinc-950 text-emerald-400 font-semibold border-t-2 border-t-emerald-500'
                    : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200'
                }`}
              >
                <Play className="w-3 h-3 fill-current text-emerald-400" />
                <span>Live Runner & iFrame</span>
                <button
                  title="Close Runner Tab"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveView(selectedTestCase ? 'editor' : 'reports');
                  }}
                  className="p-0.5 hover:bg-zinc-800 rounded text-zinc-500 hover:text-zinc-200"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            )}

            {/* Execution Histories Tab */}
            {activeView === 'histories' && (
              <div className="h-full px-3 text-xs flex items-center gap-2 border-r border-zinc-800 bg-zinc-950 text-amber-300 font-semibold border-t-2 border-t-amber-500">
                <History className="w-3 h-3 text-amber-400" />
                <span>Execution Histories</span>
                <button
                  title="Close Tab"
                  onClick={() => setActiveView(selectedTestCase ? 'editor' : 'reports')}
                  className="p-0.5 hover:bg-zinc-800 rounded text-zinc-500 hover:text-zinc-200"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            )}

            {/* Contextual Active General Tool Tab (only visible when opened via the sidebar) */}
            {activeView === 'ai-generator' && (
              <div className="h-full px-3 text-xs flex items-center gap-2 border-r border-zinc-800 bg-zinc-950 text-purple-300 font-semibold border-t-2 border-t-purple-500">
                <Sparkles className="w-3 h-3 text-purple-400" />
                <span>AI E2E Generator</span>
                <button
                  title="Close Tab"
                  onClick={() => setActiveView('runner')}
                  className="p-0.5 hover:bg-zinc-800 rounded text-zinc-500 hover:text-zinc-200"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            )}

            {activeView === 'ai-explorer' && (
              <div className="h-full px-3 text-xs flex items-center gap-2 border-r border-zinc-800 bg-zinc-950 text-cyan-300 font-semibold border-t-2 border-t-cyan-500">
                <Compass className="w-3 h-3 text-cyan-400" />
                <span>Autonomous AI Explorer</span>
                <button
                  title="Close Tab"
                  onClick={() => setActiveView('runner')}
                  className="p-0.5 hover:bg-zinc-800 rounded text-zinc-500 hover:text-zinc-200"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            )}

            {activeView === 'reports' && (
              <div className="h-full px-3 text-xs flex items-center gap-2 border-r border-zinc-800 bg-zinc-950 text-blue-300 font-semibold border-t-2 border-t-blue-500">
                <FileSpreadsheet className="w-3 h-3 text-blue-400" />
                <span>Reports & Artifacts</span>
                <button
                  title="Close Tab"
                  onClick={() => setActiveView('runner')}
                  className="p-0.5 hover:bg-zinc-800 rounded text-zinc-500 hover:text-zinc-200"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            )}

            {activeView === 'settings' && (
              <div className="h-full px-3 text-xs flex items-center gap-2 border-r border-zinc-800 bg-zinc-950 text-zinc-100 font-semibold border-t-2 border-t-zinc-400">
                <Settings className="w-3 h-3 text-zinc-400" />
                <span>Project Settings</span>
                <button
                  title="Close Tab"
                  onClick={() => setActiveView('runner')}
                  className="p-0.5 hover:bg-zinc-800 rounded text-zinc-500 hover:text-zinc-200"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            )}
          </div>

          {/* Center Stage Viewport */}
          <div className="flex-1 overflow-hidden relative">
            {isDualWorkspaceMode ? (
              <DualWorkspaceView
                projects={projects}
                activeProject={currentProject}
                onSelectTestCase={(projId, tcId) => {
                  setCurrentProjectId(projId);
                  setSelectedTestCaseId(tcId);
                  setActiveView('editor');
                  setIsDualWorkspaceMode(false);
                }}
                onRunTest={(projId, tcId) => handleRunSingleTest(tcId)}
                onRunSuite={async (projId) => {
                  setCurrentProjectId(projId);
                  return handleRunSuite();
                }}
                onCloseDualMode={() => setIsDualWorkspaceMode(false)}
              />
            ) : activeView === 'runner' ? (
              <LiveTestRunnerIframe
                project={currentProject}
                onRunSingleTest={handleRunSingleTest}
                onRunSuite={handleRunSuite}
                targetTestCaseId={targetTestCaseRun}
                targetFolder={targetFolderRun}
              />
            ) : activeView === 'editor' && selectedTestCase ? (
              <TestCaseEditor
                project={currentProject}
                testCase={selectedTestCase}
                onUpdateTestCase={handleUpdateTestCase}
                onDeleteTestCase={handleDeleteTestCase}
                onRunTest={handleRunSingleTest}
                onOpenLiveRunner={() => setActiveView('runner')}
                onOpenVisualFlow={() => setActiveView('flow')}
              />
            ) : activeView === 'flow' && selectedTestCase ? (
              <VisualFlowEditor
                project={currentProject}
                testCase={selectedTestCase}
                onUpdateTestCase={handleUpdateTestCase}
                onRunTest={handleRunSingleTest}
                onOpenLiveRunner={() => setActiveView('runner')}
                onSelectTestCase={(id) => {
                  setSelectedTestCaseId(id);
                  setActiveView('flow');
                }}
              />
            ) : activeView === 'histories' ? (
              <HistoryView
                project={currentProject}
                onRerunSuite={handleRunSuite}
                onOpenLiveRunner={() => setActiveView('runner')}
              />
            ) : activeView === 'ai-generator' ? (
              <div className="h-full overflow-y-auto p-6 custom-scrollbar">
                <AiGeneratorView
                  project={currentProject}
                  onImportEndpoints={handleImportEndpoints}
                  onGenerateTests={handleGenerateTests}
                  onNavigateToTestCases={() => setActiveView('runner')}
                />
              </div>
            ) : activeView === 'ai-explorer' ? (
              <div className="h-full overflow-y-auto p-6 custom-scrollbar">
                <AiExplorerView
                  project={currentProject}
                  onRunExploration={handleRunExploration}
                />
              </div>
            ) : activeView === 'reports' ? (
              <div className="h-full overflow-y-auto p-6 custom-scrollbar">
                <ReportView
                  project={currentProject}
                  report={currentProject.latestReport || null}
                  onRerunTests={async () => {
                    setActiveView('runner');
                    await handleRunSuite();
                  }}
                  isRunningTests={false}
                />
              </div>
            ) : activeView === 'settings' ? (
              <div className="h-full overflow-y-auto p-6 custom-scrollbar">
                <ProjectSettingsView
                  project={currentProject}
                  onUpdateProject={handleUpdateProject}
                  onDeleteProject={handleDeleteProject}
                />
              </div>
            ) : (
              <LiveTestRunnerIframe
                project={currentProject}
                onRunSingleTest={handleRunSingleTest}
                onRunSuite={handleRunSuite}
              />
            )}
          </div>
        </div>
      </div>

      {/* New Folder Modal */}
      <NewFolderModal
        isOpen={isFolderModalOpen}
        onClose={() => setIsFolderModalOpen(false)}
        onCreate={handleCreateFolder}
        defaultParent={folderParentPath}
      />

      {/* New Project Modal */}
      <ProjectModal
        isOpen={isProjectModalOpen}
        onClose={() => setIsProjectModalOpen(false)}
        onSave={handleCreateProject}
      />
    </div>
  );
}

export default App;
