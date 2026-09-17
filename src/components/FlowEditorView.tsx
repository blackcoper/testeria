import { useState } from 'react';
import {
  ChevronDown, ChevronRight, GitBranch, Globe, Plus, Save, Trash2, Workflow, Zap, ShieldAlert,
} from 'lucide-react';
import type { Flow, FlowStep, Endpoint, ErrorBranch, UiAction, BranchThen, Method } from '../types';
import { api } from '../api';
import { Badge, Button, Card, EmptyState, Input, Label, LazyInput, LazyTextarea, MethodBadge, Select, Spinner, Textarea } from './ui';
import { Modal } from './EndpointsView';

export function FlowEditorView({
  projectId, endpoints, flows, onChanged, onOpenRun,
}: {
  projectId: string;
  endpoints: Endpoint[];
  flows: Flow[];
  onChanged: () => void;
  onOpenRun: (flowId: string, record: boolean) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(flows[0]?.id ?? null);
  const flow = flows.find((f) => f.id === selectedId) ?? null;

  return (
    <div className="h-full flex">
      {/* flow list */}
      <div className="w-56 shrink-0 border-r border-zinc-200 dark:border-zinc-800 flex flex-col">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-200 dark:border-zinc-800">
          <h3 className="text-xs font-semibold">Flows</h3>
          <Button variant="subtle" title="New flow" onClick={async () => {
            const { flow: f } = await api.createFlow(projectId, { name: 'New E2E Flow' });
            onChanged();
            setSelectedId(f.id);
          }}><Plus className="w-3.5 h-3.5" /></Button>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-1.5 space-y-0.5">
          {flows.length === 0 && <p className="text-xs text-zinc-400 px-2 py-3">No flows yet. Create one.</p>}
          {flows.map((f) => (
            <div key={f.id} className={`group rounded-md text-xs flex items-center ${
              f.id === selectedId ? 'bg-blue-50 dark:bg-blue-950/50' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>
              <button onClick={() => setSelectedId(f.id)}
                className={`flex-1 min-w-0 text-left px-2 py-1.5 flex items-center gap-2 ${
                  f.id === selectedId ? 'text-blue-700 dark:text-blue-300' : ''}`}>
                <Workflow className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{f.name}</span>
              </button>
              <button title="Delete flow" onClick={async () => {
                if (confirm(`Delete flow "${f.name}"? Its run history stays in History.`)) {
                  await api.deleteFlow(f.id);
                  if (selectedId === f.id) setSelectedId(null);
                  onChanged();
                }
              }}
                className="px-1.5 py-1.5 mr-1 rounded text-zinc-300 dark:text-zinc-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* editor */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {!flow ? (
          <EmptyState icon={<Workflow className="w-8 h-8" />} title="Select or create a flow" hint="A flow is an ordered list of API/UI steps with optional error-recovery branches." />
        ) : (
          <FlowEditor key={flow.id} flow={flow} endpoints={endpoints} onChanged={onChanged} onOpenRun={onOpenRun} />
        )}
      </div>
    </div>
  );
}

// ─── single flow editor ────────────────────────────────────────────────────

function FlowEditor({ flow, endpoints, onChanged, onOpenRun }: {
  flow: Flow; endpoints: Endpoint[]; onChanged: () => void; onOpenRun: (flowId: string, record: boolean) => void;
}) {
  const [name, setName] = useState(flow.name);
  const [steps, setSteps] = useState<FlowStep[]>(flow.steps);
  const [branches, setBranches] = useState<ErrorBranch[]>(flow.errorBranches);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const touch = () => setDirty(true);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateFlow(flow.id, { name, steps, errorBranches: branches });
      setDirty(false);
      onChanged();
    } finally { setSaving(false); }
  };

  const addApiStep = (endpoint?: Endpoint) => {
    const step: FlowStep = endpoint
      ? { id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, type: 'api', name: `${endpoint.method} ${endpoint.path}`, endpointId: endpoint.id, method: endpoint.method, path: endpoint.path, headers: endpoint.headers, body: endpoint.bodySchema, extract: [], expect: {} }
      : { id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, type: 'api', name: 'New API step', method: 'GET', path: '/api/', headers: {}, body: undefined, extract: [], expect: {} };
    setSteps((s) => [...s, step]); touch();
  };

  const addUiStep = () => {
    setSteps((s) => [...s, { id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, type: 'ui', name: 'New UI step', actions: [{ kind: 'goto', url: '/' }], extract: [], expect: {} }]);
    touch();
  };

  const updateStep = (idx: number, patch: Partial<FlowStep>) => {
    setSteps((s) => s.map((st, i) => (i === idx ? { ...st, ...patch } : st)));
    touch();
  };

  const removeStep = (idx: number) => { setSteps((s) => s.filter((_, i) => i !== idx)); touch(); };

  const moveStep = (idx: number, dir: -1 | 1) => {
    setSteps((s) => {
      const next = [...s];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return s;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
    touch();
  };

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-4 pb-24">
      {/* header */}
      <div className="flex items-center gap-2">
        <Input value={name} onChange={(e) => { setName(e.target.value); touch(); }} className="font-semibold text-sm flex-1" />
        {dirty && <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">unsaved</Badge>}
        <Button variant="primary" onClick={save} disabled={saving || !dirty}><Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save'}</Button>
        <Button variant="ghost" onClick={() => onOpenRun(flow.id, false)} title="Run without recording"><Zap className="w-3.5 h-3.5" /> Run</Button>
        <Button variant="primary" onClick={() => onOpenRun(flow.id, true)} title="Run with video recording">● Run + Record</Button>
      </div>

      {/* steps */}
      {steps.length === 0 ? (
        <EmptyState title="No steps yet" hint="Add an API step from an endpoint, or a UI step to drive the browser." />
      ) : (
        steps.map((step, idx) => (
          <StepCard key={step.id} step={step} index={idx} endpoints={endpoints}
            onUpdate={(patch) => updateStep(idx, patch)}
            onRemove={() => removeStep(idx)}
            onMove={(dir) => moveStep(idx, dir)} />
        ))
      )}

      <div className="flex gap-2">
        <AddApiStepMenu endpoints={endpoints} onPick={addApiStep} onManual={() => addApiStep()} />
        <Button onClick={addUiStep}><Globe className="w-3.5 h-3.5" /> UI step</Button>
      </div>

      {/* error branches */}
      <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold flex items-center gap-1.5"><ShieldAlert className="w-3.5 h-3.5 text-amber-500" /> Error branches</h3>
          <Button variant="subtle" onClick={() => { setBranches((b) => [...b, { id: `br_${Date.now()}`, name: 'Recovery branch', steps: [], then: 'retry' }]); touch(); }}>
            <Plus className="w-3.5 h-3.5" /> Add branch
          </Button>
        </div>
        {branches.length === 0 && (
          <p className="text-xs text-zinc-400">
            When a step fails (e.g. 401 token expired, 404 not found), a matching branch runs its recovery steps, then retries, continues, or aborts the flow.
          </p>
        )}
        <div className="space-y-2">
          {branches.map((branch, bi) => (
            <BranchCard key={branch.id} branch={branch} endpoints={endpoints} steps={steps}
              onUpdate={(patch) => { setBranches((b) => b.map((x, i) => (i === bi ? { ...x, ...patch } : x))); touch(); }}
              onRemove={() => { setBranches((b) => b.filter((_, i) => i !== bi)); touch(); }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── step card ─────────────────────────────────────────────────────────────

function StepCard({ step, index, endpoints, onUpdate, onRemove, onMove }: {
  step: FlowStep; index: number; endpoints: Endpoint[];
  onUpdate: (patch: Partial<FlowStep>) => void; onRemove: () => void; onMove: (dir: -1 | 1) => void;
}) {
  const [open, setOpen] = useState(index === 0);
  const isApi = step.type === 'api';

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown className="w-3.5 h-3.5 text-zinc-400" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />}
        <span className="text-[10px] font-mono text-zinc-400 w-5">{index + 1}</span>
        {isApi && step.method ? <MethodBadge method={step.method} /> : <Badge className="bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"><Globe className="w-2.5 h-2.5 mr-0.5" />UI</Badge>}
        <span className="text-xs font-medium flex-1 truncate">{step.name}</span>
        {step.extract && step.extract.length > 0 && <Badge className="bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">{step.extract.length} var</Badge>}
        <div className="flex gap-0.5" onClick={(e) => e.stopPropagation()}>
          <Button variant="subtle" title="Move up" onClick={() => onMove(-1)} className="px-1.5">↑</Button>
          <Button variant="subtle" title="Move down" onClick={() => onMove(1)} className="px-1.5">↓</Button>
          <Button variant="subtle" title="Delete" onClick={onRemove}><Trash2 className="w-3.5 h-3.5" /></Button>
        </div>
      </div>

      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-zinc-100 dark:border-zinc-800 space-y-3">
          <div><Label>Step name</Label><Input value={step.name} onChange={(e) => onUpdate({ name: e.target.value })} /></div>

          {isApi ? (
            <>
              <div className="grid grid-cols-[110px_1fr] gap-2">
                <div><Label>Method</Label>
                  <Select value={step.method || 'GET'} onChange={(e) => onUpdate({ method: e.target.value as Method })} className="w-full">
                    {(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as Method[]).map((m) => <option key={m}>{m}</option>)}
                  </Select>
                </div>
                <div><Label>Path (supports {'{{variables}}'})</Label><Input value={step.path || ''} onChange={(e) => onUpdate({ path: e.target.value })} placeholder="/api/orders/{{orderId}}" /></div>
              </div>
              <JsonField label={`Headers (JSON, {{accessToken}} interpolated)`} value={step.headers || {}} rows={2}
                onChange={(v) => onUpdate({ headers: v && typeof v === 'object' && !Array.isArray(v) ? v : step.headers })} />
              <JsonField label="Body (JSON, POST/PUT/PATCH)" value={step.body} rows={4}
                onChange={(v) => onUpdate({ body: v })} />
            </>
          ) : (
            <UiActionsEditor actions={step.actions || []} onChange={(actions) => onUpdate({ actions })} />
          )}

          <ExtractionsEditor extract={step.extract || []} onChange={(extract) => onUpdate({ extract })} />
          <ExpectEditor expect={step.expect || {}} isApi={isApi} onChange={(expect) => onUpdate({ expect })} />
        </div>
      )}
    </Card>
  );
}

// ─── UI actions editor ─────────────────────────────────────────────────────

function UiActionsEditor({ actions, onChange }: { actions: UiAction[]; onChange: (a: UiAction[]) => void }) {
  const update = (i: number, patch: any) => onChange(actions.map((a, idx) => (idx === i ? { ...a, ...patch } as UiAction : a)));

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <Label>Browser actions</Label>
        <Select className="text-[11px]" value="" onChange={(e) => {
          const kind = e.target.value as UiAction['kind'];
          if (!kind) return;
          const blank: any =
            kind === 'goto' ? { kind, url: '/' } :
            kind === 'click' ? { kind, selector: '' } :
            kind === 'fill' ? { kind, selector: '', value: '' } :
            kind === 'press' ? { kind, key: 'Enter' } :
            kind === 'wait' ? { kind, ms: 500 } :
            kind === 'assertText' ? { kind, selector: '', contains: '' } :
            { kind, name: 'screenshot' };
          onChange([...actions, blank]);
        }}>
          <option value="">+ add action…</option>
          <option value="goto">goto URL</option>
          <option value="click">click</option>
          <option value="fill">fill</option>
          <option value="press">press key</option>
          <option value="wait">wait ms</option>
          <option value="assertText">assert text</option>
        </Select>
      </div>
      <div className="space-y-1.5">
        {actions.map((a, i) => (
          <div key={i} className="flex items-center gap-1.5 flex-wrap">
            <Badge className="bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300 w-20 justify-center">{a.kind}</Badge>
            {a.kind === 'goto' && <Input value={a.url} onChange={(e) => update(i, { url: e.target.value })} placeholder="/login or https://…" className="flex-1 min-w-[140px]" />}
            {a.kind === 'click' && <Input value={a.selector} onChange={(e) => update(i, { selector: e.target.value })} placeholder="button[type=submit]" className="flex-1 min-w-[140px]" />}
            {a.kind === 'fill' && <>
              <Input value={a.selector} onChange={(e) => update(i, { selector: e.target.value })} placeholder="input[name=email]" className="flex-1 min-w-[120px]" />
              <Input value={a.value} onChange={(e) => update(i, { value: e.target.value })} placeholder="value / {'{{var}}'}" className="flex-1 min-w-[120px]" />
            </>}
            {a.kind === 'press' && <Input value={a.key} onChange={(e) => update(i, { key: e.target.value })} className="w-24" />}
            {a.kind === 'wait' && <Input type="number" value={a.ms} onChange={(e) => update(i, { ms: Number(e.target.value) })} className="w-24" />}
            {a.kind === 'assertText' && <>
              <Input value={a.selector} onChange={(e) => update(i, { selector: e.target.value })} placeholder="h1" className="flex-1 min-w-[110px]" />
              <Input value={a.contains} onChange={(e) => update(i, { contains: e.target.value })} placeholder="contains…" className="flex-1 min-w-[110px]" />
            </>}
            <Button variant="subtle" onClick={() => onChange(actions.filter((_, idx) => idx !== i))}><Trash2 className="w-3 h-3" /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── extractions editor ────────────────────────────────────────────────────

function ExtractionsEditor({ extract, onChange }: { extract: { key: string; from: string; path?: string }[]; onChange: (e: any[]) => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <Label>Extract variables from response</Label>
        <Button variant="subtle" onClick={() => onChange([...extract, { key: '', from: 'body', path: '' }])}><Plus className="w-3 h-3" /></Button>
      </div>
      {extract.map((ext, i) => (
        <div key={i} className="flex items-center gap-1.5 mb-1.5">
          <Input value={ext.key} onChange={(e) => onChange(extract.map((x, idx) => (idx === i ? { ...x, key: e.target.value } : x)))} placeholder="accessToken" className="w-32" />
          <Select value={ext.from} onChange={(e) => onChange(extract.map((x, idx) => (idx === i ? { ...x, from: e.target.value } : x)))}>
            <option value="body">body</option><option value="status">status</option><option value="text">text</option><option value="page">page.url</option>
          </Select>
          {ext.from !== 'page' && ext.from !== 'status' && (
            <Input value={ext.path || ''} onChange={(e) => onChange(extract.map((x, idx) => (idx === i ? { ...x, path: e.target.value } : x)))} placeholder="data.token" className="flex-1" />
          )}
          <Button variant="subtle" onClick={() => onChange(extract.filter((_, idx) => idx !== i))}><Trash2 className="w-3 h-3" /></Button>
        </div>
      ))}
    </div>
  );
}

// ─── expectations editor ───────────────────────────────────────────────────

function ExpectEditor({ expect, isApi, onChange }: { expect: any; isApi: boolean; onChange: (e: any) => void }) {
  return (
    <div>
      <Label>Assertions</Label>
      {isApi ? (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-zinc-500">expected status</span>
          <LazyInput
            className="w-36" placeholder="200 or 200,201"
            value={(expect.status || []).join(',')}
            onCommit={(t) => onChange({ ...expect, status: t.split(',').map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => !Number.isNaN(n)) })}
          />
          <span className="text-[11px] text-zinc-500">body contains</span>
          <LazyInput className="flex-1 min-w-[160px]" placeholder='"status":"ok" (comma separated)'
            value={(expect.bodyContains || []).join(',')}
            onCommit={(t) => onChange({ ...expect, bodyContains: t.split(',').map((s: string) => s.trim()).filter(Boolean) })}
          />
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-zinc-500">selector</span>
          <Input className="w-48" value={expect.selector || ''} onChange={(e) => onChange({ ...expect, selector: e.target.value })} placeholder="[data-testid=dashboard]" />
          <Select value={expect.selectorState || 'visible'} onChange={(e) => onChange({ ...expect, selectorState: e.target.value })}>
            <option value="visible">visible</option><option value="hidden">hidden</option>
          </Select>
        </div>
      )}
    </div>
  );
}

// ─── add API step menu ─────────────────────────────────────────────────────

function AddApiStepMenu({ endpoints, onPick, onManual }: { endpoints: Endpoint[]; onPick: (ep: Endpoint) => void; onManual: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button variant="primary" onClick={() => setOpen((o) => !o)}><Plus className="w-3.5 h-3.5" /> API step</Button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <Card className="absolute z-50 mt-1 w-80 max-h-72 overflow-y-auto custom-scrollbar p-1 shadow-lg">
            {endpoints.length === 0 && <p className="text-xs text-zinc-400 px-2 py-2">No endpoints — add some first, or use manual step.</p>}
            {endpoints.map((ep) => (
              <button key={ep.id} className="w-full text-left px-2 py-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-2"
                onClick={() => { onPick(ep); setOpen(false); }}>
                <MethodBadge method={ep.method} />
                <span className="font-mono text-[11px] truncate">{ep.path}</span>
                <span className="text-[10px] text-zinc-400 truncate ml-auto">{ep.summary}</span>
              </button>
            ))}
            <div className="border-t border-zinc-100 dark:border-zinc-800 mt-1 pt-1">
              <button className="w-full text-left px-2 py-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs text-zinc-500" onClick={() => { onManual(); setOpen(false); }}>
                + Manual step (custom path)
              </button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

// ─── JSON field (typing-friendly: invalid JSON never reverts your text) ────

function JsonField({ label, value, rows, onChange }: {
  label: string; value: any; rows?: number; onChange: (v: any) => void;
}) {
  const [text, setText] = useState(value === undefined || value === null ? '' : JSON.stringify(value, null, 2));
  const [err, setErr] = useState(false);
  const commit = (t: string) => {
    if (!t.trim()) { setErr(false); onChange(undefined); return; }
    try { onChange(JSON.parse(t)); setErr(false); } catch { setErr(true); }
  };
  return (
    <div>
      <Label>{label}</Label>
      <Textarea rows={rows ?? 3} value={text}
        onChange={(e) => { setText(e.target.value); commit(e.target.value); }}
        onBlur={(e) => commit(e.target.value)}
        className={err ? 'border-red-400 focus:ring-red-500/40' : ''} />
      {err && <p className="mt-1 text-[10px] text-red-500">Invalid JSON — kept your text, previous value still saved.</p>}
    </div>
  );
}

// ─── branch card ───────────────────────────────────────────────────────────

function BranchCard({ branch, steps, endpoints, onUpdate, onRemove }: {
  branch: ErrorBranch; steps: FlowStep[]; endpoints: Endpoint[];
  onUpdate: (patch: Partial<ErrorBranch>) => void; onRemove: () => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <Card className="border-amber-200 dark:border-amber-900 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown className="w-3.5 h-3.5 text-zinc-400" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />}
        <GitBranch className="w-3.5 h-3.5 text-amber-500" />
        <Input value={branch.name} onClick={(e) => e.stopPropagation()} onChange={(e) => onUpdate({ name: e.target.value })} className="font-medium text-xs flex-1" />
        <Button variant="subtle" onClick={() => { onRemove(); }}><Trash2 className="w-3.5 h-3.5" /></Button>
      </div>
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-amber-100 dark:border-amber-900/60 pt-2">
          <p className="text-[11px] text-zinc-500">When this step fails with…</p>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={branch.triggerStepId ?? ''} onChange={(e) => onUpdate({ triggerStepId: e.target.value || undefined })} className="max-w-[200px]">
              <option value="any">any failing step</option>
              {steps.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            <span className="text-[11px] text-zinc-500">status</span>
            <LazyInput className="w-28" placeholder="401 (empty = any)" value={(branch.whenStatus || []).join(',')}
              onCommit={(t) => onUpdate({ whenStatus: t.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n)) })} />
            <span className="text-[11px] text-zinc-500">body contains</span>
            <LazyInput className="flex-1 min-w-[140px]" placeholder="token expired" value={branch.whenContains || ''} onCommit={(t) => onUpdate({ whenContains: t })} />
          </div>
          <p className="text-[11px] text-zinc-500">Recovery steps</p>
          {branch.steps.map((bs, bi) => (
            <div key={bs.id} className="flex items-center gap-2 text-xs bg-zinc-50 dark:bg-zinc-800/60 rounded px-2 py-1">
              <span className="text-zinc-400">{bi + 1}.</span>
              {bs.type === 'api' ? (
                <span className="font-mono text-[11px]">{bs.method} {bs.path}</span>
              ) : (
                <span>{bs.name}</span>
              )}
              <Button variant="subtle" className="ml-auto" onClick={() => onUpdate({ steps: branch.steps.filter((_, i) => i !== bi) })}><Trash2 className="w-3 h-3" /></Button>
            </div>
          ))}
          <BranchStepAdder endpoints={endpoints} onAdd={(step) => onUpdate({ steps: [...branch.steps, step] })} />
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-zinc-500">then</span>
            <Select value={branch.then} onChange={(e) => onUpdate({ then: e.target.value as BranchThen })}>
              <option value="retry">retry failed step</option>
              <option value="continue">continue (mark failed)</option>
              <option value="abort">abort flow</option>
            </Select>
          </div>
        </div>
      )}
    </Card>
  );
}

function BranchStepAdder({ endpoints, onAdd }: { endpoints: Endpoint[]; onAdd: (step: FlowStep) => void }) {
  return (
    <div className="flex gap-2">
      <Select value="" className="flex-1" onChange={(e) => {
        const ep = endpoints.find((x) => x.id === e.target.value);
        if (!ep) return;
        onAdd({ id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, type: 'api', name: `${ep.method} ${ep.path}`, endpointId: ep.id, method: ep.method, path: ep.path, headers: ep.headers, body: ep.bodySchema, expect: {} });
      }}>
        <option value="">+ recovery step from endpoint…</option>
        {endpoints.map((ep) => <option key={ep.id} value={ep.id}>{ep.method} {ep.path}</option>)}
      </Select>
    </div>
  );
}
