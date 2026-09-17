import React, { useState, useMemo } from 'react';
import { Project, TestCase, TestCaseCategory } from '../types';
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  FileCode2,
  Plus,
  Play,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  Sparkles,
  Compass,
  FileSpreadsheet,
  Settings,
  Layers,
  FolderPlus,
  Link,
  History,
  ChevronDown as DropdownIcon
} from 'lucide-react';

interface FileExplorerSidebarProps {
  projects: Project[];
  activeProject: Project;
  onSelectProject: (projectId: string) => void;
  onOpenNewProjectModal: () => void;
  selectedTestCaseId: string | null;
  onSelectTestCase: (testCaseId: string) => void;
  onOpenLiveRunner: () => void;
  onOpenAiGenerator: () => void;
  onOpenAiExplorer: () => void;
  onOpenReports: () => void;
  onOpenHistories: () => void;
  onOpenSettings: () => void;
  onRunTest: (testCaseId: string) => void;
  onRunFolder: (folderPath: string, testCaseIds: string[]) => void;
  onRunEntireSuite: () => void;
  onCreateFolder: (parentFolder?: string) => void;
  onCreateTestCase: (targetFolder?: string) => void;
  isDualWorkspaceMode: boolean;
  onToggleDualWorkspace: () => void;
  activeView: string;
}

interface TreeNode {
  name: string;
  fullPath: string;
  isFolder: boolean;
  children: TreeNode[];
  testCases: TestCase[];
}

export const FileExplorerSidebar: React.FC<FileExplorerSidebarProps> = ({
  projects,
  activeProject,
  onSelectProject,
  onOpenNewProjectModal,
  selectedTestCaseId,
  onSelectTestCase,
  onOpenLiveRunner,
  onOpenAiGenerator,
  onOpenAiExplorer,
  onOpenReports,
  onOpenHistories,
  onOpenSettings,
  onRunTest,
  onRunFolder,
  onRunEntireSuite,
  onCreateFolder,
  onCreateTestCase,
  isDualWorkspaceMode,
  onToggleDualWorkspace,
  activeView
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [hoveredFolder, setHoveredFolder] = useState<string | null>(null);

  // Build recursive tree from testCases folderPath
  const folderTree = useMemo(() => {
    const root: TreeNode = {
      name: 'root',
      fullPath: '/',
      isFolder: true,
      children: [],
      testCases: []
    };

    const tests = activeProject.testCases.filter(tc => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        tc.name.toLowerCase().includes(q) ||
        tc.request.path.toLowerCase().includes(q) ||
        (tc.folderPath && tc.folderPath.toLowerCase().includes(q))
      );
    });

    for (const tc of tests) {
      const path = (tc.folderPath || '/General Tests').replace(/^\/+|\/+$/g, '');
      const segments = path ? path.split('/') : ['General Tests'];

      let current = root;
      let currentPath = '';

      for (const segment of segments) {
        currentPath += '/' + segment;
        let child = current.children.find(c => c.name === segment);
        if (!child) {
          child = {
            name: segment,
            fullPath: currentPath,
            isFolder: true,
            children: [],
            testCases: []
          };
          current.children.push(child);
        }
        current = child;
      }
      current.testCases.push(tc);
    }

    // Sort folders & test cases
    const sortTree = (node: TreeNode) => {
      node.children.sort((a, b) => a.name.localeCompare(b.name));
      node.testCases.sort((a, b) => {
        if (a.stepNumber && b.stepNumber) return a.stepNumber - b.stepNumber;
        if (a.stepNumber) return -1;
        if (b.stepNumber) return 1;
        return a.name.localeCompare(b.name);
      });
      node.children.forEach(sortTree);
    };

    sortTree(root);
    return root;
  }, [activeProject.testCases, searchQuery]);

  const toggleFolder = (fullPath: string) => {
    setCollapsedFolders(prev => ({
      ...prev,
      [fullPath]: !prev[fullPath]
    }));
  };

  const getStatusIcon = (tc: TestCase) => {
    const latestRun = activeProject.latestReport?.runs.find(r => r.testCaseId === tc.id);
    if (!latestRun) {
      return <div className="w-2 h-2 rounded-full bg-zinc-600 mr-2" />;
    }
    if (latestRun.status === 'passed') {
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mr-1.5 shrink-0" />;
    }
    return <XCircle className="w-3.5 h-3.5 text-rose-400 mr-1.5 shrink-0" />;
  };

  const getMethodBadge = (method: string) => {
    switch (method.toUpperCase()) {
      case 'GET':
        return <span className="text-[9px] font-mono font-bold text-blue-400 bg-blue-500/10 px-1 py-0.5 rounded mr-1.5">GET</span>;
      case 'POST':
        return <span className="text-[9px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-1 py-0.5 rounded mr-1.5">POST</span>;
      case 'PUT':
      case 'PATCH':
        return <span className="text-[9px] font-mono font-bold text-amber-400 bg-amber-500/10 px-1 py-0.5 rounded mr-1.5">PUT</span>;
      case 'DELETE':
        return <span className="text-[9px] font-mono font-bold text-rose-400 bg-rose-500/10 px-1 py-0.5 rounded mr-1.5">DEL</span>;
      default:
        return <span className="text-[9px] font-mono font-bold text-zinc-400 bg-zinc-800 px-1 py-0.5 rounded mr-1.5">{method}</span>;
    }
  };

  // Recursively collect all test IDs inside a folder and its subfolders
  const getAllTestIdsInNode = (node: TreeNode): string[] => {
    let ids = node.testCases.map(t => t.id);
    for (const child of node.children) {
      ids = [...ids, ...getAllTestIdsInNode(child)];
    }
    return ids;
  };

  const renderTreeNode = (node: TreeNode, depth: number = 0) => {
    const isCollapsed = collapsedFolders[node.fullPath];
    const totalTestsInFolder = getAllTestIdsInNode(node).length;

    return (
      <div key={node.fullPath} className="select-none">
        {/* Folder Header */}
        <div
          className={`group flex items-center justify-between px-2 py-1.5 text-xs rounded-md cursor-pointer transition-colors ${
            hoveredFolder === node.fullPath ? 'bg-zinc-800/80 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
          }`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => toggleFolder(node.fullPath)}
          onMouseEnter={() => setHoveredFolder(node.fullPath)}
          onMouseLeave={() => setHoveredFolder(null)}
        >
          <div className="flex items-center space-x-1.5 min-w-0 truncate">
            {isCollapsed ? (
              <ChevronRight className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
            )}
            {isCollapsed ? (
              <Folder className="w-3.5 h-3.5 shrink-0 text-amber-400/90" />
            ) : (
              <FolderOpen className="w-3.5 h-3.5 shrink-0 text-amber-400" />
            )}
            <span className="truncate font-medium text-[12px]">{node.name}</span>
            <span className="text-[10px] text-zinc-500 bg-zinc-800/90 px-1.5 py-0.2 rounded-full ml-1">
              {totalTestsInFolder}
            </span>
          </div>

          {/* Folder Action Buttons */}
          <div
            className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={e => e.stopPropagation()}
          >
            <button
              title="Run All Tests in Folder"
              onClick={() => onRunFolder(node.fullPath, getAllTestIdsInNode(node))}
              className="p-1 hover:bg-emerald-500/20 hover:text-emerald-400 rounded text-zinc-400"
            >
              <Play className="w-3 h-3" />
            </button>
            <button
              title="Add Test Case to this Folder"
              onClick={() => onCreateTestCase(node.fullPath)}
              className="p-1 hover:bg-zinc-700 hover:text-zinc-200 rounded text-zinc-400"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Children & Test Cases inside this folder */}
        {!isCollapsed && (
          <div>
            {node.children.map(child => renderTreeNode(child, depth + 1))}

            {node.testCases.map(tc => {
              const isSelected = selectedTestCaseId === tc.id && activeView === 'editor';
              return (
                <div
                  key={tc.id}
                  onClick={() => onSelectTestCase(tc.id)}
                  style={{ paddingLeft: `${(depth + 1) * 12 + 12}px` }}
                  className={`group flex items-center justify-between pr-2 py-1 text-xs rounded cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-blue-600/20 text-blue-300 font-medium border-l-2 border-blue-500'
                      : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                  }`}
                >
                  <div className="flex items-center min-w-0 truncate mr-2">
                    {getStatusIcon(tc)}
                    {getMethodBadge(tc.request.method)}
                    <span className="truncate text-[11.5px]">{tc.name}</span>
                    {tc.dependsOn && tc.dependsOn.length > 0 && (
                      <span title={`Depends on ${tc.dependsOn.length} prerequisite test(s)`} className="ml-1 text-zinc-500">
                        <Link className="w-2.5 h-2.5 inline" />
                      </span>
                    )}
                  </div>

                  <button
                    title="Run Single Test"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRunTest(tc.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-emerald-500/20 hover:text-emerald-400 rounded text-zinc-400 shrink-0"
                  >
                    <Play className="w-2.5 h-2.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="w-72 bg-zinc-900 border-r border-zinc-800 flex flex-col h-full select-none text-zinc-300">
      {/* Workspace / Project Switcher Header */}
      <div className="p-2.5 border-b border-zinc-800 relative">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-zinc-400 font-semibold px-1 mb-1">
          <span>Workspace</span>
          <button
            onClick={onToggleDualWorkspace}
            title={isDualWorkspaceMode ? 'Switch to Single Workspace' : 'Open Dual Workspace Mode'}
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center gap-1 transition-colors ${
              isDualWorkspaceMode ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
            }`}
          >
            <Layers className="w-2.5 h-2.5" />
            {isDualWorkspaceMode ? 'Dual 2-Pane' : 'Dual View'}
          </button>
        </div>

        <button
          onClick={() => setIsProjectDropdownOpen(!isProjectDropdownOpen)}
          className="w-full flex items-center justify-between px-2.5 py-1.5 bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700/60 rounded text-left transition-colors"
        >
          <div className="min-w-0 pr-2">
            <div className="font-semibold text-xs text-zinc-100 truncate">{activeProject.name}</div>
            <div className="text-[10px] text-zinc-400 font-mono flex items-center gap-1 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
              {activeProject.stack.toUpperCase()} • {activeProject.testCases.length} Tests
            </div>
          </div>
          <DropdownIcon className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${isProjectDropdownOpen ? 'rotate-180' : ''}`} />
        </button>

        {/* Project Dropdown Menu */}
        {isProjectDropdownOpen && (
          <div className="absolute top-full left-2.5 right-2.5 mt-1 bg-zinc-800 border border-zinc-700 rounded-md shadow-2xl z-50 overflow-hidden py-1">
            <div className="px-2 py-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
              Switch Project
            </div>
            {projects.map(p => (
              <button
                key={p.id}
                onClick={() => {
                  onSelectProject(p.id);
                  setIsProjectDropdownOpen(false);
                }}
                className={`w-full text-left px-2.5 py-2 text-xs flex items-center justify-between hover:bg-zinc-700/70 transition-colors ${
                  p.id === activeProject.id ? 'bg-blue-600/20 text-blue-300 font-medium' : 'text-zinc-200'
                }`}
              >
                <div className="truncate pr-2">
                  <div className="truncate">{p.name}</div>
                  <div className="text-[10px] text-zinc-400">{p.stack.toUpperCase()} • {p.testCases.length} tests</div>
                </div>
                {p.id === activeProject.id && (
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                )}
              </button>
            ))}
            <div className="border-t border-zinc-700/80 mt-1 pt-1">
              <button
                onClick={() => {
                  setIsProjectDropdownOpen(false);
                  onOpenNewProjectModal();
                }}
                className="w-full text-left px-2.5 py-1.5 text-xs text-blue-400 hover:bg-blue-500/10 flex items-center gap-1.5 transition-colors font-medium"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create New Project...</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Explorer Toolbar: Search, New Folder, New Test, Run Suite */}
      <div className="p-2 border-b border-zinc-800/80 space-y-1.5">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-zinc-500" />
          <input
            type="text"
            placeholder="Filter test cases & folders..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-7 pr-2 py-1 bg-zinc-950/70 border border-zinc-800 rounded text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex items-center justify-between pt-0.5 text-xs text-zinc-400">
          <div className="flex items-center space-x-1">
            <button
              onClick={() => onCreateFolder()}
              title="Create New Folder / Group"
              className="p-1 hover:bg-zinc-800 hover:text-zinc-200 rounded text-zinc-400 flex items-center gap-1 text-[11px]"
            >
              <FolderPlus className="w-3.5 h-3.5 text-amber-400" />
              <span>+Folder</span>
            </button>
            <button
              onClick={() => onCreateTestCase()}
              title="Create New Test Case"
              className="p-1 hover:bg-zinc-800 hover:text-zinc-200 rounded text-zinc-400 flex items-center gap-1 text-[11px]"
            >
              <Plus className="w-3.5 h-3.5 text-blue-400" />
              <span>+Test</span>
            </button>
          </div>

          <button
            onClick={onRunEntireSuite}
            title="Run Entire Test Suite"
            className="px-2 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 rounded text-[11px] font-medium flex items-center gap-1"
          >
            <Play className="w-3 h-3 fill-current" />
            <span>Run All</span>
          </button>
        </div>
      </div>

      {/* Main File Explorer Tree Area */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5 custom-scrollbar">
        {folderTree.children.length === 0 && folderTree.testCases.length === 0 ? (
          <div className="p-4 text-center text-xs text-zinc-500">
            No test cases matching filter.
          </div>
        ) : (
          <>
            {folderTree.children.map(child => renderTreeNode(child, 0))}
            {folderTree.testCases.map(tc => {
              const isSelected = selectedTestCaseId === tc.id && activeView === 'editor';
              return (
                <div
                  key={tc.id}
                  onClick={() => onSelectTestCase(tc.id)}
                  className={`group flex items-center justify-between px-2 py-1 text-xs rounded cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-blue-600/20 text-blue-300 font-medium border-l-2 border-blue-500'
                      : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                  }`}
                >
                  <div className="flex items-center min-w-0 truncate mr-2">
                    {getStatusIcon(tc)}
                    {getMethodBadge(tc.request.method)}
                    <span className="truncate text-[11.5px]">{tc.name}</span>
                  </div>
                  <button
                    title="Run Single Test"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRunTest(tc.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-emerald-500/20 hover:text-emerald-400 rounded text-zinc-400 shrink-0"
                  >
                    <Play className="w-2.5 h-2.5" />
                  </button>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Project-Level Tools & Utilities */}
      <div className="p-2 border-t border-zinc-800 space-y-1 bg-zinc-950/60">
        <div className="px-2 py-1 flex items-center justify-between text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
          <span>Project Tools</span>
        </div>

        <button
          onClick={onOpenLiveRunner}
          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs transition-colors ${
            activeView === 'runner'
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-medium'
              : 'text-zinc-300 hover:bg-zinc-800/70'
          }`}
        >
          <div className="flex items-center gap-2">
            <Play className="w-3.5 h-3.5 text-emerald-400" />
            <span>⚡ Live Runner & iFrame</span>
          </div>
          <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 rounded font-mono">
            {activeProject.testCases.length}
          </span>
        </button>

        <button
          onClick={onOpenAiGenerator}
          className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs transition-colors ${
            activeView === 'ai-generator'
              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30 font-medium'
              : 'text-zinc-300 hover:bg-zinc-800/70'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-purple-400" />
          <span>✨ AI E2E Generator</span>
        </button>

        <button
          onClick={onOpenAiExplorer}
          className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs transition-colors ${
            activeView === 'ai-explorer'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-medium'
              : 'text-zinc-300 hover:bg-zinc-800/70'
          }`}
        >
          <Compass className="w-3.5 h-3.5 text-cyan-400" />
          <span>🧭 Autonomous AI Explorer</span>
        </button>

        <button
          onClick={onOpenReports}
          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs transition-colors ${
            activeView === 'reports'
              ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30 font-medium'
              : 'text-zinc-300 hover:bg-zinc-800/70'
          }`}
        >
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-3.5 h-3.5 text-blue-400" />
            <span>📊 Reports & Artifacts</span>
          </div>
          {activeProject.latestReport && (
            <span className={`text-[10px] px-1.5 rounded font-mono ${
              activeProject.latestReport.passRate >= 80 ? 'text-emerald-400' : 'text-rose-400'
            }`}>
              {activeProject.latestReport.passRate}%
            </span>
          )}
        </button>

        <button
          onClick={onOpenHistories}
          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs transition-colors ${
            activeView === 'histories'
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 font-medium'
              : 'text-zinc-300 hover:bg-zinc-800/70'
          }`}
        >
          <div className="flex items-center gap-2">
            <History className="w-3.5 h-3.5 text-amber-400" />
            <span>🕒 Execution Histories</span>
          </div>
          <span className="text-[10px] bg-zinc-800 text-zinc-400 px-1.5 rounded font-mono">
            {activeProject.reportsHistory?.length || (activeProject.latestReport ? 1 : 0)}
          </span>
        </button>

        <button
          onClick={onOpenSettings}
          className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs transition-colors ${
            activeView === 'settings'
              ? 'bg-zinc-800 text-zinc-100 font-medium'
              : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
          }`}
        >
          <Settings className="w-3.5 h-3.5" />
          <span>Project Settings</span>
        </button>
      </div>
    </aside>
  );
};
