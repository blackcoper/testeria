import React, { useState } from 'react';
import { Project, Endpoint, TestCase } from '../types';
import {
  Sparkles,
  FileCode2,
  Send,
  CheckCircle,
  PlusCircle,
  AlertCircle,
  ArrowRight,
  Layers,
  Code2
} from 'lucide-react';

interface AiGeneratorViewProps {
  project: Project;
  onImportEndpoints: (rawContent: string) => Promise<Endpoint[]>;
  onGenerateTests: (endpointIds: string[], instructions: string) => Promise<TestCase[]>;
  onNavigateToTestCases: () => void;
}

const NESTJS_ORDERS_CONTROLLER_SAMPLE = `@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Req() req, @Body() createOrderDto: CreateOrderDto) {
    return this.ordersService.create(req.user.id, createOrderDto);
  }

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req) {
    return this.ordersService.findOne(id, req.user);
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() updateStatusDto: UpdateOrderStatusDto
  ) {
    return this.ordersService.updateStatus(id, updateStatusDto.status);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @UseGuards(RolesGuard)
  async remove(@Param('id') id: string) {
    return this.ordersService.cancelOrder(id);
  }
}`;

const NESTJS_AUTH_CONTROLLER_SAMPLE = `@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('register')
  @HttpCode(201)
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('refresh')
  @UseGuards(JwtRefreshGuard)
  async refreshToken(@Req() req) {
    return this.authService.refreshToken(req.user.refreshToken);
  }
}`;

const OPENAPI_SAMPLE = `{
  "openapi": "3.0.0",
  "info": { "title": "Products Catalog API", "version": "1.0.0" },
  "paths": {
    "/api/products": {
      "get": {
        "summary": "List products with filter and pagination",
        "parameters": [
          { "name": "category", "in": "query", "schema": { "type": "string" } },
          { "name": "limit", "in": "query", "schema": { "type": "integer" } }
        ]
      },
      "post": {
        "summary": "Create product (Admin only)",
        "security": [{ "bearerAuth": [] }]
      }
    }
  }
}`;

export const AiGeneratorView: React.FC<AiGeneratorViewProps> = ({
  project,
  onImportEndpoints,
  onGenerateTests,
  onNavigateToTestCases
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'import_code' | 'generate_tests' | 'e2e_pipeline'>('generate_tests');
  const [e2ePreset, setE2ePreset] = useState<'checkout' | 'auth_rbac' | 'custom'>('checkout');
  const [e2eScenarioPrompt, setE2eScenarioPrompt] = useState<string>(
    'User logs in to get JWT token -> Places Order with items -> Generates Invoice for order -> Verifies invoice PDF download.'
  );

  // Import state
  const [rawCodeInput, setRawCodeInput] = useState<string>(NESTJS_ORDERS_CONTROLLER_SAMPLE);
  const [isImporting, setIsImporting] = useState(false);
  const [importedEndpoints, setImportedEndpoints] = useState<Endpoint[]>([]);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  // Generate tests state
  const [selectedEndpointIds, setSelectedEndpointIds] = useState<string[]>(
    project.endpoints.map(e => e.id)
  );
  const [customInstructions, setCustomInstructions] = useState<string>(
    'Generate comprehensive coverage: Happy path, 400 validation for missing required fields, 401 unauthorized checks for protected routes, boundary limits, and SQL injection probe.'
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedTests, setGeneratedTests] = useState<TestCase[]>([]);
  const [generateMessage, setGenerateMessage] = useState<string | null>(null);

  const handleImport = async () => {
    if (!rawCodeInput.trim()) return;
    setIsImporting(true);
    setImportMessage(null);
    try {
      const endpoints = await onImportEndpoints(rawCodeInput);
      setImportedEndpoints(endpoints);
      setImportMessage(`Successfully parsed and added ${endpoints.length} endpoints to ${project.name}!`);
      // Update selected endpoints for test generator
      setSelectedEndpointIds(prev => [...prev, ...endpoints.map(e => e.id)]);
    } catch (err: any) {
      setImportMessage(`Error importing: ${err.message}`);
    } finally {
      setIsImporting(false);
    }
  };

  const handleGenerate = async () => {
    if (selectedEndpointIds.length === 0) return;
    setIsGenerating(true);
    setGenerateMessage(null);
    try {
      const tests = await onGenerateTests(selectedEndpointIds, customInstructions);
      setGeneratedTests(tests);
      setGenerateMessage(`AI successfully generated and added ${tests.length} new test cases to your suite!`);
    } catch (err: any) {
      setGenerateMessage(`Error generating tests: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const toggleEndpointSelection = (id: string) => {
    setSelectedEndpointIds(prev =>
      prev.includes(id) ? prev.filter(eId => eId !== id) : [...prev, id]
    );
  };

  const selectAllEndpoints = () => {
    setSelectedEndpointIds(project.endpoints.map(e => e.id));
  };

  const deselectAllEndpoints = () => {
    setSelectedEndpointIds([]);
  };

  return (
    <div className="space-y-6">
      {/* Subtab navigation */}
      <div className="flex border-b border-slate-800">
        <button
          onClick={() => setActiveSubTab('generate_tests')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${
            activeSubTab === 'generate_tests'
              ? 'text-cyan-400 border-cyan-400 bg-cyan-500/5'
              : 'text-slate-400 border-transparent hover:text-slate-200'
          }`}
        >
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <span>Generate AI Test Suite</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded bg-cyan-500/10 text-cyan-400">
            {project.endpoints.length} Endpoints Ready
          </span>
        </button>

        <button
          onClick={() => setActiveSubTab('e2e_pipeline')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${
            activeSubTab === 'e2e_pipeline'
              ? 'text-purple-400 border-purple-400 bg-purple-500/5'
              : 'text-slate-400 border-transparent hover:text-slate-200'
          }`}
        >
          <Layers className="w-4 h-4 text-purple-400" />
          <span>Nested E2E Pipeline Generator</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-500/10 text-purple-400">
            Chained Scenarios
          </span>
        </button>

        <button
          onClick={() => setActiveSubTab('import_code')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${
            activeSubTab === 'import_code'
              ? 'text-cyan-400 border-cyan-400 bg-cyan-500/5'
              : 'text-slate-400 border-transparent hover:text-slate-200'
          }`}
        >
          <FileCode2 className="w-4 h-4 text-blue-400" />
          <span>Import from Code / Swagger</span>
        </button>
      </div>

      {/* Mode 1: AI Test Suite Generator */}
      {activeSubTab === 'generate_tests' && (
        <div className="space-y-6">
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
            <h3 className="text-sm font-semibold text-slate-200">
              AI Automated Test Case Synthesis ({project.name})
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Gemini analyzes your {project.stack.toUpperCase()} controllers and generates production-ready test cases covering Happy Paths, ValidationPipe (400), Auth & Role Guards (401/403), Boundary Fuzzing, and Chained Data Flows.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Endpoint Selector */}
            <div className="lg:col-span-1 rounded-xl bg-slate-900 border border-slate-800 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Target Endpoints ({selectedEndpointIds.length}/{project.endpoints.length})
                </span>
                <div className="flex items-center gap-2 text-[11px]">
                  <button onClick={selectAllEndpoints} className="text-cyan-400 hover:underline">All</button>
                  <span className="text-slate-600">|</span>
                  <button onClick={deselectAllEndpoints} className="text-slate-400 hover:underline">None</button>
                </div>
              </div>

              <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
                {project.endpoints.map(ep => {
                  const isSelected = selectedEndpointIds.includes(ep.id);
                  return (
                    <div
                      key={ep.id}
                      onClick={() => toggleEndpointSelection(ep.id)}
                      className={`p-2 rounded-lg cursor-pointer text-xs border transition-all ${
                        isSelected
                          ? 'bg-cyan-500/10 border-cyan-500/30 text-slate-200'
                          : 'bg-slate-950 border-slate-800/80 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          className="rounded border-slate-700 text-cyan-500 focus:ring-0"
                        />
                        <span className="font-mono font-bold text-[10px] uppercase text-cyan-400">
                          {ep.method}
                        </span>
                        <span className="font-mono text-xs truncate flex-1">{ep.path}</span>
                      </div>
                      <div className="text-[11px] text-slate-400 pl-5 truncate mt-0.5">
                        {ep.summary}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right: Prompt & Generation Trigger */}
            <div className="lg:col-span-2 space-y-4">
              <div className="rounded-xl bg-slate-900 border border-slate-800 p-4 space-y-3">
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  AI Test Strategy & Focus Instructions
                </label>
                <textarea
                  rows={3}
                  value={customInstructions}
                  onChange={e => setCustomInstructions(e.target.value)}
                  placeholder="e.g. Focus on edge-case validation, negative quantities, missing JWT token, and SQL injection probes."
                  className="w-full p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
                />

                <div className="flex items-center justify-between pt-2">
                  <div className="text-xs text-slate-400 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Powered by Gemini 3.8 Flash</span>
                  </div>

                  <button
                    onClick={handleGenerate}
                    disabled={isGenerating || selectedEndpointIds.length === 0}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-medium shadow-md shadow-cyan-600/20 disabled:opacity-50 transition-all"
                  >
                    {isGenerating ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        <span>Synthesizing Test Cases...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        <span>Generate Test Cases ({selectedEndpointIds.length} endpoints)</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Feedback Message */}
              {generateMessage && (
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>{generateMessage}</span>
                  </div>
                  <button
                    onClick={onNavigateToTestCases}
                    className="underline font-semibold hover:opacity-80"
                  >
                    View All Test Cases →
                  </button>
                </div>
              )}

              {/* Generated Cases Preview */}
              {generatedTests.length > 0 && (
                <div className="rounded-xl bg-slate-900 border border-slate-800 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                      Newly Generated Test Cases ({generatedTests.length})
                    </h4>
                    <button
                      onClick={onNavigateToTestCases}
                      className="text-xs text-cyan-400 hover:underline flex items-center gap-1"
                    >
                      <span>Go to Test Suite</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="space-y-2">
                    {generatedTests.map(tc => (
                      <div key={tc.id} className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 font-bold">
                            {tc.request.method}
                          </span>
                          <span className="font-mono text-slate-400">{tc.request.path}</span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300">
                            {tc.category}
                          </span>
                          <span className="ml-auto text-[10px] font-mono text-emerald-400">
                            Expected: [{tc.assertions.expectedStatuses.join(', ')}]
                          </span>
                        </div>
                        <div className="font-medium text-slate-200">{tc.name}</div>
                        <div className="text-[11px] text-slate-400">{tc.description}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mode 2: Nested E2E Pipeline Generator */}
      {activeSubTab === 'e2e_pipeline' && (
        <div className="space-y-6">
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Layers className="w-4 h-4 text-purple-400" />
              <span>Synthesize Multi-Step Nested E2E Scenario</span>
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Creates structured end-to-end execution flows with prerequisite resolution: auto-injecting bearer JWT tokens, chaining created resource IDs, and validating downstream contracts across multiple modules.
            </p>

            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <span className="text-xs text-slate-400">Flow Presets:</span>
              <button
                onClick={() => {
                  setE2ePreset('checkout');
                  setE2eScenarioPrompt(
                    'Step 1: POST /api/auth/login (extract accessToken) -> Step 2: POST /api/orders with Bearer token (extract orderId) -> Step 3: POST /api/invoices with orderId (extract invoiceId) -> Step 4: GET /api/invoices/:invoiceId (verify paid status and receipt downloadUrl)'
                  );
                }}
                className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                  e2ePreset === 'checkout'
                    ? 'bg-purple-600/30 text-purple-300 border-purple-500/50 font-medium'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                }`}
              >
                Checkout to Invoice Flow (Login ➜ Order ➜ Invoice ➜ Receipt)
              </button>
              <button
                onClick={() => {
                  setE2ePreset('auth_rbac');
                  setE2eScenarioPrompt(
                    'Step 1: POST /api/auth/register (new user) -> Step 2: POST /api/auth/login (customer token) -> Step 3: GET /api/admin/users (verify 403 Forbidden with customer role) -> Step 4: POST /api/auth/refresh (rotate token)'
                  );
                }}
                className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                  e2ePreset === 'auth_rbac'
                    ? 'bg-purple-600/30 text-purple-300 border-purple-500/50 font-medium'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                }`}
              >
                User Lifecycle & RBAC Isolation Flow
              </button>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                E2E Pipeline Scenario Specification
              </label>
              <textarea
                rows={4}
                value={e2eScenarioPrompt}
                onChange={e => setE2eScenarioPrompt(e.target.value)}
                className="w-full p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500"
                placeholder="Describe your multi-step flow..."
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500 font-mono">
                Auto-configures dependsOn, extractions, and folder hierarchy.
              </span>

              <button
                onClick={async () => {
                  setIsGenerating(true);
                  setGenerateMessage(null);
                  try {
                    const allIds = project.endpoints.map(e => e.id);
                    const prompt = `Synthesize a strict multi-step nested E2E test pipeline with folderPath="/E2E Pipelines/Generated Flow", dependsOn linking, and chainedContext extractions: ${e2eScenarioPrompt}`;
                    const tests = await onGenerateTests(allIds, prompt);
                    setGeneratedTests(tests);
                    setGenerateMessage(`Synthesized ${tests.length} connected E2E test cases ready for execution in the Live iFrame Runner!`);
                  } catch (err: any) {
                    setGenerateMessage(`Error generating E2E tests: ${err.message}`);
                  } finally {
                    setIsGenerating(false);
                  }
                }}
                disabled={isGenerating}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-lg shadow-purple-900/30 transition-all disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4" />
                <span>{isGenerating ? 'Synthesizing Pipeline...' : 'Generate E2E Flow'}</span>
              </button>
            </div>

            {generateMessage && (
              <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-300 text-xs flex items-center justify-between">
                <span>{generateMessage}</span>
                <button
                  onClick={onNavigateToTestCases}
                  className="underline font-semibold hover:opacity-80"
                >
                  View in Runner →
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mode 3: Import from Code or Swagger */}
      {activeSubTab === 'import_code' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
            <h3 className="text-sm font-semibold text-slate-200">
              Import Endpoints from NestJS Controller, DTO, or Swagger Spec
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Paste your controller code (e.g., NestJS <code>@Controller()</code>, <code>@Post()</code>, <code>@UseGuards()</code>), DTO classes, or OpenAPI/Swagger JSON. Testeria automatically extracts the endpoints, schemas, and guard requirements.
            </p>

            {/* Presets */}
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <span className="text-xs text-slate-400 font-medium">Load Preset:</span>
              <button
                onClick={() => setRawCodeInput(NESTJS_ORDERS_CONTROLLER_SAMPLE)}
                className="text-xs px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
              >
                NestJS Orders Controller
              </button>
              <button
                onClick={() => setRawCodeInput(NESTJS_AUTH_CONTROLLER_SAMPLE)}
                className="text-xs px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
              >
                NestJS Auth & Login Controller
              </button>
              <button
                onClick={() => setRawCodeInput(OPENAPI_SAMPLE)}
                className="text-xs px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
              >
                OpenAPI 3.0 JSON
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <textarea
              rows={12}
              value={rawCodeInput}
              onChange={e => setRawCodeInput(e.target.value)}
              placeholder="Paste NestJS controller TypeScript code or Swagger JSON here..."
              className="w-full p-4 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500/50"
            />

            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">
                Detects NestJS decorators, HTTP methods, route params, and guard dependencies.
              </span>

              <button
                onClick={handleImport}
                disabled={isImporting || !rawCodeInput.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium shadow-md shadow-cyan-600/20 disabled:opacity-50 transition-all"
              >
                {isImporting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    <span>Parsing Routes & DTOs...</span>
                  </>
                ) : (
                  <>
                    <PlusCircle className="w-3.5 h-3.5" />
                    <span>Extract & Import Endpoints</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {importMessage && (
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{importMessage}</span>
              </div>
              <button
                onClick={() => setActiveSubTab('generate_tests')}
                className="underline font-semibold hover:opacity-80"
              >
                Generate Tests for them now →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
