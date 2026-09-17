import { Project, TestCase, TestSuiteReport, ExplorationSession } from '../src/types';

export const INITIAL_PROJECTS: Project[] = [
  {
    id: 'proj_ecommerce_nestjs',
    name: 'Project A: E-Commerce & Order Service',
    description: 'NestJS backend microservice handling order fulfillment, JWT authentication, and product catalogs.',
    stack: 'nestjs',
    baseUrl: 'http://localhost:4000',
    defaultHeaders: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    envVars: {
      'NODE_ENV': 'development',
      'JWT_SECRET': 'nest-secret-key-123'
    },
    endpoints: [
      {
        id: 'ep_auth_login',
        method: 'POST',
        path: '/api/auth/login',
        summary: 'Authenticate User & Issue JWT',
        description: 'Validates LoginDto credentials using Passport local strategy and returns signed JWT token.',
        tags: ['Authentication'],
        requestBodySchema: {
          email: 'user@example.com',
          password: 'Password123!'
        },
        responseSchemaSample: {
          accessToken: 'eyJhbGciOiJIUzI1NiIsIn...',
          user: { id: 'usr_991', email: 'user@example.com', role: 'CUSTOMER' }
        },
        sourceSnippet: `@Controller('auth')\nexport class AuthController {\n  @Post('login')\n  @HttpCode(200)\n  async login(@Body() dto: LoginDto) {\n    return this.authService.login(dto);\n  }\n}`
      },
      {
        id: 'ep_orders_create',
        method: 'POST',
        path: '/api/orders',
        summary: 'Create New Customer Order',
        description: 'Requires customer authentication. Validates CreateOrderDto with class-validator (@IsArray, @ValidateNested).',
        tags: ['Orders'],
        headers: {
          'Authorization': 'Bearer {{accessToken}}'
        },
        requestBodySchema: {
          items: [
            { productId: 'prod_101', quantity: 2, unitPrice: 49.99 }
          ],
          shippingAddress: {
            street: 'Jl. Sudirman No. 45',
            city: 'Jakarta',
            postalCode: '10220'
          },
          paymentMethod: 'CREDIT_CARD'
        },
        responseSchemaSample: {
          orderId: 'ord_2026_883',
          totalAmount: 99.98,
          status: 'PENDING_PAYMENT',
          createdAt: '2026-09-17T09:30:00.000Z'
        },
        sourceSnippet: `@Controller('orders')\n@UseGuards(JwtAuthGuard)\nexport class OrdersController {\n  @Post()\n  async create(@Req() req, @Body() dto: CreateOrderDto) {\n    return this.ordersService.create(req.user.id, dto);\n  }\n}`
      },
      {
        id: 'ep_orders_get',
        method: 'GET',
        path: '/api/orders/:id',
        summary: 'Retrieve Order by ID',
        description: 'Returns order details if owned by requesting user or if user has ADMIN role.',
        tags: ['Orders'],
        headers: {
          'Authorization': 'Bearer {{accessToken}}'
        },
        responseSchemaSample: {
          id: 'ord_2026_883',
          customerId: 'usr_991',
          status: 'PAID',
          items: [{ productId: 'prod_101', quantity: 2, unitPrice: 49.99 }]
        },
        sourceSnippet: `@Get(':id')\nasync findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req) {\n  return this.ordersService.findOne(id, req.user);\n}`
      },
      {
        id: 'ep_orders_status',
        method: 'PATCH',
        path: '/api/orders/:id/status',
        summary: 'Transition Order Status',
        description: 'Updates order state machine (PENDING -> PAID -> SHIPPED). Validates allowed transitions.',
        tags: ['Orders'],
        headers: {
          'Authorization': 'Bearer {{accessToken}}'
        },
        requestBodySchema: {
          status: 'PAID',
          paymentReference: 'pay_ref_9981'
        },
        responseSchemaSample: {
          id: 'ord_2026_883',
          previousStatus: 'PENDING_PAYMENT',
          status: 'PAID',
          updatedAt: '2026-09-17T09:35:00.000Z'
        }
      },
      {
        id: 'ep_products_search',
        method: 'GET',
        path: '/api/products/search',
        summary: 'Catalog Search with Pagination & Filters',
        description: 'Public endpoint allowing keyword search, category filter, and limit/offset pagination.',
        tags: ['Catalog'],
        queryParams: [
          { name: 'q', type: 'string', required: false, default: 'laptop' },
          { name: 'category', type: 'string', required: false, default: 'electronics' },
          { name: 'page', type: 'number', required: false, default: '1' },
          { name: 'limit', type: 'number', required: false, default: '10' }
        ],
        responseSchemaSample: {
          data: [
            { id: 'prod_101', title: 'UltraBook Pro 15', price: 1299.00, stock: 45 }
          ],
          total: 1,
          page: 1,
          limit: 10
        }
      },
      {
        id: 'ep_invoices_generate',
        method: 'POST',
        path: '/api/invoices',
        summary: 'Generate Invoice for Order',
        description: 'Creates a formal invoice linked to an existing order. Requires Bearer Token.',
        tags: ['Billing & Invoices'],
        headers: {
          Authorization: 'Bearer {{accessToken}}',
          'Content-Type': 'application/json'
        },
        requestBodySchema: {
          orderId: 'string (required)',
          amount: 'number'
        },
        responseSchemaSample: {
          invoiceId: 'inv_89104',
          invoiceNumber: 'INV-2026-001',
          orderId: 'ord_12345',
          amount: 99.98,
          status: 'ISSUED'
        }
      },
      {
        id: 'ep_invoices_get',
        method: 'GET',
        path: '/api/invoices/:id',
        summary: 'Get Invoice Details & Receipt',
        description: 'Retrieves issued invoice state, payment verification, and downloadable PDF receipt link.',
        tags: ['Billing & Invoices'],
        headers: {
          Authorization: 'Bearer {{accessToken}}'
        },
        responseSchemaSample: {
          id: 'inv_89104',
          status: 'PAID',
          downloadUrl: 'https://storage.example.com/invoices/inv_89104.pdf'
        }
      }
    ],
    testCases: [
      {
        id: 'tc_login_success',
        endpointId: 'ep_auth_login',
        name: 'Login - Valid Credentials',
        category: 'happy_path',
        folderPath: '/Auth Module/Login/Happy Path',
        description: 'Expect 200 OK with JWT accessToken and user profile.',
        request: {
          method: 'POST',
          path: '/api/auth/login',
          headers: { 'Content-Type': 'application/json' },
          body: {
            email: 'user@example.com',
            password: 'Password123!'
          }
        },
        assertions: {
          expectedStatuses: [200],
          requiredBodyKeys: ['accessToken', 'user'],
          maxLatencyMs: 800
        },
        chainedContext: {
          extractResponseKey: 'accessToken'
        }
      },
      {
        id: 'tc_login_invalid_password',
        endpointId: 'ep_auth_login',
        name: 'Login - Invalid Password (401)',
        category: 'negative_validation',
        folderPath: '/Auth Module/Login/Negative Case',
        description: 'Expect 401 Unauthorized when password is wrong.',
        request: {
          method: 'POST',
          path: '/api/auth/login',
          headers: { 'Content-Type': 'application/json' },
          body: {
            email: 'user@example.com',
            password: 'WrongPassword999'
          }
        },
        assertions: {
          expectedStatuses: [401],
          requiredBodyKeys: ['message', 'statusCode'],
          maxLatencyMs: 600
        }
      },
      {
        id: 'tc_login_validation_error',
        endpointId: 'ep_auth_login',
        name: 'Login - Missing Email Field (400)',
        category: 'negative_validation',
        folderPath: '/Auth Module/Login/Negative Case',
        description: 'Expect NestJS ValidationPipe 400 Bad Request with field error.',
        request: {
          method: 'POST',
          path: '/api/auth/login',
          headers: { 'Content-Type': 'application/json' },
          body: {
            password: 'Password123!'
          }
        },
        assertions: {
          expectedStatuses: [400],
          requiredBodyKeys: ['message', 'error'],
          maxLatencyMs: 400
        }
      },
      {
        id: 'tc_create_order_happy',
        endpointId: 'ep_orders_create',
        name: 'Create Order - Happy Path Flow',
        category: 'chained_flow',
        folderPath: '/Order Module/Create Order/Happy Path',
        dependsOn: ['tc_login_success'],
        description: 'Auto-injects accessToken from Login and creates a new order.',
        request: {
          method: 'POST',
          path: '/api/orders',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer {{accessToken}}'
          },
          body: {
            items: [
              { productId: 'prod_101', quantity: 2, unitPrice: 49.99 }
            ],
            shippingAddress: {
              street: 'Jl. Thamrin No. 10',
              city: 'Jakarta Pusat',
              postalCode: '10350'
            },
            paymentMethod: 'CREDIT_CARD'
          }
        },
        assertions: {
          expectedStatuses: [200, 201],
          requiredBodyKeys: ['orderId', 'totalAmount', 'status'],
          maxLatencyMs: 1200
        },
        chainedContext: {
          sourceTestCaseId: 'tc_login_success',
          extractResponseKey: 'orderId',
          injectIntoHeader: 'Authorization'
        }
      },
      {
        id: 'tc_create_order_unauthorized',
        endpointId: 'ep_orders_create',
        name: 'Create Order - Missing JWT Guard (401)',
        category: 'auth_security',
        folderPath: '/Order Module/Create Order/Negative Case',
        description: 'Expect NestJS JwtAuthGuard to reject request without Bearer token.',
        request: {
          method: 'POST',
          path: '/api/orders',
          headers: {
            'Content-Type': 'application/json'
          },
          body: {
            items: [{ productId: 'prod_101', quantity: 1, unitPrice: 49.99 }]
          }
        },
        assertions: {
          expectedStatuses: [401],
          requiredBodyKeys: ['statusCode', 'message'],
          maxLatencyMs: 500
        }
      },
      {
        id: 'tc_create_order_negative_qty',
        endpointId: 'ep_orders_create',
        name: 'Create Order - Negative Quantity Check',
        category: 'boundary_edge',
        folderPath: '/Order Module/Create Order/Negative Case',
        description: 'Expect 400 when quantity is -5 or 0.',
        request: {
          method: 'POST',
          path: '/api/orders',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-jwt-token-valid'
          },
          body: {
            items: [{ productId: 'prod_101', quantity: -5, unitPrice: 49.99 }],
            shippingAddress: { street: 'St 1', city: 'City', postalCode: '12345' }
          }
        },
        assertions: {
          expectedStatuses: [400],
          requiredBodyKeys: ['message'],
          maxLatencyMs: 500
        }
      },
      {
        id: 'tc_products_search_sqli',
        endpointId: 'ep_products_search',
        name: 'Product Search - SQL Injection Fuzzing Probe',
        category: 'boundary_edge',
        folderPath: '/Catalog Module/Search & Filters/Boundary & Fuzzing',
        description: 'Tests parameter sanitization against SQL injection payloads.',
        request: {
          method: 'GET',
          path: '/api/products/search',
          queryParams: {
            q: "' OR '1'='1' --",
            limit: '10'
          }
        },
        assertions: {
          expectedStatuses: [200],
          requiredBodyKeys: ['data'],
          maxLatencyMs: 800
        }
      },
      // FULL NESTED E2E FLOW: Login -> Create Order -> Generate Invoice -> Verify Paid
      {
        id: 'tc_e2e_step1_auth',
        endpointId: 'ep_auth_login',
        name: '1. Authenticate Customer Session',
        category: 'chained_flow',
        folderPath: '/E2E Pipelines/Checkout to Invoice Flow',
        stepNumber: 1,
        description: 'Step 1 of E2E: Obtains fresh bearer JWT token for the customer session.',
        request: {
          method: 'POST',
          path: '/api/auth/login',
          headers: { 'Content-Type': 'application/json' },
          body: {
            email: 'user@example.com',
            password: 'Password123!'
          }
        },
        assertions: {
          expectedStatuses: [200],
          requiredBodyKeys: ['accessToken'],
          maxLatencyMs: 1000
        },
        chainedContext: {
          extractResponseKey: 'accessToken'
        }
      },
      {
        id: 'tc_e2e_step2_order',
        endpointId: 'ep_orders_create',
        name: '2. Place & Register Order',
        category: 'chained_flow',
        folderPath: '/E2E Pipelines/Checkout to Invoice Flow',
        stepNumber: 2,
        dependsOn: ['tc_e2e_step1_auth'],
        description: 'Step 2 of E2E: Uses accessToken from Step 1 to place order and captures orderId.',
        request: {
          method: 'POST',
          path: '/api/orders',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer {{accessToken}}'
          },
          body: {
            items: [
              { productId: 'prod_101', quantity: 1, unitPrice: 1299.00 }
            ],
            shippingAddress: {
              street: 'Sudirman Central Business District',
              city: 'Jakarta',
              postalCode: '12190'
            }
          }
        },
        assertions: {
          expectedStatuses: [201],
          requiredBodyKeys: ['orderId', 'status'],
          maxLatencyMs: 1000
        },
        chainedContext: {
          sourceTestCaseId: 'tc_e2e_step1_auth',
          extractResponseKey: 'orderId',
          extractions: [
            { key: 'orderId', fromPath: 'orderId' },
            { key: 'totalAmount', fromPath: 'totalAmount' }
          ]
        }
      },
      {
        id: 'tc_e2e_step3_invoice',
        endpointId: 'ep_invoices_generate',
        name: '3. Generate Invoice for Order',
        category: 'chained_flow',
        folderPath: '/E2E Pipelines/Checkout to Invoice Flow',
        stepNumber: 3,
        dependsOn: ['tc_e2e_step2_order'],
        description: 'Step 3 of E2E: Depends on Order step. Injects orderId into payload and issues customer invoice.',
        request: {
          method: 'POST',
          path: '/api/invoices',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer {{accessToken}}'
          },
          body: {
            orderId: '{{orderId}}',
            amount: 1299.00
          }
        },
        assertions: {
          expectedStatuses: [201],
          requiredBodyKeys: ['invoiceId', 'invoiceNumber', 'status'],
          maxLatencyMs: 1000
        },
        chainedContext: {
          sourceTestCaseId: 'tc_e2e_step2_order',
          extractResponseKey: 'invoiceId',
          extractions: [
            { key: 'invoiceId', fromPath: 'invoiceId' }
          ]
        }
      },
      {
        id: 'tc_e2e_step4_verify_invoice',
        endpointId: 'ep_invoices_get',
        name: '4. Verify Invoice & Download Receipt',
        category: 'chained_flow',
        folderPath: '/E2E Pipelines/Checkout to Invoice Flow',
        stepNumber: 4,
        dependsOn: ['tc_e2e_step3_invoice'],
        description: 'Step 4 of E2E: Queries GET /api/invoices/:invoiceId to verify paid state and downloadable receipt PDF.',
        request: {
          method: 'GET',
          path: '/api/invoices/:invoiceId',
          headers: {
            'Authorization': 'Bearer {{accessToken}}'
          }
        },
        assertions: {
          expectedStatuses: [200],
          requiredBodyKeys: ['id', 'status', 'downloadUrl'],
          maxLatencyMs: 800
        },
        chainedContext: {
          sourceTestCaseId: 'tc_e2e_step3_invoice'
        }
      }
    ],
    createdAt: Date.now() - 3600000 * 24,
    updatedAt: Date.now() - 3600000 * 2
  },
  {
    id: 'proj_auth_rbac_microservice',
    name: 'Project B: User & RBAC Microservice',
    description: 'Next.js & NestJS backend for user registrations, role-based permissions (ADMIN vs USER), and profile management.',
    stack: 'nestjs',
    baseUrl: 'http://localhost:5000',
    defaultHeaders: {
      'Content-Type': 'application/json'
    },
    envVars: {
      'PORT': '5000',
      'ROLES_ENABLED': 'true'
    },
    endpoints: [
      {
        id: 'ep_users_register',
        method: 'POST',
        path: '/api/users/register',
        summary: 'Register New User Account',
        description: 'Creates user account with hashed password and default USER role.',
        tags: ['Users'],
        requestBodySchema: {
          email: 'newbie@domain.com',
          name: 'Newbie Developer',
          password: 'StrongPassword#2026'
        },
        responseSchemaSample: {
          id: 'usr_new_771',
          email: 'newbie@domain.com',
          role: 'USER',
          createdAt: '2026-09-17T10:00:00.000Z'
        }
      },
      {
        id: 'ep_users_me',
        method: 'GET',
        path: '/api/users/me',
        summary: 'Current User Profile',
        description: 'Extracts user profile from JWT payload in request context.',
        tags: ['Users'],
        headers: {
          'Authorization': 'Bearer {{accessToken}}'
        },
        responseSchemaSample: {
          id: 'usr_new_771',
          name: 'Newbie Developer',
          email: 'newbie@domain.com',
          role: 'USER'
        }
      },
      {
        id: 'ep_users_role_update',
        method: 'PUT',
        path: '/api/users/:id/role',
        summary: 'Update User Role (Admin Guard)',
        description: 'Protected by @Roles(Role.ADMIN). Rejects non-admin users with 403 Forbidden.',
        tags: ['Admin RBAC'],
        headers: {
          'Authorization': 'Bearer {{adminToken}}'
        },
        requestBodySchema: {
          role: 'MANAGER'
        },
        responseSchemaSample: {
          id: 'usr_target_44',
          previousRole: 'USER',
          newRole: 'MANAGER',
          updatedAt: '2026-09-17T10:15:00.000Z'
        }
      }
    ],
    testCases: [
      {
        id: 'tc_register_happy',
        endpointId: 'ep_users_register',
        name: 'Register User - Valid DTO (Happy Path)',
        category: 'happy_path',
        description: 'Expect 201 Created with sanitized user object.',
        request: {
          method: 'POST',
          path: '/api/users/register',
          body: {
            email: 'dev.gofar@example.com',
            name: 'Gofar Dev',
            password: 'SecuredPassword!2026'
          }
        },
        assertions: {
          expectedStatuses: [200, 201],
          requiredBodyKeys: ['id', 'email', 'role'],
          forbiddenBodyKeys: ['password', 'passwordHash'],
          maxLatencyMs: 900
        }
      },
      {
        id: 'tc_register_weak_password',
        endpointId: 'ep_users_register',
        name: 'Register User - Weak Password Boundary Test',
        category: 'boundary_edge',
        description: 'Expect 400 Bad Request if password is too short (< 8 chars).',
        request: {
          method: 'POST',
          path: '/api/users/register',
          body: {
            email: 'weak@example.com',
            name: 'Weak Pass',
            password: '123'
          }
        },
        assertions: {
          expectedStatuses: [400],
          requiredBodyKeys: ['message'],
          maxLatencyMs: 500
        }
      },
      {
        id: 'tc_role_forbidden',
        endpointId: 'ep_users_role_update',
        name: 'Update Role - Non-Admin User (403 Forbidden Guard)',
        category: 'auth_security',
        description: 'Expect NestJS RolesGuard to reject customer/user token with 403.',
        request: {
          method: 'PUT',
          path: '/api/users/usr_target_44/role',
          headers: {
            'Authorization': 'Bearer regular-user-token'
          },
          body: {
            role: 'ADMIN'
          }
        },
        assertions: {
          expectedStatuses: [403],
          requiredBodyKeys: ['statusCode', 'message'],
          maxLatencyMs: 600
        }
      }
    ],
    createdAt: Date.now() - 3600000 * 48,
    updatedAt: Date.now() - 3600000 * 5
  }
];

class MemoryProjectStore {
  private projects: Project[] = [...INITIAL_PROJECTS];

  getAllProjects(): Project[] {
    return this.projects;
  }

  getProjectById(id: string): Project | undefined {
    return this.projects.find(p => p.id === id);
  }

  createProject(data: Partial<Project>): Project {
    const newProject: Project = {
      id: `proj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: data.name || 'New Backend Project',
      description: data.description || '',
      stack: data.stack || 'nestjs',
      baseUrl: data.baseUrl || 'http://localhost:3000',
      defaultHeaders: data.defaultHeaders || { 'Content-Type': 'application/json' },
      envVars: data.envVars || {},
      endpoints: data.endpoints || [],
      testCases: data.testCases || [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.projects.push(newProject);
    return newProject;
  }

  updateProject(id: string, updates: Partial<Project>): Project | undefined {
    const idx = this.projects.findIndex(p => p.id === id);
    if (idx === -1) return undefined;
    this.projects[idx] = {
      ...this.projects[idx],
      ...updates,
      updatedAt: Date.now()
    };
    return this.projects[idx];
  }

  deleteProject(id: string): boolean {
    const initialLen = this.projects.length;
    this.projects = this.projects.filter(p => p.id !== id);
    return this.projects.length < initialLen;
  }

  saveReport(projectId: string, report: TestSuiteReport): void {
    const project = this.getProjectById(projectId);
    if (project) {
      project.latestReport = report;
      if (!project.reportsHistory) {
        project.reportsHistory = [];
      }
      project.reportsHistory.unshift(report);
      // Keep up to 30 past execution histories
      if (project.reportsHistory.length > 30) {
        project.reportsHistory = project.reportsHistory.slice(0, 30);
      }
      project.updatedAt = Date.now();
    }
  }

  saveExploration(projectId: string, exploration: ExplorationSession): void {
    const project = this.getProjectById(projectId);
    if (project) {
      project.latestExploration = exploration;
      project.updatedAt = Date.now();
    }
  }
}

export const projectStore = new MemoryProjectStore();
