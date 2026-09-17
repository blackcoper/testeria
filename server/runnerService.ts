import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runStore, newId } from './storage';
import type {
  Project, Flow, FlowStep, ErrorBranch, StepResult, RunRecord, UiAction, Extraction,
} from '../src/types';

const API_TIMEOUT_MS = 15_000;
const UI_TIMEOUT_MS = 8_000;

export interface RunOptions {
  record: boolean;
}

export class StepFailure extends Error {
  constructor(message: string, public detail?: string) {
    super(message);
  }
}

// ─── main entry ────────────────────────────────────────────────────────────

export async function runFlow(project: Project, flow: Flow, options: RunOptions): Promise<RunRecord> {
  const startedAt = Date.now();
  const results: StepResult[] = [];
  const ctx: Record<string, any> = {};
  const hasUiSteps = flow.steps.some((s) => s.type === 'ui' || flow.errorBranches.some((b) => b.steps.some((bs) => bs.type === 'ui')));

  let browser: Browser | undefined;
  let page: Page | undefined;
  let videoFile: string | undefined;
  let tempDir: string | undefined;

  if (hasUiSteps) {
    try {
      browser = await chromium.launch({ args: ['--no-sandbox'] });
      if (options.record) {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testeria-vid-'));
        const context: BrowserContext = await browser.newContext({
          viewport: { width: 1280, height: 720 },
          recordVideo: { dir: tempDir, size: { width: 1280, height: 720 } },
          baseURL: project.uiBaseUrl || undefined,
        });
        page = await context.newPage();
        videoFile = undefined; // path materializes on context.close()
        (page as any).__testeriaContext = context;
      } else {
        page = await browser.newPage({ baseURL: project.uiBaseUrl || undefined });
      }
    } catch (err: any) {
      const msg = `Browser launch failed: ${err?.message || err}. UI steps cannot run.`;
      results.push(...flow.steps.map<StepResult>((s) => ({
        stepId: s.id, name: s.name, type: s.type, status: 'failed',
        message: hasUiSteps && s.type === 'ui' ? msg : 'Skipped: browser launch failed',
        detail: String(err?.stack || err),
      })));
      const record: RunRecord = {
        id: newId('run'), projectId: project.id, flowId: flow.id, flowName: flow.name,
        status: 'failed', startedAt, durationMs: Date.now() - startedAt, steps: results,
        error: msg,
      };
      runStore.create(record);
      return record;
    }
  }

  try {
    for (const step of flow.steps) {
      let result = await executeStep(project, step, ctx, page);
      if (result.status === 'failed') {
        const branchOutcome = await runErrorBranches(project, flow, step, result, ctx, page);
        if (branchOutcome) {
          if (branchOutcome.then === 'retry') {
            const retry = await executeStep(project, step, ctx, page);
            retry.retried = true;
            retry.branchResults = [branchOutcome.result, ...retry.branchResults ?? []];
            result = retry.status === 'passed' ? retry : result; // keep original failure detail if retry also fails
            if (retry.status === 'passed') results.push(retry); else results.push(retry);
            continue;
          }
          if (branchOutcome.then === 'abort') {
            result.branchResults = [branchOutcome.result];
            results.push(result);
            // remaining steps marked skipped
            const idx = flow.steps.indexOf(step);
            for (const rest of flow.steps.slice(idx + 1)) {
              results.push({ stepId: rest.id, name: rest.name, type: rest.type, status: 'skipped', message: 'Skipped: flow aborted by error branch' });
            }
            break;
          }
          // 'continue': record branch, keep failed result, move on
          result.branchResults = [branchOutcome.result];
        }
      }
      results.push(result);
    }
  } finally {
    if ((page as any)?.__testeriaContext) {
      try {
        await (page as any).__testeriaContext.close(); // flush video to disk
      } catch { /* ignore */ }
    }
    if (browser) { try { await browser.close(); } catch { /* ignore */ } }
  }

  // Move video into permanent storage
  let videoPath: string | undefined;
  if (options.record && tempDir) {
    try {
      const files = fs.readdirSync(tempDir).filter((f) => f.endsWith('.webm'));
      if (files.length > 0) {
        const dest = path.join(runStore.videosDir, `${newId('vid')}.webm`);
        fs.copyFileSync(path.join(tempDir, files[0]), dest);
        videoPath = dest;
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  const failed = results.some((r) => r.status === 'failed');
  const record: RunRecord = {
    id: newId('run'), projectId: project.id, flowId: flow.id, flowName: flow.name,
    status: failed ? 'failed' : 'passed', startedAt, durationMs: Date.now() - startedAt,
    steps: results, videoPath,
  };
  runStore.create(record);
  return record;
}

// ─── error branches ────────────────────────────────────────────────────────

async function runErrorBranches(
  project: Project,
  flow: Flow,
  failedStep: FlowStep,
  failedResult: StepResult,
  ctx: Record<string, any>,
  page?: Page
): Promise<{ branch: ErrorBranch; result: StepResult; then: 'retry' | 'continue' | 'abort' } | null> {
  for (const branch of flow.errorBranches) {
    if (branch.triggerStepId && branch.triggerStepId !== failedStep.id) continue;
    if (!branchMatches(branch, failedResult)) continue;
    const result: StepResult = { stepId: branch.id, name: branch.name, type: 'branch', status: 'passed', message: `Branch "${branch.name}" activated` };
    const branchResults: StepResult[] = [];
    for (const bs of branch.steps) {
      const r = await executeStep(project, bs, ctx, page);
      branchResults.push(r);
      if (r.status === 'failed') { result.status = 'failed'; break; }
    }
    result.message = `Branch "${branch.name}": ${result.status === 'passed' ? 'recovery steps passed' : 'recovery step failed'}`;
    result.branchResults = branchResults;
    return { branch, result, then: branch.then };
  }
  return null;
}

function branchMatches(branch: ErrorBranch, failedResult: StepResult): boolean {
  if (branch.whenStatus?.length) {
    if (!branch.whenStatus.includes(failedResult.httpStatus ?? 0)) return false;
  }
  if (branch.whenContains) {
    const haystack = `${failedResult.message} ${failedResult.detail ?? ''}`;
    if (!haystack.toLowerCase().includes(branch.whenContains.toLowerCase())) return false;
  }
  return true;
}

// ─── step execution ────────────────────────────────────────────────────────

async function executeStep(project: Project, step: FlowStep, ctx: Record<string, any>, page?: Page): Promise<StepResult> {
  const started = Date.now();
  try {
    if (step.type === 'api') {
      if (!page) return await executeApiStep(project, step, ctx, started);
      // run API step without page; playwright page is only for UI steps
      return await executeApiStep(project, step, ctx, started);
    }
    if (step.type === 'ui') {
      if (!page) throw new StepFailure('No browser page available for UI step.');
      return await executeUiStep(project, step, ctx, page, started);
    }
    return { stepId: step.id, name: step.name, type: step.type, status: 'failed', message: `Unknown step type: ${(step as any).type}` };
  } catch (err: any) {
    if (err instanceof StepFailure) {
      return {
        stepId: step.id, name: step.name, type: step.type, status: 'failed',
        httpStatus: err instanceof ApiStepFailure ? (err as ApiStepFailure).httpStatus : undefined,
        latencyMs: Date.now() - started,
        message: err.message,
        detail: err instanceof ApiStepFailure ? (err as ApiStepFailure).detail : String(err?.stack || err),
      };
    }
    return {
      stepId: step.id, name: step.name, type: step.type, status: 'failed',
      latencyMs: Date.now() - started, message: err?.message || String(err),
      detail: String(err?.stack || err),
    };
  }
}

export class ApiStepFailure extends StepFailure {
  constructor(message: string, public httpStatus: number | undefined, detail?: string) {
    super(message, detail);
  }
}

// ─── API steps ─────────────────────────────────────────────────────────────

async function executeApiStep(project: Project, step: FlowStep, ctx: Record<string, any>, started: number): Promise<StepResult> {
  const method = (step.method || 'GET').toUpperCase();
  const rawPath = step.path || '/';
  const resolvedPath = interpolate(rawPath, ctx);
  const url = `${project.baseUrl.replace(/\/$/, '')}${resolvedPath.startsWith('/') ? '' : '/'}${resolvedPath}`;

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(step.headers || {})) headers[k] = interpolate(String(v), ctx);

  let body: any;
  if (step.body !== undefined && step.body !== null && ['POST', 'PUT', 'PATCH'].includes(method)) {
    const raw = interpolate(JSON.stringify(step.body), ctx);
    try { body = JSON.parse(raw); } catch { body = raw; }
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timer);
    const reason = err?.name === 'AbortError' ? `timed out after ${API_TIMEOUT_MS}ms` : err?.message || 'connection failed';
    throw new ApiStepFailure(`API request failed: ${method} ${resolvedPath} — ${reason}`, undefined, String(err?.stack || err));
  }
  clearTimeout(timer);

  const text = await res.text();
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { parsed = text; }

  // Assertions
  const problems: string[] = [];
  const expect = step.expect;
  if (expect?.status?.length && !expect.status.includes(res.status)) {
    problems.push(`status ${res.status} not in [${expect.status.join(', ')}]`);
  }
  if (expect?.bodyContains?.length) {
    for (const needle of expect.bodyContains) {
      if (!text.includes(needle)) problems.push(`body missing "${needle}"`);
    }
  }

  if (problems.length > 0) {
    throw new ApiStepFailure(
      `API ${method} ${resolvedPath} → ${res.status}${problems.length ? ` (${problems.join('; ')})` : ''}`,
      res.status,
      truncate(text, 4000)
    );
  }

  applyExtractions(step.extract, { status: res.status, body: parsed, text }, ctx);

  const latencyMs = Date.now() - started;
  return {
    stepId: step.id, name: interpolate(step.name, ctx), type: 'api', status: 'passed',
    httpStatus: res.status, latencyMs,
    message: `${method} ${resolvedPath} → ${res.status}${latencyMs ? ` (${latencyMs}ms)` : ''}`,
    detail: truncate(text, 2000),
  };
}

// ─── UI steps ──────────────────────────────────────────────────────────────

async function executeUiStep(project: Project, step: FlowStep, ctx: Record<string, any>, page: Page, started: number): Promise<StepResult> {
  const logs: string[] = [];
  for (const action of step.actions || []) {
    try {
      await performAction(page, action, ctx, logs, project);
    } catch (err: any) {
      const shot = await safeScreenshot(page);
      throw new StepFailure(
        `UI action failed: ${describeAction(action)} — ${err?.message?.split('\n')[0] || err}`,
        `${logs.join('\n')}${logs.length ? '\n' : ''}${shot ? `screenshot: (attached)\n` : 'screenshot unavailable'}${truncate(String(err?.stack || err), 2000)}`
      );
    }
  }

  const expect = step.expect;
  if (expect?.selector) {
    try {
      const el = page.locator(expect.selector).first();
      if (expect.selectorState === 'hidden') await el.waitFor({ state: 'hidden', timeout: UI_TIMEOUT_MS });
      else await el.waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS });
      logs.push(`assert: ${expect.selectorState || 'visible'} ${expect.selector} ✓`);
    } catch (err: any) {
      const shot = await safeScreenshot(page);
      throw new StepFailure(
        `UI assertion failed: expected ${expect.selectorState || 'visible'} ${expect.selector}`,
        `${logs.join('\n')}${logs.length ? '\n' : ''}screenshot: (attached)${shot ? '' : ' (unavailable)'}\n${truncate(String(err?.stack || err), 2000)}`
      );
    }
  }

  applyExtractions(step.extract, { page }, ctx);
  return {
    stepId: step.id, name: interpolate(step.name, ctx), type: 'ui', status: 'passed',
    latencyMs: Date.now() - started, message: logs.length ? logs.join(' · ') : 'UI actions completed',
  };
}

async function performAction(page: Page, action: UiAction, ctx: Record<string, any>, logs: string[], project: Project) {
  switch (action.kind) {
    case 'goto': {
      let url = interpolate(action.url, ctx);
      if (!/^https?:\/\//.test(url)) {
        const base = (project.uiBaseUrl || project.baseUrl).replace(/\/$/, '');
        url = `${base}/${url.replace(/^\//, '')}`;
      }
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: UI_TIMEOUT_MS });
      logs.push(`goto ${url}`);
      break;
    }
    case 'click':
      await page.locator(interpolate(action.selector, ctx)).first().click({ timeout: UI_TIMEOUT_MS });
      logs.push(`click ${action.selector}`);
      break;
    case 'fill':
      await page.locator(interpolate(action.selector, ctx)).first().fill(interpolate(action.value, ctx), { timeout: UI_TIMEOUT_MS });
      logs.push(`fill ${action.selector}`);
      break;
    case 'press':
      await page.keyboard.press(interpolate(action.key, ctx));
      logs.push(`press ${action.key}`);
      break;
    case 'wait':
      await page.waitForTimeout(action.ms);
      logs.push(`wait ${action.ms}ms`);
      break;
    case 'assertText': {
      const locator = page.locator(interpolate(action.selector, ctx)).first();
      await locator.waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS });
      const text = await locator.textContent();
      if (!text || !text.includes(interpolate(action.contains, ctx))) {
        throw new StepFailure(`assertText: "${action.contains}" not found in ${action.selector} (got "${truncate(text ?? '', 120)}")`);
      }
      logs.push(`text ${action.selector} contains "${action.contains}"`);
      break;
    }
    case 'screenshot':
      // stored on the step result via logs marker; real capture handled in executeUiStep catch/failure path
      logs.push('screenshot requested');
      break;
  }
}

function describeAction(a: UiAction): string {
  switch (a.kind) {
    case 'goto': return `goto ${a.url}`;
    case 'click': return `click ${a.selector}`;
    case 'fill': return `fill ${a.selector}`;
    case 'press': return `press ${a.key}`;
    case 'wait': return `wait ${a.ms}ms`;
    case 'assertText': return `assert text in ${a.selector}`;
    case 'screenshot': return 'screenshot';
  }
}

async function safeScreenshot(page: Page): Promise<string | undefined> {
  try {
    const buf = await page.screenshot({ timeout: 3000 });
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return undefined;
  }
}

// ─── shared helpers ────────────────────────────────────────────────────────

/** Replace {{var}} tokens with context values. Unknown vars are left as-is. */
export function interpolate(template: string, ctx: Record<string, any>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (m, key) => (key in ctx ? String(ctx[key]) : m));
}

function applyExtractions(
  extractions: Extraction[] | undefined,
  source: { status?: number; body?: any; text?: string; page?: Page },
  ctx: Record<string, any>
) {
  for (const ext of extractions || []) {
    try {
      let value: any;
      if (ext.from === 'status') value = source.status;
      else if (ext.from === 'body') value = source.body;
      else if (ext.from === 'text') value = source.text;
      else if (ext.from === 'page') {
        // page extraction: path='url' stores the current page URL into ctx
        if (String(ext.path) === 'url' && source.page) value = source.page.url();
      } else {
        continue;
      }
      if (ext.path && value !== undefined && ext.from !== 'page') {
        for (const part of String(ext.path).split('.')) {
          value = value?.[part];
        }
      }
      if (value !== undefined) ctx[ext.key] = value;
    } catch {
      // extraction is best-effort
    }
  }
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  return s.length <= max ? s : `${s.slice(0, max)}… (+${s.length - max} chars)`;
}
