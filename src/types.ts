export type TechStack = 'nestjs' | 'nextjs' | 'vue' | 'php' | 'other';

export type TestCaseCategory =
  | 'happy_path'
  | 'negative_validation'
  | 'auth_security'
  | 'boundary_edge'
  | 'chained_flow';

export interface Endpoint {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  summary: string;
  description?: string;
  tags?: string[];
  headers?: Record<string, string>;
  queryParams?: Array<{ name: string; type: string; required: boolean; default?: string }>;
  requestBodySchema?: any;
  responseSchemaSample?: any;
  sourceSnippet?: string; // e.g. NestJS @Controller snippet
}

export interface ChainedContext {
  sourceTestCaseId?: string;
  extractResponseKey?: string; // e.g. "accessToken" or "data.id"
  injectIntoHeader?: string;   // e.g. "Authorization" (Bearer {{val}})
  injectIntoParam?: string;    // e.g. ":id"
  injectIntoBodyKey?: string;  // e.g. "userId"
  extractions?: Array<{ key: string; fromPath: string }>;
  injections?: Array<{ target: 'header' | 'param' | 'body'; key: string; valueTemplate: string }>;
}

export interface TestStep {
  id: string;
  name: string;
  description?: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  body?: any;
  assertions: {
    expectedStatuses: number[];
    requiredBodyKeys?: string[];
    schemaValidations?: string[];
    forbiddenBodyKeys?: string[];
    maxLatencyMs?: number;
  };
  chainedContext?: ChainedContext;
}

export interface TestCase {
  id: string;
  endpointId: string;
  name: string;
  category: TestCaseCategory;
  description: string;
  folderPath?: string; // e.g. "/Auth Module/Login", "/Order Fulfillment/E2E Checkout"
  dependsOn?: string[]; // IDs of prerequisite test cases that must succeed before this test
  stepNumber?: number; // Ordering for E2E flows
  request: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    headers?: Record<string, string>;
    queryParams?: Record<string, string>;
    body?: any;
  };
  assertions: {
    expectedStatuses: number[];
    requiredBodyKeys?: string[];
    schemaValidations?: string[];
    forbiddenBodyKeys?: string[];
    maxLatencyMs?: number;
  };
  chainedContext?: ChainedContext;
  steps?: TestStep[]; // Sequential steps for multi-step / E2E pipeline workflows
}

export interface AssertionResult {
  name: string;
  passed: boolean;
  message: string;
  actual?: any;
  expected?: any;
}

export interface AiDiagnosis {
  rootCause: string;
  backendContext: string; // e.g., NestJS ValidationPipe or JwtAuthGuard issue
  suggestedFix: string;
  sampleCodeFix?: string;
}

export interface ExecutionLogEntry {
  time: string;
  level: 'info' | 'warn' | 'error' | 'pass' | 'step';
  message: string;
  details?: any;
}

export interface TestRunExecution {
  id: string;
  testCaseId: string;
  endpointId: string;
  testCaseName: string;
  category: TestCaseCategory;
  folderPath?: string;
  status: 'passed' | 'failed' | 'running';
  httpStatus: number;
  latencyMs: number;
  requestSent: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: any;
  };
  responseReceived: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: any;
  };
  assertionResults: AssertionResult[];
  extractedVariables?: Record<string, any>;
  logs?: ExecutionLogEntry[];
  aiDiagnosis?: AiDiagnosis;
  timestamp: number;
}

export interface TestSuiteReport {
  id: string;
  projectId: string;
  runAt: number;
  totalTests: number;
  passed: number;
  failed: number;
  passRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  maxLatencyMs: number;
  statusDistribution: Record<string, number>;
  runs: TestRunExecution[];
  summaryNotes?: string;
}

export interface ExplorationProbeStep {
  stepNumber: number;
  name: string;
  method: string;
  path: string;
  intent: string;
  payloadSent?: any;
  httpStatus: number;
  latencyMs: number;
  findingType: 'clean' | 'anomaly' | 'vulnerability' | 'edge_case_fail';
  findingDetail: string;
}

export interface ExplorationSession {
  id: string;
  projectId: string;
  timestamp: number;
  status: 'idle' | 'running' | 'completed' | 'failed';
  totalProbes: number;
  anomaliesFound: number;
  vulnerabilitiesFound: number;
  healthScore: number; // 0-100
  steps: ExplorationProbeStep[];
  aiExecutiveSummary: string;
  actionableRecommendations: string[];
}

export interface Project {
  id: string;
  name: string;
  description: string;
  stack: TechStack;
  baseUrl: string;
  defaultHeaders: Record<string, string>;
  envVars: Record<string, string>;
  endpoints: Endpoint[];
  testCases: TestCase[];
  latestReport?: TestSuiteReport;
  reportsHistory?: TestSuiteReport[];
  latestExploration?: ExplorationSession;
  createdAt: number;
  updatedAt: number;
}
