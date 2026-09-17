// ─── Domain types (shared by server & frontend) ────────────────────────────

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface Endpoint {
  id: string;
  method: Method;
  /** Path with :param placeholders, e.g. /api/orders/:id */
  path: string;
  summary: string;
  description?: string;
  tags?: string[];
  /** query param name -> type description */
  querySchema?: Record<string, string>;
  /** sample / example request body */
  bodySchema?: any;
  headers?: Record<string, string>;
}

export interface Extraction {
  /** context variable name to store the value under, e.g. "accessToken" */
  key: string;
  from: 'status' | 'body' | 'text' | 'page';
  /** dot path into the value, e.g. "data.0.id" (body), or 'url' for from:'page' */
  path?: string;
}

export interface Expectation {
  /** API: acceptable HTTP status codes */
  status?: number[];
  /** API: substrings that must appear in the response body */
  bodyContains?: string[];
  /** UI: selector must be visible / hidden when the step finishes */
  selector?: string;
  selectorState?: 'visible' | 'hidden';
}

export type UiAction =
  | { kind: 'goto'; url: string }
  | { kind: 'click'; selector: string }
  | { kind: 'fill'; selector: string; value: string }
  | { kind: 'press'; key: string }
  | { kind: 'wait'; ms: number }
  | { kind: 'assertText'; selector: string; contains: string }
  | { kind: 'screenshot'; name?: string };

export interface FlowStep {
  id: string;
  type: 'api' | 'ui';
  name: string;
  // ── API steps ──
  endpointId?: string;
  method?: Method;
  path?: string;
  headers?: Record<string, string>;
  body?: any;
  // ── UI steps ──
  actions?: UiAction[];
  // ── shared ──
  extract?: Extraction[];
  expect?: Expectation;
}

export type BranchThen = 'retry' | 'continue' | 'abort';

/**
 * Recovery sub-flow. When a step fails and the branch matches
 * (trigger step + condition), its steps run first, then `then` decides
 * what happens to the failed step.
 */
export interface ErrorBranch {
  id: string;
  name: string;
  /** step the branch watches; undefined = any failing step */
  triggerStepId?: string;
  /** API: HTTP statuses that activate this branch */
  whenStatus?: number[];
  /** substring match on response body / error message */
  whenContains?: string;
  steps: FlowStep[];
  then: BranchThen;
}

export interface Flow {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  steps: FlowStep[];
  errorBranches: ErrorBranch[];
  createdAt: number;
  updatedAt: number;
}

export interface Project {
  id: string;
  name: string;
  /** base URL for API steps, e.g. http://localhost:4000 */
  baseUrl: string;
  /** base URL for UI steps (web app under test) */
  uiBaseUrl?: string;
  createdAt: number;
  updatedAt: number;
}

// ─── Run results ───────────────────────────────────────────────────────────

export interface StepResult {
  stepId: string;
  name: string;
  type: 'api' | 'ui' | 'branch';
  status: 'passed' | 'failed' | 'skipped';
  httpStatus?: number;
  latencyMs?: number;
  message: string;
  /** response body / error text (truncated) */
  detail?: string;
  /** inline screenshot (data URL), captured on UI failures or explicit screenshot actions */
  screenshot?: string;
  /** branch results nested under the step that triggered them */
  branchResults?: StepResult[];
  /** true when the step passed after an error-branch retry */
  retried?: boolean;
}

export interface RunRecord {
  id: string;
  projectId: string;
  flowId: string;
  flowName: string;
  status: 'passed' | 'failed';
  startedAt: number;
  durationMs: number;
  steps: StepResult[];
  /** URL of the recorded video (only when record=true and the flow had UI steps) */
  videoPath?: string;
  error?: string;
}
