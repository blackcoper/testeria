import React, { useState, useEffect, useRef } from 'react';
import { Project, TestCase, TestRunExecution, TestSuiteReport } from '../types';
import {
  Play,
  RotateCcw,
  Download,
  Video,
  FileText,
  Code2,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  Terminal,
  Layers,
  ArrowRight,
  ShieldCheck,
  Zap,
  Globe,
  FileCode,
  Link as LinkIcon,
  Sparkles
} from 'lucide-react';

interface LiveTestRunnerIframeProps {
  project: Project;
  onRunSingleTest: (testCaseId: string) => Promise<TestRunExecution>;
  onRunSuite: (testCaseIds?: string[]) => Promise<TestSuiteReport>;
  targetTestCaseId?: string | null;
  targetFolder?: string | null;
}

export const LiveTestRunnerIframe: React.FC<LiveTestRunnerIframeProps> = ({
  project,
  onRunSingleTest,
  onRunSuite,
  targetTestCaseId,
  targetFolder
}) => {
  const [activeTab, setActiveTab] = useState<'iframe' | 'network' | 'pipeline'>('iframe');
  const [isRunning, setIsRunning] = useState(false);
  const [currentRunningIndex, setCurrentRunningIndex] = useState<number>(-1);
  const [currentTest, setCurrentTest] = useState<TestCase | null>(null);
  const [latestExecutions, setLatestExecutions] = useState<TestRunExecution[]>(
    project.latestReport?.runs || []
  );
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'failed' | 'chained'>('all');

  const logsEndRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // Selected test run to inspect
  const activeRun = latestExecutions.find(r => r.id === selectedRunId) || latestExecutions[latestExecutions.length - 1] || null;

  // Filter test cases based on target or user selection
  const testsToRun = project.testCases.filter(tc => {
    if (targetFolder) {
      return tc.folderPath && tc.folderPath.startsWith(targetFolder);
    }
    if (filterMode === 'failed') {
      const run = latestExecutions.find(r => r.testCaseId === tc.id);
      return run && run.status === 'failed';
    }
    if (filterMode === 'chained') {
      return tc.category === 'chained_flow' || (tc.dependsOn && tc.dependsOn.length > 0);
    }
    return true;
  });

  // Start Video Recording using HTML5 Canvas & MediaRecorder
  const startRecordingCanvas = () => {
    try {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const stream = canvas.captureStream(25);
      recordedChunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        const videoUrl = URL.createObjectURL(blob);
        setRecordedVideoUrl(videoUrl);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (e) {
      console.warn('Canvas MediaRecorder not supported in this environment:', e);
    }
  };

  const stopRecordingCanvas = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  // Draw current runner state to canvas for video capture
  const drawFrameToCanvas = (testName: string, stepName: string, status: string, latency: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Canvas background
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Header bar
    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, canvas.width, 50);

    // Title
    ctx.font = 'bold 16px monospace';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText('TESTERIA AUTOMATION RUNNER', 20, 32);

    ctx.font = '12px monospace';
    ctx.fillStyle = '#a1a1aa';
    ctx.fillText(new Date().toLocaleTimeString(), canvas.width - 100, 32);

    // Active Test Box
    ctx.fillStyle = '#18181b';
    ctx.strokeStyle = status === 'passed' ? '#10b981' : status === 'failed' ? '#f43f5e' : '#3b82f6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(20, 70, canvas.width - 40, 90, 8);
    ctx.fill();
    ctx.stroke();

    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = '#f4f4f5';
    ctx.fillText(`Running: ${testName}`, 40, 100);

    ctx.font = '12px monospace';
    ctx.fillStyle = '#93c5fd';
    ctx.fillText(`Step: ${stepName}`, 40, 125);

    ctx.fillStyle = status === 'passed' ? '#34d399' : status === 'failed' ? '#fb7185' : '#fbbf24';
    ctx.fillText(`Status: ${status.toUpperCase()} (${latency}ms)`, 40, 145);

    // Terminal representation
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(20, 180, canvas.width - 40, 200);

    ctx.font = '11px monospace';
    ctx.fillStyle = '#22c55e';
    ctx.fillText('> [LOG] Resolving chained variables & dependencies...', 30, 210);
    ctx.fillText(`> [HTTP] Dispatching request with payload...`, 30, 235);
    ctx.fillText(`> [ASSERTION] Evaluating HTTP status & schema contracts...`, 30, 260);
    ctx.fillText(`> [RESULT] ${status === 'passed' ? 'PASS - All checks validated' : 'FAIL - Contract breached'}`, 30, 285);
  };

  const handleRunAll = async () => {
    setIsRunning(true);
    startRecordingCanvas();
    try {
      const idsToRun = targetTestCaseId ? [targetTestCaseId] : testsToRun.map(t => t.id);
      const report = await onRunSuite(idsToRun);
      setLatestExecutions(report.runs);
      if (report.runs.length > 0) {
        setSelectedRunId(report.runs[report.runs.length - 1].id);
      }
    } finally {
      setIsRunning(false);
      stopRecordingCanvas();
    }
  };

  const handleRunSingle = async (testCaseId: string) => {
    setIsRunning(true);
    startRecordingCanvas();
    try {
      const result = await onRunSingleTest(testCaseId);
      setLatestExecutions(prev => {
        const filtered = prev.filter(r => r.testCaseId !== testCaseId);
        return [...filtered, result];
      });
      setSelectedRunId(result.id);
      drawFrameToCanvas(result.testCaseName, 'Completed', result.status, result.latencyMs);
    } finally {
      setIsRunning(false);
      stopRecordingCanvas();
    }
  };

  // Generate interactive HTML document for the sandboxed <iframe>
  const generateIframeSrcDoc = (run: TestRunExecution | null) => {
    if (!run) {
      return `
        <!DOCTYPE html>
        <html>
          <head>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #09090b; color: #a1a1aa; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
              .box { border: 1px dashed #27272a; padding: 36px; border-radius: 12px; max-width: 440px; background: #18181b; }
              h3 { color: #fafafa; margin-top: 0; font-size: 16px; }
              p { font-size: 13px; line-height: 1.6; }
              .badge { display: inline-block; background: #27272a; color: #e4e4e7; padding: 4px 10px; border-radius: 6px; font-family: monospace; font-size: 11px; margin-top: 8px; }
            </style>
          </head>
          <body>
            <div class="box">
              <h3>⚡ Live iFrame Runner Standby</h3>
              <p>Ready to observe real-time simulated client-server execution. Click <strong>Run Entire Pipeline</strong> or launch an E2E test case from the left sidebar to stream live telemetry, DOM payloads, and assertion states.</p>
              <div class="badge">Awaiting Test Execution Trigger</div>
            </div>
          </body>
        </html>
      `;
    }

    const isLogin = run.requestSent.url.includes('/auth/login');
    const isOrder = run.requestSent.url.includes('/orders');
    const isInvoice = run.requestSent.url.includes('/invoices');

    const statusBadge = run.status === 'passed'
      ? `<span style="background: #065f46; color: #6ee7b7; padding: 4px 10px; border-radius: 9999px; font-weight: 600; font-size: 12px;">HTTP ${run.httpStatus} ${run.responseReceived.statusText}</span>`
      : `<span style="background: #881337; color: #fda4af; padding: 4px 10px; border-radius: 9999px; font-weight: 600; font-size: 12px;">HTTP ${run.httpStatus} ${run.responseReceived.statusText}</span>`;

    let customContentHtml = '';

    if (isLogin && run.responseReceived.body?.accessToken) {
      customContentHtml = `
        <div style="background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 20px; margin-top: 20px; text-align: left;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
            <div style="font-weight: 600; color: #38bdf8;">🔐 Authenticated Session Granted</div>
            <div style="font-size: 11px; background: #0369a1; color: #e0f2fe; padding: 2px 8px; rounded: 4px;">Role: ${run.responseReceived.body.user?.role || 'CUSTOMER'}</div>
          </div>
          <div style="font-size: 12px; color: #94a3b8; margin-bottom: 8px;">User: <strong>${run.responseReceived.body.user?.email || 'user@example.com'}</strong></div>
          <div style="background: #0f172a; padding: 10px; border-radius: 6px; font-family: monospace; font-size: 11px; word-break: break-all; color: #34d399;">
            ${run.responseReceived.body.accessToken}
          </div>
          <div style="font-size: 11px; color: #64748b; margin-top: 8px;">
            ✓ Token automatically captured and passed to dependent downstream requests in this E2E test pipeline.
          </div>
        </div>
      `;
    } else if (isOrder && run.responseReceived.body?.orderId) {
      customContentHtml = `
        <div style="background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 20px; margin-top: 20px; text-align: left;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
            <div style="font-weight: 600; color: #4ade80;">📦 Order Successfully Registered</div>
            <div style="font-size: 11px; background: #166534; color: #dcfce7; padding: 2px 8px; rounded: 4px;">${run.responseReceived.body.status || 'CREATED'}</div>
          </div>
          <div style="font-size: 13px; color: #f8fafc; font-family: monospace; margin-bottom: 6px;">Order Ref: <strong>${run.responseReceived.body.orderId}</strong></div>
          <div style="font-size: 13px; color: #94a3b8; margin-bottom: 12px;">Total: <strong>$${run.responseReceived.body.totalAmount || '1299.00'}</strong></div>
          <div style="background: #0f172a; padding: 12px; border-radius: 6px; font-size: 11px; color: #cbd5e1;">
            <div>Items Dispatched: UltraBook Pro 15 (Qty: 1)</div>
            <div style="color: #64748b; margin-top: 4px;">Shipping: Jakarta Central Fulfillment Hub</div>
          </div>
        </div>
      `;
    } else if (isInvoice && (run.responseReceived.body?.invoiceId || run.responseReceived.body?.id)) {
      const invId = run.responseReceived.body.invoiceId || run.responseReceived.body.id;
      const invNum = run.responseReceived.body.invoiceNumber || 'INV-2026-8821';
      customContentHtml = `
        <div style="background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 20px; margin-top: 20px; text-align: left;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
            <div style="font-weight: 600; color: #a855f7;">🧾 Official Invoice Issued & Linked</div>
            <div style="font-size: 11px; background: #581c87; color: #f3e8ff; padding: 2px 8px; rounded: 4px;">${invNum}</div>
          </div>
          <div style="font-size: 12px; color: #94a3b8; margin-bottom: 6px;">Linked Order ID: <strong style="color: #f1f5f9;">${run.responseReceived.body.orderId || 'ord_9921'}</strong></div>
          <div style="font-size: 12px; color: #94a3b8; margin-bottom: 12px;">Amount Due / Paid: <strong style="color: #34d399;">$${run.responseReceived.body.amount || '1299.00'}</strong></div>
          <div style="display: flex; gap: 10px; margin-top: 14px;">
            <div style="background: #0f172a; border: 1px solid #334155; padding: 8px 14px; border-radius: 6px; font-size: 11px; color: #38bdf8; display: inline-flex; align-items: center; gap: 6px;">
              📄 ${run.responseReceived.body.downloadUrl ? 'PDF Receipt Ready' : 'Downloadable Receipt Generated'}
            </div>
            <div style="background: #0f172a; border: 1px solid #334155; padding: 8px 14px; border-radius: 6px; font-size: 11px; color: #10b981;">
              ✓ Verification Signature Valid
            </div>
          </div>
        </div>
      `;
    } else {
      customContentHtml = `
        <div style="background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 20px; margin-top: 20px; text-align: left;">
          <div style="font-weight: 600; color: #94a3b8; margin-bottom: 8px; font-size: 12px;">Raw JSON Response Body</div>
          <pre style="background: #0f172a; padding: 12px; border-radius: 6px; color: #f8fafc; font-size: 11px; overflow-x: auto; margin: 0;">${JSON.stringify(run.responseReceived.body, null, 2)}</pre>
        </div>
      `;
    }

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
              background: #090d16;
              color: #f8fafc;
              margin: 0;
              padding: 24px;
              box-sizing: border-box;
            }
            .header-bar {
              display: flex;
              align-items: center;
              justify-content: space-between;
              padding-bottom: 16px;
              border-bottom: 1px solid #1e293b;
            }
            .url-box {
              font-family: monospace;
              font-size: 12px;
              color: #94a3b8;
              background: #0f172a;
              padding: 6px 12px;
              border-radius: 6px;
              border: 1px solid #1e293b;
            }
            .latency-pill {
              font-size: 11px;
              color: #64748b;
              font-family: monospace;
            }
            .assertions-list {
              margin-top: 20px;
              display: grid;
              gap: 8px;
            }
            .assertion-item {
              background: #0f172a;
              border: 1px solid #1e293b;
              border-radius: 6px;
              padding: 8px 12px;
              font-size: 12px;
              display: flex;
              align-items: center;
              justify-content: space-between;
            }
            .pass { color: #34d399; }
            .fail { color: #f87171; }
          </style>
        </head>
        <body>
          <div class="header-bar">
            <div>
              <div style="font-size: 15px; font-weight: 600; color: #f8fafc; margin-bottom: 4px;">
                ${run.testCaseName}
              </div>
              <div class="url-box">
                <strong style="color: #38bdf8;">${run.requestSent.method}</strong> ${run.requestSent.url}
              </div>
            </div>
            <div style="text-align: right;">
              ${statusBadge}
              <div class="latency-pill" style="margin-top: 4px;">Latency: ${run.latencyMs}ms</div>
            </div>
          </div>

          ${customContentHtml}

          <div style="margin-top: 24px;">
            <div style="font-size: 12px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">
              Assertions & Contract Verification (${run.assertionResults.filter(a => a.passed).length}/${run.assertionResults.length})
            </div>
            <div class="assertions-list">
              ${run.assertionResults.map(a => `
                <div class="assertion-item">
                  <span>${a.name}</span>
                  <span class="${a.passed ? 'pass' : 'fail'}">${a.passed ? '✓ PASSED' : '✕ FAILED'}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </body>
      </html>
    `;
  };

  // Download complete artifact bundle (HTML report + logs + JSON)
  const downloadArtifactBundle = () => {
    if (!activeRun) return;

    // 1. Raw text log
    const logContent = (activeRun.logs || []).map(l => `[${l.time}] [${l.level.toUpperCase()}] ${l.message}`).join('\n');
    const logBlob = new Blob([logContent], { type: 'text/plain' });
    const logUrl = URL.createObjectURL(logBlob);
    const a = document.createElement('a');
    a.href = logUrl;
    a.download = `test-execution-${activeRun.testCaseId}.log`;
    a.click();

    // 2. Standalone HTML Artifact
    const htmlReport = generateIframeSrcDoc(activeRun);
    const htmlBlob = new Blob([htmlReport], { type: 'text/html' });
    const htmlUrl = URL.createObjectURL(htmlBlob);
    const aHtml = document.createElement('a');
    aHtml.href = htmlUrl;
    aHtml.download = `test-artifact-${activeRun.testCaseId}.html`;
    aHtml.click();
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 text-zinc-200 overflow-hidden">
      {/* Hidden canvas for live video capture */}
      <canvas ref={canvasRef} width={800} height={450} className="hidden" />

      {/* Top Action & Telemetry Bar */}
      <div className="h-14 border-b border-zinc-800 bg-zinc-900/90 px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-3">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-semibold text-sm text-zinc-100">Live Test Runner & iFrame Stage</span>
          </div>

          <div className="flex items-center bg-zinc-800/80 border border-zinc-700/60 rounded-md p-0.5 text-xs">
            <button
              onClick={() => setFilterMode('all')}
              className={`px-2.5 py-1 rounded transition-colors ${filterMode === 'all' ? 'bg-zinc-700 text-zinc-100 font-medium' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              All ({project.testCases.length})
            </button>
            <button
              onClick={() => setFilterMode('chained')}
              className={`px-2.5 py-1 rounded transition-colors ${filterMode === 'chained' ? 'bg-blue-600/30 text-blue-300 font-medium' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              E2E Pipelines
            </button>
            <button
              onClick={() => setFilterMode('failed')}
              className={`px-2.5 py-1 rounded transition-colors ${filterMode === 'failed' ? 'bg-rose-500/20 text-rose-300 font-medium' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              Failed Only
            </button>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* Artifact & Video Export Buttons */}
          {recordedVideoUrl && (
            <a
              href={recordedVideoUrl}
              download="test-run-recording.webm"
              className="px-2.5 py-1.5 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 rounded text-xs font-medium flex items-center gap-1.5 transition-colors"
            >
              <Video className="w-3.5 h-3.5" />
              <span>Download Video</span>
            </a>
          )}

          {activeRun && (
            <button
              onClick={downloadArtifactBundle}
              title="Download execution logs, HTML report and evidence"
              className="px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 rounded text-xs font-medium flex items-center gap-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-zinc-400" />
              <span>Export Artifacts (.log / .html)</span>
            </button>
          )}

          <button
            onClick={handleRunAll}
            disabled={isRunning}
            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-semibold flex items-center gap-1.5 shadow-lg shadow-emerald-900/20 transition-all disabled:opacity-50"
          >
            {isRunning ? (
              <>
                <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                <span>Running Suite...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Run Entire Pipeline</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Split Layout: Left Pipeline Sequence & Runs, Right Visual iFrame + Logs */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column: Sequence of Test Cases in Pipeline */}
        <div className="w-80 border-r border-zinc-800 bg-zinc-900/40 flex flex-col overflow-hidden">
          <div className="p-2.5 border-b border-zinc-800 flex items-center justify-between text-xs text-zinc-400">
            <span className="font-semibold uppercase tracking-wider text-[11px]">Execution Queue</span>
            <span className="font-mono text-[11px] text-zinc-500">{testsToRun.length} steps</span>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1.5 custom-scrollbar">
            {testsToRun.map((tc, idx) => {
              const run = latestExecutions.find(r => r.testCaseId === tc.id);
              const isSelected = activeRun?.testCaseId === tc.id;
              const hasPrereq = tc.dependsOn && tc.dependsOn.length > 0;

              return (
                <div
                  key={tc.id}
                  onClick={() => run && setSelectedRunId(run.id)}
                  className={`p-2.5 rounded-lg border text-xs cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-zinc-800/90 border-blue-500/80 shadow-md'
                      : 'bg-zinc-900/80 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-850'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center space-x-1.5 truncate">
                      <span className="font-mono text-[10px] text-zinc-500 bg-zinc-800 px-1 py-0.2 rounded">
                        #{idx + 1}
                      </span>
                      <span className={`text-[9px] font-mono font-bold px-1 py-0.2 rounded ${
                        tc.request.method === 'GET' ? 'bg-blue-500/20 text-blue-400' :
                        tc.request.method === 'POST' ? 'bg-emerald-500/20 text-emerald-400' :
                        'bg-amber-500/20 text-amber-400'
                      }`}>
                        {tc.request.method}
                      </span>
                      <span className="font-medium text-zinc-200 truncate text-[12px]">{tc.name}</span>
                    </div>

                    <button
                      title="Run this specific test"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRunSingle(tc.id);
                      }}
                      className="p-1 hover:bg-emerald-500/20 hover:text-emerald-400 rounded text-zinc-400 ml-1"
                    >
                      <Play className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="text-[11px] font-mono text-zinc-400 truncate mb-1.5">
                    {tc.request.path}
                  </div>

                  {hasPrereq && (
                    <div className="flex items-center gap-1 text-[10px] text-zinc-500 mb-1 font-mono">
                      <LinkIcon className="w-2.5 h-2.5 text-blue-400" />
                      <span>Prerequisite: {tc.dependsOn?.[0]}</span>
                    </div>
                  )}

                  {run ? (
                    <div className="flex items-center justify-between pt-1 border-t border-zinc-800/80 text-[10px]">
                      <span className={`flex items-center gap-1 font-medium ${
                        run.status === 'passed' ? 'text-emerald-400' : 'text-rose-400'
                      }`}>
                        {run.status === 'passed' ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : (
                          <XCircle className="w-3 h-3" />
                        )}
                        <span>HTTP {run.httpStatus}</span>
                      </span>
                      <span className="text-zinc-500 font-mono">{run.latencyMs}ms</span>
                    </div>
                  ) : (
                    <div className="text-[10px] text-zinc-600 flex items-center gap-1 pt-1 border-t border-zinc-800/80">
                      <Clock className="w-3 h-3" />
                      <span>Pending execution</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Main Stage: Browser Chrome with iFrame + Live Logs */}
        <div className="flex-1 flex flex-col overflow-hidden bg-zinc-950">
          {/* Browser Address Bar & Tab Switcher */}
          <div className="h-11 border-b border-zinc-800 bg-zinc-900/60 px-4 flex items-center justify-between shrink-0">
            <div className="flex items-center space-x-2 flex-1 max-w-2xl">
              <div className="flex items-center space-x-1.5 text-zinc-500">
                <div className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
                <div className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
                <div className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
              </div>

              {/* URL Address Bar */}
              <div className="flex-1 flex items-center bg-zinc-950/80 border border-zinc-800 rounded px-2.5 py-1 text-xs text-zinc-300 font-mono truncate">
                <Globe className="w-3 h-3 text-zinc-500 mr-2 shrink-0" />
                <span className="text-zinc-500 mr-1.5">
                  {project.baseUrl.replace(/\/$/, '')}
                </span>
                <span className="text-blue-400 font-medium truncate">
                  {activeRun?.requestSent?.url?.replace(project.baseUrl, '') || '/api/...'}
                </span>
              </div>
            </div>

            {/* Viewport Tabs */}
            <div className="flex items-center bg-zinc-800/60 border border-zinc-700/60 rounded p-0.5 text-xs ml-4">
              <button
                onClick={() => setActiveTab('iframe')}
                className={`px-2.5 py-1 rounded flex items-center gap-1.5 transition-colors ${
                  activeTab === 'iframe' ? 'bg-zinc-700 text-zinc-100 font-medium' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Globe className="w-3 h-3" />
                <span>Client iFrame</span>
              </button>
              <button
                onClick={() => setActiveTab('network')}
                className={`px-2.5 py-1 rounded flex items-center gap-1.5 transition-colors ${
                  activeTab === 'network' ? 'bg-zinc-700 text-zinc-100 font-medium' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Code2 className="w-3 h-3" />
                <span>Network Inspector</span>
              </button>
              <button
                onClick={() => setActiveTab('pipeline')}
                className={`px-2.5 py-1 rounded flex items-center gap-1.5 transition-colors ${
                  activeTab === 'pipeline' ? 'bg-zinc-700 text-zinc-100 font-medium' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Layers className="w-3 h-3" />
                <span>E2E Pipeline Diagram</span>
              </button>
            </div>
          </div>

          {/* Center Stage: Rendered Content */}
          <div className="flex-1 overflow-hidden relative">
            {activeTab === 'iframe' && (
              <iframe
                title="Live Test Execution Webview"
                srcDoc={generateIframeSrcDoc(activeRun)}
                sandbox="allow-scripts allow-same-origin"
                className="w-full h-full border-none bg-zinc-950"
              />
            )}

            {activeTab === 'network' && (
              <div className="w-full h-full p-4 overflow-y-auto custom-scrollbar space-y-4 text-xs font-mono">
                {activeRun ? (
                  <>
                    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
                      <div className="font-semibold text-zinc-300 mb-2 flex items-center justify-between">
                        <span>Request Headers & Payload</span>
                        <span className="text-zinc-500">{activeRun.requestSent.method} {activeRun.requestSent.url}</span>
                      </div>
                      <div className="text-[11px] text-zinc-400 mb-2">
                        {Object.entries(activeRun.requestSent.headers).map(([k, v]) => (
                          <div key={k} className="truncate">
                            <span className="text-zinc-500">{k}:</span> {v}
                          </div>
                        ))}
                      </div>
                      {activeRun.requestSent.body && (
                        <div className="mt-2 bg-zinc-950 p-2.5 rounded border border-zinc-800 text-zinc-300">
                          <pre className="overflow-x-auto">{JSON.stringify(activeRun.requestSent.body, null, 2)}</pre>
                        </div>
                      )}
                    </div>

                    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
                      <div className="font-semibold text-zinc-300 mb-2 flex items-center justify-between">
                        <span>Response Payload</span>
                        <span className={`px-1.5 py-0.5 rounded font-mono text-[10px] ${
                          activeRun.status === 'passed' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                        }`}>
                          HTTP {activeRun.httpStatus} {activeRun.responseReceived.statusText}
                        </span>
                      </div>
                      <div className="bg-zinc-950 p-2.5 rounded border border-zinc-800 text-zinc-300">
                        <pre className="overflow-x-auto">{JSON.stringify(activeRun.responseReceived.body, null, 2)}</pre>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-center text-zinc-500 py-12">
                    No run selected. Execute tests to inspect network payloads.
                  </div>
                )}
              </div>
            )}

            {activeTab === 'pipeline' && (
              <div className="w-full h-full p-6 overflow-y-auto custom-scrollbar">
                <div className="max-w-3xl mx-auto space-y-4">
                  <div className="text-xs text-zinc-400 mb-2">
                    Dependency-aware E2E Pipeline graph automatically passes authentication tokens, IDs, and state downstream:
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3 relative">
                    {testsToRun.slice(0, 4).map((tc, idx) => {
                      const run = latestExecutions.find(r => r.testCaseId === tc.id);
                      return (
                        <div
                          key={tc.id}
                          className={`p-3 rounded-lg border text-xs relative ${
                            run?.status === 'passed'
                              ? 'bg-emerald-950/20 border-emerald-500/40 text-emerald-200'
                              : run?.status === 'failed'
                              ? 'bg-rose-950/20 border-rose-500/40 text-rose-200'
                              : 'bg-zinc-900 border-zinc-800 text-zinc-300'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1 text-[10px] font-mono text-zinc-500">
                            <span>Step {idx + 1}</span>
                            <span>{tc.request.method}</span>
                          </div>
                          <div className="font-semibold text-[12px] truncate mb-1">{tc.name}</div>
                          <div className="text-[10px] font-mono text-zinc-400 truncate mb-2">{tc.request.path}</div>
                          {run && (
                            <div className="text-[10px] font-mono flex items-center justify-between border-t border-zinc-800/80 pt-1">
                              <span>HTTP {run.httpStatus}</span>
                              <span>{run.latencyMs}ms</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Streaming Terminal / Logs Area */}
          <div className="h-44 border-t border-zinc-800 bg-zinc-950 flex flex-col shrink-0">
            <div className="h-7 bg-zinc-900/80 px-3 border-b border-zinc-800 flex items-center justify-between text-[11px] text-zinc-400">
              <div className="flex items-center gap-1.5 font-mono">
                <Terminal className="w-3 h-3 text-zinc-400" />
                <span>EXECUTION CONSOLE & ARTIFACT LOGS</span>
              </div>
              <div className="text-[10px] font-mono text-zinc-500">
                {activeRun?.logs?.length || 0} entries
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2.5 font-mono text-[11px] leading-relaxed custom-scrollbar space-y-1">
              {activeRun?.logs && activeRun.logs.length > 0 ? (
                activeRun.logs.map((log, i) => (
                  <div key={i} className="flex items-start space-x-2">
                    <span className="text-zinc-600 shrink-0 select-none">[{log.time}]</span>
                    <span className={`shrink-0 font-bold ${
                      log.level === 'pass' ? 'text-emerald-400' :
                      log.level === 'error' ? 'text-rose-400' :
                      log.level === 'step' ? 'text-blue-400' :
                      log.level === 'warn' ? 'text-amber-400' : 'text-zinc-400'
                    }`}>
                      [{log.level.toUpperCase()}]
                    </span>
                    <span className="text-zinc-300 break-all">{log.message}</span>
                  </div>
                ))
              ) : (
                <div className="text-zinc-600 italic">
                  Run test cases to view streaming execution traces, parameter injections, and assertion verification logs.
                </div>
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
