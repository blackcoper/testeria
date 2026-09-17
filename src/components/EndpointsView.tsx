import { useEffect, useRef, useState } from 'react';
import { FileUp, Pencil, Plus, Trash2, RefreshCw } from 'lucide-react';
import type { Endpoint, Method } from '../types';
import { api } from '../api';
import { Badge, Button, Card, EmptyState, Input, Label, MethodBadge, Select, Spinner, Textarea } from './ui';

const METHODS: Method[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export function EndpointsView({
  projectId, endpoints, onChanged,
}: {
  projectId: string;
  endpoints: Endpoint[];
  onChanged: () => void;
}) {
  const [showImport, setShowImport] = useState(false);
  const [editing, setEditing] = useState<Endpoint | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Endpoints</h2>
          <Badge className="bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{endpoints.length}</Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setShowImport(true)}><FileUp className="w-3.5 h-3.5" /> Import OpenAPI</Button>
          <Button variant="primary" onClick={() => setEditing('new')}><Plus className="w-3.5 h-3.5" /> Add</Button>
        </div>
      </div>

      {notice && (
        <div className={`mx-4 mt-2 px-3 py-2 rounded-md text-xs ${
          notice.kind === 'ok' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
          : notice.kind === 'warn' ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
          : 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300'}`}
        onClick={() => setNotice(null)}>
          {notice.text}
        </div>
      )}

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        {endpoints.length === 0 ? (
          <EmptyState
            icon={<FileUp className="w-8 h-8" />}
            title="No endpoints yet"
            hint="Import an OpenAPI/Swagger document or add endpoints manually. Flows will reference these endpoints."
          />
        ) : (
          <div className="space-y-1.5">
            {endpoints.map((ep) => (
              <Card key={ep.id} className="px-3 py-2 flex items-center gap-3 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors">
                <MethodBadge method={ep.method} />
                <span className="font-mono text-xs text-zinc-800 dark:text-zinc-200">{ep.path}</span>
                <span className="text-xs text-zinc-400 truncate flex-1">{ep.summary}</span>
                <div className="flex gap-1 shrink-0">
                  <Button variant="subtle" title="Edit" onClick={() => setEditing(ep)}><Pencil className="w-3.5 h-3.5" /></Button>
                  <Button variant="subtle" title="Delete" onClick={async () => { await api.deleteEndpoint(ep.id); onChanged(); }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {showImport && (
        <ImportDialog
          projectId={projectId}
          onClose={() => setShowImport(false)}
          onImported={(count, warnings) => {
            setShowImport(false);
            setNotice(count > 0
              ? { kind: warnings.length ? 'warn' : 'ok', text: `Imported ${count} endpoints.${warnings.length ? ` Warnings: ${warnings.join(' ')}` : ''}` }
              : { kind: 'err', text: 'No endpoints found in the document.' });
            onChanged();
          }}
          onImporting={setImporting}
        />
      )}
      {editing && (
        <EndpointDialog
          projectId={projectId}
          endpoint={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged(); }}
        />
      )}
      {importing && <Spinner label="Importing…" />}
    </div>
  );
}

// ─── import dialog ─────────────────────────────────────────────────────────

function ImportDialog({ projectId, onClose, onImported, onImporting }: {
  projectId: string; onClose: () => void; onImported: (count: number, warnings: string[]) => void; onImporting: (v: boolean) => void;
}) {
  const [raw, setRaw] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const doImport = async () => {
    onImporting(true);
    try {
      const result = await api.importEndpoints(projectId, raw);
      onImported(result.importedCount, result.warnings);
    } catch (err: any) {
      onImported(0, [err.message]);
    } finally {
      onImporting(false);
    }
  };

  return (
    <Modal title="Import OpenAPI / Swagger" onClose={onClose}>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
        Paste JSON or YAML. This replaces the current endpoint list. Path params <code className="font-mono">{'{id}'}</code> become <code className="font-mono">:id</code>.
      </p>
      <input ref={fileRef} type="file" accept=".json,.yaml,.yml" className="hidden" onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) f.text().then(setRaw);
      }} />
      <div className="flex gap-2 mb-2">
        <Button variant="ghost" onClick={() => fileRef.current?.click()}>Choose file…</Button>
        {raw && <Button variant="subtle" onClick={() => setRaw('')}><RefreshCw className="w-3 h-3" /> Clear</Button>}
      </div>
      <Textarea rows={12} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder='{ "openapi": "3.0.0", "paths": { ... } }' />
      <div className="flex justify-end gap-2 mt-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!raw.trim()} onClick={doImport}>Import</Button>
      </div>
    </Modal>
  );
}

// ─── endpoint editor ───────────────────────────────────────────────────────

function EndpointDialog({ projectId, endpoint, onClose, onSaved }: { projectId: string; endpoint: Endpoint | null; onClose: () => void; onSaved: () => void }) {
  const [method, setMethod] = useState<Method>(endpoint?.method || 'GET');
  const [path, setPath] = useState(endpoint?.path || '/api/');
  const [summary, setSummary] = useState(endpoint?.summary || '');
  const [bodySchema, setBodySchema] = useState(() => endpoint?.bodySchema ? JSON.stringify(endpoint.bodySchema, null, 2) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    let body: any;
    if (bodySchema.trim()) {
      try { body = JSON.parse(bodySchema); } catch { setError('Body schema is not valid JSON'); return; }
    }
    setSaving(true); setError(null);
    try {
      const payload = { method, path: path.trim(), summary: summary.trim(), bodySchema: body };
      if (endpoint) await api.updateEndpoint(endpoint.id, payload);
      else await api.createEndpoint(projectId, payload);
      onSaved();
    } catch (err: any) { setError(err.message); } finally { setSaving(false); }
  };

  return (
    <Modal title={endpoint ? 'Edit endpoint' : 'New endpoint'} onClose={onClose}>
      <div className="grid grid-cols-[110px_1fr] gap-2 mb-3">
        <div><Label>Method</Label><Select value={method} onChange={(e) => setMethod(e.target.value as Method)} className="w-full">{METHODS.map((m) => <option key={m}>{m}</option>)}</Select></div>
        <div><Label>Path</Label><Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/api/orders/:id" /></div>
      </div>
      <div className="mb-3"><Label>Summary</Label><Input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Create new order" /></div>
      <div className="mb-1"><Label>Sample request body (JSON, optional)</Label></div>
      <Textarea rows={6} value={bodySchema} onChange={(e) => setBodySchema(e.target.value)} placeholder='{ "email": "user@example.com" }' />
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex justify-end gap-2 mt-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={saving || !path.trim()} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </Modal>
  );
}

// ─── shared modal shell ────────────────────────────────────────────────────

export function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-zinc-950/40" onClick={onClose} />
      <Card className="relative w-full max-w-xl max-h-[85vh] overflow-y-auto custom-scrollbar p-4 shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">✕</button>
        </div>
        {children}
      </Card>
    </div>
  );
}
