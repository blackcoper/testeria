import { load as yamlLoad } from 'js-yaml';
import type { Endpoint, Method } from '../src/types';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

export interface ImportResult {
  basePath: string;
  endpoints: Endpoint[];
  warnings: string[];
}

/**
 * Rule-based OpenAPI 3 / Swagger 2 importer. No AI.
 * Accepts raw JSON or YAML text; replaces the project's endpoint list.
 */
export function importOpenApi(rawContent: string): ImportResult {
  let doc: any;
  try {
    doc = JSON.parse(rawContent);
  } catch {
    try {
      doc = yamlLoad(rawContent) as any;
    } catch {
      throw new Error('Input is neither valid JSON nor valid YAML.');
    }
  }
  if (!doc || typeof doc !== 'object') throw new Error('Empty or invalid OpenAPI document.');
  if (!doc.paths) throw new Error('No "paths" section found — is this an OpenAPI/Swagger document?');

  const warnings: string[] = [];
  const version = String(doc.openapi || doc.swagger || '?');
  if (!/^3|^2/.test(version)) warnings.push(`Unrecognized spec version "${version}", trying best-effort parse.`);

  // Base path: servers[0].url (OAS3) or host+basePath (Swagger2)
  let basePath = '';
  if (Array.isArray(doc.servers) && doc.servers[0]?.url) {
    try {
      const u = new URL(doc.servers[0].url);
      basePath = u.pathname.replace(/\/$/, '');
    } catch {
      basePath = String(doc.servers[0].url).replace(/\/$/, '');
    }
  } else if (doc.host && doc.basePath) {
    basePath = `http://${doc.host}${doc.basePath}`.replace(/\/$/, '');
  }

  const endpoints: Endpoint[] = [];

  for (const [rawPath, pathItemAny] of Object.entries<any>(doc.paths)) {
    if (!pathItemAny || typeof pathItemAny !== 'object') continue;
    const pathLevel = pathItemAny;
    const pathParams = normalizeParams(pathItemAny.parameters);

    for (const method of HTTP_METHODS) {
      const op = pathItemAny[method];
      if (!op || typeof op !== 'object') continue;
      const rawUrl = `${basePath}${expandPathTemplate(rawPath)}`;
      const params = [...pathParams, ...normalizeParams(op.parameters)];

      const querySchema: Record<string, string> = {};
      let bodySchema: any;
      const headers: Record<string, string> = {};

      for (const p of params) {
        if (p.in === 'query' && p.name) querySchema[p.name] = p.type || 'string';
        if (p.in === 'header' && p.name && p.required) headers[p.name] = p.example ? String(p.example) : '...';
      }

      // Request body: OAS3 requestBody.content.*.schema | Swagger2 body parameter
      const rb = op.requestBody;
      if (rb?.content) {
        const media = rb.content['application/json'] || Object.values(rb.content)[0];
        if (media?.schema) bodySchema = sampleFromSchema(media.schema);
        if (rb.required) headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      } else {
        const bodyParam = params.find((p) => p.in === 'body');
        if (bodyParam?.schema) bodySchema = sampleFromSchema(bodyParam.schema);
      }
      if (bodySchema !== undefined) headers['Content-Type'] = headers['Content-Type'] || 'application/json';

      endpoints.push({
        id: `ep_${Math.abs(hash(`${method.toUpperCase()} ${rawUrl}`)).toString(36)}`,
        method: method.toUpperCase() as Method,
        path: rawUrl,
        summary: op.summary || op.operationId || `${method.toUpperCase()} ${rawUrl}`,
        description: op.description || undefined,
        tags: Array.isArray(op.tags) && op.tags.length ? op.tags.map(String) : undefined,
        querySchema: Object.keys(querySchema).length ? querySchema : undefined,
        bodySchema,
        headers: Object.keys(headers).length ? headers : undefined,
      });
    }
  }

  if (endpoints.length === 0) warnings.push('No operations found under "paths".');
  return { basePath, endpoints, warnings };
}

// ─── helpers ───────────────────────────────────────────────────────────────

function normalizeParams(params: any): any[] {
  if (!Array.isArray(params)) return [];
  return params.filter((p) => p && typeof p === 'object');
}

/** /orders/{orderId} -> /orders/:orderId */
function expandPathTemplate(rawPath: string): string {
  return rawPath.replace(/\{([^}]+)\}/g, (_m, name) => `:${name}`);
}

/** Resolve $ref against the doc root. */
function resolveRef(doc: any, node: any, depth = 0): any {
  if (!node || depth > 10) return node;
  if (node.$ref && typeof node.$ref === 'string') {
    const target = node.$ref.split('/').reduce((acc: any, part: string) => (part === '#' || part === '' ? doc : acc?.[part]), null as any);
    return resolveRef(doc, target, depth + 1);
  }
  return node;
}

/** Build a plausible sample value from a JSON schema (rule-based). */
export function sampleFromSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return {};
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;

  const type = schema.type ?? (schema.properties ? 'object' : Array.isArray(schema.items) ? 'array' : undefined);

  switch (type) {
    case 'object': {
      const out: Record<string, any> = {};
      const props = schema.properties || {};
      for (const [k, v] of Object.entries<any>(props)) out[k] = sampleFromSchema(v);
      return out;
    }
    case 'array':
      return [sampleFromSchema(schema.items)];
    case 'string': {
      if (schema.enum?.length) return schema.enum[0];
      const fmt = String(schema.format || '');
      if (fmt.includes('date')) return new Date().toISOString();
      if (fmt === 'email') return 'user@example.com';
      if (fmt === 'uuid') return '00000000-0000-4000-8000-000000000000';
      return schema.minLength ? 'x'.repeat(Math.min(schema.minLength, 12)) : 'string';
    }
    case 'integer':
    case 'number':
      return schema.minimum ?? 1;
    case 'boolean':
      return true;
    default:
      return {};
  }
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}
