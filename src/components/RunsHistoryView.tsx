import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import type { RunRecord } from '../types';
import { api } from '../api';
import { EmptyState, Spinner } from './ui';
import { RunResult } from './RunView';

export function RunsHistoryView({ projectId }: { projectId: string }) {
  const [runs, setRuns] = useState<RunRecord[] | null>(null);
  const [selected, setSelected] = useState<RunRecord | null>(null);

  useEffect(() => {
    setRuns(null);
    api.listRuns(projectId).then((r) => setRuns(r.runs)).catch(() => setRuns([]));
  }, [projectId]);

  if (runs === null) return <Spinner label="Loading runs…" />;
  if (selected) {
    return (
      <div className="h-full overflow-y-auto custom-scrollbar p-4">
        <button onClick={() => setSelected(null)} className="mb-3 text-xs text-blue-600 dark:text-blue-400 hover:underline">← back to history</button>
        <RunResult run={selected} />
      </div>
    );
  }
  if (runs.length === 0) {
    return <EmptyState icon={<History className="w-8 h-8" />} title="No runs yet" hint="Executed flows appear here with their full results and videos." />;
  }

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="max-w-3xl mx-auto p-4 space-y-1.5">
        {runs.map((run) => (
          <button key={run.id} onClick={() => setSelected(run)}
            className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-white dark:bg-zinc-900 transition-colors">
            <span className={`w-2 h-2 rounded-full shrink-0 ${run.status === 'passed' ? 'bg-emerald-500' : 'bg-red-500'}`} />
            <span className="text-xs font-medium truncate flex-1">{run.flowName}</span>
            {run.videoPath && <span className="text-[10px] text-violet-500">● video</span>}
            <span className="text-[10px] text-zinc-400 font-mono">{new Date(run.startedAt).toLocaleString()}</span>
            <span className="text-[10px] text-zinc-400 font-mono">{(run.durationMs / 1000).toFixed(1)}s</span>
          </button>
        ))}
      </div>
    </div>
  );
}
