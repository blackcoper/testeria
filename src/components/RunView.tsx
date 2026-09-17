import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, Film, Play, XCircle } from 'lucide-react';
import type { RunRecord, StepResult, Flow, Project } from '../types';
import { api } from '../api';
import { Badge, Button, Card, EmptyState, MethodBadge, Select, Spinner, StatusDot } from './ui';

export function RunView({
  project, flows, preRun, onDone,
}: {
  project: Project;
  flows: Flow[];
  /** when set (keyed by nonce), the view starts this run immediately */
  preRun: { flowId: string; record: boolean } | null;
  onDone: (run: RunRecord) => void;
}) {
  const [flowId, setFlowId] = useState<string>(preRun?.flowId ?? flows[0]?.id ?? '');
  const [record, setRecord] = useState(preRun?.record ?? false);
  const [run, setRun] = useState<RunRecord | null>(null);
  const [running, setRunning] = useState(false);
  const startedRef = useRef<string | null>(null); // preRun nonce already handled

  // Keep the selection valid when the flow list changes
  useEffect(() => {
    if (flows.length > 0 && !flows.some((f) => f.id === flowId)) setFlowId(flows[0].id);
  }, [flows, flowId]);

  // Auto-start exactly once per preRun request (StrictMode-safe via ref)
  useEffect(() => {
    if (preRun && startedRef.current !== (preRun as any).nonce) {
      startedRef.current = (preRun as any).nonce;
      if (preRun.record !== record) setRecord(preRun.record);
      startRun(preRun.record);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preRun]);

  const flow = flows.find((f) => f.id === flowId) ?? null;

  const startRun = async (withRecord: boolean) => {
    if (!flow || running) return;
    setRunning(true);
    setRun(null);
    try {
      const { run: r } = await api.runFlow(flow.id, withRecord);
      setRun(r);
      onDone(r);
    } catch (err: any) {
      setRun({
        id: 'adhoc', projectId: project.id, flowId: flow.id, flowName: flow?.name ?? 'flow',
        status: 'failed', startedAt: Date.now(), durationMs: 0, steps: [],
        error: err.message,
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 flex-wrap">
        <h2 className="text-sm font-semibold">Run</h2>
        <Select value={flowId} onChange={(e) => setFlowId(e.target.value)} className="max-w-[240px]">
          {flows.length === 0 && <option value="">no flows yet</option>}
          {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-zinc-500 cursor-pointer select-none">
          <input type="checkbox" checked={record} onChange={(e) => setRecord(e.target.checked)} className="accent-blue-600" />
          record video
        </label>
        <Button variant="primary" disabled={!flow || running} onClick={() => startRun(record)}>
          <Play className="w-3.5 h-3.5" /> {running ? 'Running…' : 'Run flow'}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        {running && <Spinner label="Executing flow — API steps and browser actions run live…" />}

        {!running && !run && flows.length === 0 && (
          <EmptyState icon={<Play className="w-8 h-8" />} title="No flows yet" hint="Create a flow in the Flows tab first — then run it here." />
        )}
        {!running && !run && flows.length > 0 && (
          <EmptyState icon={<Play className="w-8 h-8" />} title="Ready to run" hint="Pick a flow and hit Run. Enable 'record video' to capture the browser session as proof." />
        )}

        {!running && run && <RunResult run={run} />}
      </div>
    </div>
  );
}

export function RunResult({ run }: { run: RunRecord }) {
  const passed = run.steps.filter((s) => s.status === 'passed').length;
  return (
    <div className="space-y-3 max-w-3xl mx-auto">
      {/* summary */}
      <Card className="p-3">
        <div className="flex items-center gap-3 flex-wrap">
          {run.status === 'passed'
            ? <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            : <XCircle className="w-5 h-5 text-red-500" />}
          <span className={`text-sm font-semibold ${run.status === 'passed' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {run.status === 'passed' ? 'PASSED' : 'FAILED'}
          </span>
          <Badge className="bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{passed}/{run.steps.length} steps</Badge>
          <Badge className="bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{(run.durationMs / 1000).toFixed(1)}s</Badge>
          {run.videoPath && (
            <Badge className="bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300">
              <Film className="w-3 h-3 mr-1" /> recorded
            </Badge>
          )}
          {run.error && <span className="text-xs text-red-600 dark:text-red-400">{run.error}</span>}
        </div>
        {run.videoPath && <VideoPlayer path={run.videoPath} />}
      </Card>

      {/* steps */}
      <div className="space-y-1.5">
        {run.steps.map((s, i) => <StepRow key={`${s.stepId}-${i}`} result={s} />)}
      </div>
    </div>
  );
}

function VideoPlayer({ path }: { path: string }) {
  const url = `/api/videos/${path.split('/').pop()}`;
  return (
    <div className="mt-3">
      <video key={url} controls className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 max-h-80 bg-black" src={url} />
      <a href={url} download className="inline-flex items-center gap-1.5 mt-2 text-xs text-blue-600 dark:text-blue-400 hover:underline">
        <Download className="w-3.5 h-3.5" /> Download video (proof)
      </a>
    </div>
  );
}

function StepRow({ result }: { result: StepResult }) {
  const [open, setOpen] = useState(result.status === 'failed');
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <StatusDot status={result.status} />
        <span className="text-xs font-medium flex-1 truncate">{result.name}</span>
        {result.type === 'branch' && <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">branch</Badge>}
        {result.retried && <Badge className="bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">retried ✓</Badge>}
        {result.httpStatus !== undefined && <MethodBadge method={String(result.httpStatus)} />}
        {result.latencyMs !== undefined && <span className="text-[10px] text-zinc-400 font-mono">{result.latencyMs}ms</span>}
      </div>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-zinc-100 dark:border-zinc-800 space-y-2">
          <p className={`text-xs ${result.status === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-zinc-500 dark:text-zinc-400'}`}>{result.message}</p>
          {result.detail && (
            <pre className="text-[10px] font-mono bg-zinc-50 dark:bg-zinc-800/70 rounded p-2 overflow-x-auto max-h-40 custom-scrollbar whitespace-pre-wrap break-all">{result.detail}</pre>
          )}
          {result.screenshot && <img src={result.screenshot} alt="failure screenshot" className="rounded border border-zinc-200 dark:border-zinc-800 max-w-full" />}
          {result.branchResults?.map((b, i) => <StepRow key={i} result={b} />)}
        </div>
      )}
    </Card>
  );
}
