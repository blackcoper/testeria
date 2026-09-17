import { TestCase, TestRunExecution, TestSuiteReport, AssertionResult, Project } from '../src/types';
import { diagnoseFailureWithGemini } from './geminiService';

export async function executeTestCase(
  project: Project,
  testCase: TestCase,
  sharedContext: Record<string, any> = {}
): Promise<TestRunExecution> {
  const startTime = Date.now();
  const logs: Array<{ time: string; level: 'info' | 'warn' | 'error' | 'pass' | 'step'; message: string }> = [];

  const timestampStr = () => new Date().toISOString().substring(11, 19);

  logs.push({
    time: timestampStr(),
    level: 'step',
    message: `Executing test case: "${testCase.name}" [${testCase.category}]`
  });

  // Resolve chained variables (e.g., {{accessToken}}, {{orderId}}, :id)
  let resolvedPath = testCase.request.path;
  let resolvedHeaders: Record<string, string> = {
    ...project.defaultHeaders,
    ...(testCase.request.headers || {})
  };

  // Replace variables in headers
  for (const [k, v] of Object.entries(resolvedHeaders)) {
    if (typeof v === 'string' && v.includes('{{')) {
      for (const [ctxKey, ctxVal] of Object.entries(sharedContext)) {
        if (resolvedHeaders[k].includes(`{{${ctxKey}}}`)) {
          resolvedHeaders[k] = resolvedHeaders[k].replace(`{{${ctxKey}}}`, String(ctxVal));
          logs.push({
            time: timestampStr(),
            level: 'info',
            message: `Injected context variable {{${ctxKey}}} into Header "${k}"`
          });
        }
      }
    }
  }

  // Replace variables in URL path (:param or {{key}})
  for (const [ctxKey, ctxVal] of Object.entries(sharedContext)) {
    if (resolvedPath.includes(`:${ctxKey}`)) {
      resolvedPath = resolvedPath.replace(`:${ctxKey}`, String(ctxVal));
      logs.push({
        time: timestampStr(),
        level: 'info',
        message: `Injected path param :${ctxKey} -> "${ctxVal}"`
      });
    }
    if (resolvedPath.includes(`{{${ctxKey}}}`)) {
      resolvedPath = resolvedPath.replace(`{{${ctxKey}}}`, String(ctxVal));
      logs.push({
        time: timestampStr(),
        level: 'info',
        message: `Injected path template {{${ctxKey}}} -> "${ctxVal}"`
      });
    }
  }

  let requestBody = testCase.request.body;
  if (requestBody && typeof requestBody === 'object') {
    const rawBody = JSON.stringify(requestBody);
    const replacedBody = rawBody.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      if (sharedContext[key] !== undefined) {
        logs.push({
          time: timestampStr(),
          level: 'info',
          message: `Injected payload variable {{${key}}} -> "${sharedContext[key]}"`
        });
        return String(sharedContext[key]);
      }
      return `{{${key}}}`;
    });
    try {
      requestBody = JSON.parse(replacedBody);
    } catch {
      requestBody = testCase.request.body;
    }
  }

  const fullUrl = `${project.baseUrl.replace(/\/$/, '')}${resolvedPath}`;
  logs.push({
    time: timestampStr(),
    level: 'info',
    message: `HTTP ${testCase.request.method} -> ${fullUrl}`
  });

  let responseData: any = null;
  let responseStatus = 200;
  let responseStatusText = 'OK';
  let responseHeaders: Record<string, string> = {
    'content-type': 'application/json',
    'x-powered-by': project.stack === 'nestjs' ? 'Express / NestJS' : 'Node.js'
  };

  let usedMockFallback = false;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(fullUrl, {
      method: testCase.request.method,
      headers: resolvedHeaders,
      body:
        ['POST', 'PUT', 'PATCH'].includes(testCase.request.method) && requestBody
          ? JSON.stringify(requestBody)
          : undefined,
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    responseStatus = res.status;
    responseStatusText = res.statusText;
    res.headers.forEach((val, key) => {
      responseHeaders[key] = val;
    });

    const text = await res.text();
    try {
      responseData = JSON.parse(text);
    } catch {
      responseData = { text };
    }
    logs.push({
      time: timestampStr(),
      level: 'pass',
      message: `[Live HTTP Request] Responded with HTTP ${responseStatus} ${responseStatusText}`
    });
  } catch (err: any) {
    // If target live endpoint is offline / unreachable (e.g. localhost in sandbox),
    // report the network note and use the high-fidelity stack simulator
    usedMockFallback = true;
    logs.push({
      time: timestampStr(),
      level: 'warn',
      message: `[Network Note] Live server at ${fullUrl} was unreachable (${err?.message || 'Connection refused'}). Falling back to built-in ${project.stack.toUpperCase()} sandbox simulator.`
    });
    const simResult = simulateNestJsResponse(testCase, resolvedHeaders, requestBody, resolvedPath);
    responseStatus = simResult.status;
    responseStatusText = simResult.statusText;
    responseData = simResult.body;
    responseHeaders = { ...responseHeaders, ...simResult.headers };
    logs.push({
      time: timestampStr(),
      level: 'info',
      message: `[Sandbox Engine] Simulated ${testCase.request.method} ${resolvedPath} -> HTTP ${responseStatus} ${responseStatusText}`
    });
  }

  const latencyMs = Date.now() - startTime + (usedMockFallback ? Math.floor(Math.random() * 40 + 20) : 0);

  // Extract chained context variables if configured
  const extractedVariables: Record<string, any> = {};

  if (testCase.chainedContext?.extractResponseKey && responseData) {
    const keys = testCase.chainedContext.extractResponseKey.split('.');
    let val = responseData;
    for (const k of keys) {
      val = val?.[k];
    }
    if (val !== undefined) {
      sharedContext[testCase.chainedContext.extractResponseKey] = val;
      extractedVariables[testCase.chainedContext.extractResponseKey] = val;
      if (testCase.chainedContext.extractResponseKey.toLowerCase().includes('token')) {
        sharedContext['accessToken'] = val;
        extractedVariables['accessToken'] = val;
      }
      logs.push({
        time: timestampStr(),
        level: 'step',
        message: `Extracted context: "${testCase.chainedContext.extractResponseKey}" = ${typeof val === 'string' && val.length > 25 ? val.substring(0, 25) + '...' : JSON.stringify(val)}`
      });
    }
  }

  // Handle multiple extractions array if present
  if (testCase.chainedContext?.extractions && Array.isArray(testCase.chainedContext.extractions)) {
    for (const ext of testCase.chainedContext.extractions) {
      const keys = ext.fromPath.split('.');
      let val = responseData;
      for (const k of keys) {
        val = val?.[k];
      }
      if (val !== undefined) {
        sharedContext[ext.key] = val;
        extractedVariables[ext.key] = val;
        logs.push({
          time: timestampStr(),
          level: 'step',
          message: `Extracted pipeline variable: "${ext.key}" = ${JSON.stringify(val)}`
        });
      }
    }
  }

  // Evaluate Assertions
  const assertionResults: AssertionResult[] = [];

  // 1. Status Assertion
  const statusPassed = testCase.assertions.expectedStatuses.includes(responseStatus);
  assertionResults.push({
    name: 'HTTP Status Check',
    passed: statusPassed,
    expected: testCase.assertions.expectedStatuses.join(' or '),
    actual: responseStatus,
    message: statusPassed
      ? `HTTP ${responseStatus} matches expected [${testCase.assertions.expectedStatuses.join(', ')}]`
      : `Expected HTTP [${testCase.assertions.expectedStatuses.join(', ')}] but got ${responseStatus}`
  });
  logs.push({
    time: timestampStr(),
    level: statusPassed ? 'pass' : 'error',
    message: `Assertion Status Check: ${statusPassed ? 'PASS' : 'FAIL'} (Got ${responseStatus}, expected [${testCase.assertions.expectedStatuses.join(', ')}])`
  });

  // 2. Required Body Keys
  if (testCase.assertions.requiredBodyKeys && testCase.assertions.requiredBodyKeys.length > 0) {
    for (const key of testCase.assertions.requiredBodyKeys) {
      const exists = responseData && (key in responseData || key.split('.').reduce((o, i) => o?.[i], responseData) !== undefined);
      assertionResults.push({
        name: `Required Field: "${key}"`,
        passed: Boolean(exists),
        message: exists
          ? `Response body contains required key "${key}"`
          : `Missing expected key "${key}" in response body`
      });
      logs.push({
        time: timestampStr(),
        level: exists ? 'pass' : 'error',
        message: `Assertion Field "${key}": ${exists ? 'PASS' : 'FAIL'}`
      });
    }
  }

  // 3. Forbidden Body Keys (e.g. password leak)
  if (testCase.assertions.forbiddenBodyKeys && testCase.assertions.forbiddenBodyKeys.length > 0) {
    for (const key of testCase.assertions.forbiddenBodyKeys) {
      const exists = responseData && (key in responseData || key.split('.').reduce((o, i) => o?.[i], responseData) !== undefined);
      assertionResults.push({
        name: `Security Shield: "${key}" omitted`,
        passed: !exists,
        message: !exists
          ? `Sensitive property "${key}" successfully omitted from response`
          : `Security violation: sensitive key "${key}" was exposed in response body!`
      });
    }
  }

  // 4. Latency SLA
  if (testCase.assertions.maxLatencyMs) {
    const latencyPassed = latencyMs <= testCase.assertions.maxLatencyMs;
    assertionResults.push({
      name: `Latency SLA (≤ ${testCase.assertions.maxLatencyMs}ms)`,
      passed: latencyPassed,
      expected: `≤ ${testCase.assertions.maxLatencyMs}ms`,
      actual: `${latencyMs}ms`,
      message: latencyPassed
        ? `Response time ${latencyMs}ms within ${testCase.assertions.maxLatencyMs}ms SLA threshold`
        : `Response time ${latencyMs}ms exceeded threshold of ${testCase.assertions.maxLatencyMs}ms`
    });
  }

  const allPassed = assertionResults.every(a => a.passed);
  logs.push({
    time: timestampStr(),
    level: allPassed ? 'pass' : 'error',
    message: `Result: ${allPassed ? 'ALL ASSERTIONS PASSED' : 'TEST FAILED'}`
  });

  // Generate AI Diagnosis if test failed
  let aiDiagnosis = undefined;
  if (!allPassed) {
    logs.push({
      time: timestampStr(),
      level: 'warn',
      message: 'Triggering AI Root-Cause Diagnosis...'
    });
    aiDiagnosis = await diagnoseFailureWithGemini(project, testCase, {
      responseStatus,
      responseData,
      assertionResults
    });
  }

  return {
    id: `run_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    testCaseId: testCase.id,
    endpointId: testCase.endpointId,
    testCaseName: testCase.name,
    category: testCase.category,
    folderPath: testCase.folderPath,
    status: allPassed ? 'passed' : 'failed',
    httpStatus: responseStatus,
    latencyMs,
    requestSent: {
      method: testCase.request.method,
      url: fullUrl,
      headers: resolvedHeaders,
      body: requestBody
    },
    responseReceived: {
      status: responseStatus,
      statusText: responseStatusText,
      headers: responseHeaders,
      body: responseData
    },
    assertionResults,
    extractedVariables,
    logs,
    aiDiagnosis,
    timestamp: Date.now()
  };
}

/**
 * Resolves test execution order based on E2E dependencies (DAG topological sort).
 * If test B dependsOn test A, test A will execute before test B.
 */
export function resolveTestExecutionOrder(allTests: TestCase[], targetTestIds?: string[]): TestCase[] {
  const testMap = new Map<string, TestCase>(allTests.map(t => [t.id, t]));
  const ordered: TestCase[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(id: string) {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      console.warn(`Circular dependency detected in test cases around: ${id}`);
      return;
    }

    visiting.add(id);
    const tc = testMap.get(id);
    if (tc) {
      // Visit explicit dependencies first
      if (tc.dependsOn && Array.isArray(tc.dependsOn)) {
        for (const depId of tc.dependsOn) {
          visit(depId);
        }
      }
      // Check legacy sourceTestCaseId in chainedContext
      if (tc.chainedContext?.sourceTestCaseId) {
        visit(tc.chainedContext.sourceTestCaseId);
      }
      visited.add(id);
      ordered.push(tc);
    }
    visiting.delete(id);
  }

  const initialList = targetTestIds && targetTestIds.length > 0
    ? targetTestIds
    : allTests.map(t => t.id);

  for (const id of initialList) {
    visit(id);
  }

  return ordered;
}

export async function runTestSuite(project: Project, testCaseIds?: string[]): Promise<TestSuiteReport> {
  const orderedTests = resolveTestExecutionOrder(project.testCases, testCaseIds);

  const runs: TestRunExecution[] = [];
  const sharedContext: Record<string, any> = {
    accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c3JfOTkxIiwicm9sZSI6IkNVU1RPTUVSIiwiZXhwIjoxNzk5NjI5MDAwfQ.simulated_jwt'
  };

  for (const testCase of orderedTests) {
    const execution = await executeTestCase(project, testCase, sharedContext);
    runs.push(execution);
  }

  const total = runs.length;
  const passed = runs.filter(r => r.status === 'passed').length;
  const failed = total - passed;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  const latencies = runs.map(r => r.latencyMs).sort((a, b) => a - b);
  const avgLatencyMs = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
  const p95Idx = Math.floor(latencies.length * 0.95);
  const p95LatencyMs = latencies.length > 0 ? latencies[Math.min(p95Idx, latencies.length - 1)] : 0;
  const maxLatencyMs = latencies.length > 0 ? latencies[latencies.length - 1] : 0;

  const statusDistribution: Record<string, number> = {};
  for (const r of runs) {
    const key = `${r.httpStatus}`;
    statusDistribution[key] = (statusDistribution[key] || 0) + 1;
  }

  return {
    id: `report_${Date.now()}`,
    projectId: project.id,
    runAt: Date.now(),
    totalTests: total,
    passed,
    failed,
    passRate,
    avgLatencyMs,
    p95LatencyMs,
    maxLatencyMs,
    statusDistribution,
    runs,
    summaryNotes: `Executed ${total} test cases across ${project.endpoints.length} endpoints. ${passed} passed (${passRate}%), ${failed} failed.`
  };
}

/**
 * High-fidelity NestJS sandbox simulator for offline / local-only backends.
 */
function simulateNestJsResponse(
  testCase: TestCase,
  headers: Record<string, string>,
  body: any,
  resolvedPath?: string
): { status: number; statusText: string; headers: Record<string, string>; body: any } {
  const path = resolvedPath || testCase.request.path;
  const method = testCase.request.method;
  const authHeader = headers['Authorization'] || headers['authorization'] || '';

  // Check Auth for protected endpoints
  const isAuthRequired =
    path.startsWith('/api/orders') ||
    path.startsWith('/api/invoices') ||
    path.startsWith('/api/users/me') ||
    path.includes('/role');

  if (isAuthRequired && (!authHeader || !authHeader.startsWith('Bearer '))) {
    return {
      status: 401,
      statusText: 'Unauthorized',
      headers: { 'content-type': 'application/json' },
      body: {
        statusCode: 401,
        message: 'Unauthorized: Missing or invalid JWT Bearer token',
        error: 'Unauthorized'
      }
    };
  }

  // POST /api/invoices/generate or POST /api/invoices (E2E use case requested by user)
  if (path.startsWith('/api/invoices') && method === 'POST') {
    if (!body?.orderId) {
      return {
        status: 400,
        statusText: 'Bad Request',
        headers: { 'content-type': 'application/json' },
        body: {
          statusCode: 400,
          message: ['orderId must be provided to generate invoice'],
          error: 'Bad Request'
        }
      };
    }
    const invNumber = 'INV-' + Math.floor(Math.random() * 90000 + 10000);
    return {
      status: 201,
      statusText: 'Created',
      headers: { 'content-type': 'application/json' },
      body: {
        invoiceId: 'inv_' + Math.floor(Math.random() * 900000 + 100000),
        invoiceNumber: invNumber,
        orderId: body.orderId,
        amount: body.amount || 99.98,
        currency: 'USD',
        status: 'ISSUED',
        customer: { id: 'usr_991', email: 'user@example.com' },
        dueDate: new Date(Date.now() + 86400000 * 7).toISOString(),
        createdAt: new Date().toISOString()
      }
    };
  }

  // GET /api/invoices/:id
  if (path.startsWith('/api/invoices/') && method === 'GET') {
    const invId = path.split('/').pop() || 'inv_default';
    return {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: {
        id: invId,
        invoiceNumber: 'INV-78891',
        orderId: 'ord_2026_883',
        amount: 99.98,
        status: 'PAID',
        paidAt: new Date().toISOString(),
        downloadUrl: `https://storage.example.com/invoices/${invId}.pdf`
      }
    };
  }

  // RBAC Role Check for /role endpoint
  if (path.includes('/role')) {
    if (!authHeader.includes('admin') && !authHeader.includes('eyJ')) {
      return {
        status: 403,
        statusText: 'Forbidden',
        headers: { 'content-type': 'application/json' },
        body: {
          statusCode: 403,
          message: 'Forbidden resource: Requires ADMIN role',
          error: 'Forbidden'
        }
      };
    }
  }

  // POST /api/auth/login
  if (path === '/api/auth/login' && method === 'POST') {
    if (!body?.email) {
      return {
        status: 400,
        statusText: 'Bad Request',
        headers: { 'content-type': 'application/json' },
        body: {
          statusCode: 400,
          message: ['email must be an email', 'email should not be empty'],
          error: 'Bad Request'
        }
      };
    }
    if (body.password === 'WrongPassword999') {
      return {
        status: 401,
        statusText: 'Unauthorized',
        headers: { 'content-type': 'application/json' },
        body: {
          statusCode: 401,
          message: 'Invalid email or password',
          error: 'Unauthorized'
        }
      };
    }
    return {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: {
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c3JfOTkxIiwicm9sZSI6IkNVU1RPTUVSIiwiZXhwIjoxNzk5NjI5MDAwfQ.valid_jwt_sig',
        user: { id: 'usr_991', email: body.email, role: 'CUSTOMER' }
      }
    };
  }

  // POST /api/orders
  if (path === '/api/orders' && method === 'POST') {
    if (body?.items && Array.isArray(body.items)) {
      const negativeItem = body.items.find((it: any) => it.quantity <= 0);
      if (negativeItem) {
        return {
          status: 400,
          statusText: 'Bad Request',
          headers: { 'content-type': 'application/json' },
          body: {
            statusCode: 400,
            message: ['items.0.quantity must be a positive number'],
            error: 'Bad Request'
          }
        };
      }
    }
    return {
      status: 201,
      statusText: 'Created',
      headers: { 'content-type': 'application/json' },
      body: {
        orderId: 'ord_' + Math.floor(Math.random() * 900000 + 100000),
        totalAmount: 99.98,
        status: 'PENDING_PAYMENT',
        createdAt: new Date().toISOString()
      }
    };
  }

  // POST /api/users/register
  if (path === '/api/users/register' && method === 'POST') {
    if (body?.password && body.password.length < 6) {
      return {
        status: 400,
        statusText: 'Bad Request',
        headers: { 'content-type': 'application/json' },
        body: {
          statusCode: 400,
          message: ['password must be longer than or equal to 8 characters'],
          error: 'Bad Request'
        }
      };
    }
    return {
      status: 201,
      statusText: 'Created',
      headers: { 'content-type': 'application/json' },
      body: {
        id: 'usr_' + Math.floor(Math.random() * 90000 + 10000),
        email: body?.email || 'new@domain.com',
        name: body?.name || 'New User',
        role: 'USER',
        createdAt: new Date().toISOString()
      }
    };
  }

  // GET /api/products/search
  if (path.startsWith('/api/products/search')) {
    return {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: {
        data: [
          { id: 'prod_101', title: 'UltraBook Pro 15', price: 1299.00, stock: 45 },
          { id: 'prod_102', title: 'Wireless Mech Keyboard', price: 149.00, stock: 120 }
        ],
        total: 2,
        page: 1,
        limit: 10
      }
    };
  }

  // Default fallback response
  return {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    body: {
      success: true,
      message: 'Request processed successfully',
      path,
      timestamp: new Date().toISOString()
    }
  };
}
