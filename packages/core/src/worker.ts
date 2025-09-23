import * as yaml from 'js-yaml';
import { TemplateParser } from './parser';
import { PromptTemplate, ValidationResult } from './types';
import {
  renderCommon,
  renderWithMetaCommon,
  renderMultiCommon,
  validateVariablesCommon,
  generateTypeDefinitionsCommon,
} from './engine-helpers';

export interface WorkerEngineOptions {
  // Cloudflare static assets fetcher binding, e.g., env.ASSETS
  assetsBinding?: { fetch: (req: Request) => Promise<Response> };
  // Manifest mapping asset paths -> hashes; can be a stringified JSON (CF default) or object
  manifest?: Record<string, string> | string;
  // Optional in-memory virtual FS for advanced bundler setups or tests
  vfs?: Record<string, string>;
}

// --- Registration helpers (optional) ---
/**
 * Register Cloudflare static assets binding and manifest globally, so you can use:
 *   registerCloudflareAssets(env.ASSETS, __STATIC_CONTENT_MANIFEST)
 *   const engine = new WorkerEngine('/prompts/templates')
 */
export function registerCloudflareAssets(assetsBinding: { fetch: (req: Request) => Promise<Response> }, manifest?: Record<string, string> | string) {
  (globalThis as any).__PROMPTENG_ASSETS__ = assetsBinding;
  if (manifest) (globalThis as any).__STATIC_CONTENT_MANIFEST = manifest;
}

/**
 * Register a virtual filesystem (path -> file content). Useful in non-Cloudflare Worker
 * environments or when bundlers inline template files.
 */
export function registerVfs(vfs: Record<string, string>) {
  (globalThis as any).__PROMPTENG_VFS__ = vfs;
}

/**
 * Worker-friendly engine that loads templates from Cloudflare Static Assets or a virtual FS.
 *
 * Usage (Cloudflare Workers):
 *   const engine = new WorkerEngine('/prompts/templates', { assetsBinding: env.ASSETS, manifest: __STATIC_CONTENT_MANIFEST });
 *   const sections = await engine.renderMulti('with-system', { name: 'Ada' });
 */
export class WorkerEngine {
  private templates: Map<string, PromptTemplate> = new Map();
  private parser: TemplateParser;
  private loaded = false;
  private baseDir: string;

  constructor(dir: string, private options?: WorkerEngineOptions) {
    this.parser = new TemplateParser();
    this.baseDir = normalizeDir(dir);
  }

  // Extension points
  registerFilter(name: string, fn: (...args: any[]) => any) { this.parser.registerFilter(name, fn); }
  registerTag(name: string, impl: any) { this.parser.registerTag(name, impl); }

  private async ensureLoaded() {
    if (this.loaded) return;
    // Strategy 1: Cloudflare Assets + manifest
    const manifest = resolveManifest(this.options?.manifest);
    if (manifest && this.options?.assetsBinding) {
      await this.loadFromAssetsManifest(manifest, this.options.assetsBinding);
      this.loaded = true;
      return;
    }

    // Strategy 2: Global manifest + assets binding
    const g: any = globalThis as any;
    const gManifest = resolveManifest(g.__STATIC_CONTENT_MANIFEST);
    const gAssets = g.__PROMPTENG_ASSETS__ as WorkerEngineOptions['assetsBinding'];
    if (gManifest && gAssets) {
      await this.loadFromAssetsManifest(gManifest, gAssets);
      this.loaded = true;
      return;
    }

    // Strategy 3: Virtual FS
    const vfs = this.options?.vfs || (g.__PROMPTENG_VFS__ as Record<string, string> | undefined);
    if (vfs) {
      this.loadFromVfs(vfs);
      this.loaded = true;
      return;
    }

    console.warn('[WorkerEngine] No assets/manifest or VFS available; no templates loaded.');
    this.loaded = true;
  }

  /**
   * Synchronous best-effort load for contexts where only VFS is available.
   * Used by sync APIs (validateVariables, generateTypeDefinitions).
   */
  private ensureLoadedSync() {
    if (this.loaded) return;
    const g: any = globalThis as any;
    const vfs = this.options?.vfs || (g.__PROMPTENG_VFS__ as Record<string, string> | undefined);
    if (vfs) {
      this.loadFromVfs(vfs);
      this.loaded = true;
    }
  }

  /**
   * Optional explicit preload for assets environments before using sync APIs.
   */
  public async preload() {
    await this.ensureLoaded();
  }

  private async loadFromAssetsManifest(manifest: Record<string, string>, assets: { fetch: (req: Request) => Promise<Response> }) {
    const keys = Object.keys(manifest);
    // Filter manifest keys inside the requested directory and .ptemplate only
    const dirPrefix = this.baseDir.replace(/^\//, '');
    const candidates = keys.filter(k => k.startsWith(dirPrefix) && k.endsWith('.ptemplate'));
    for (const key of candidates) {
      const url = new URL('http://local/' + key); // dummy origin for Request
      const res = await assets.fetch(new Request(url.toString()));
      if (!res.ok) {
        console.warn(`[WorkerEngine] Failed to fetch asset '${key}': ${res.status}`);
        continue;
      }
      const fileContent = await res.text();
      try {
        const template = this.parseTemplateFromString(fileContent);
        this.templates.set(template.name, template);
      } catch (e: any) {
        console.warn(`[WorkerEngine] Skipping invalid template '${key}': ${e?.message || e}`);
      }
    }
  }

  private loadFromVfs(vfs: Record<string, string>) {
    const dirPrefix = ensureTrailingSlash(this.baseDir);
    // Accept both with/without leading slash in vfs keys
    for (const [filename, content] of Object.entries(vfs)) {
      const norm = filename.startsWith('/') ? filename : '/' + filename;
      if (norm.startsWith(dirPrefix) && norm.endsWith('.ptemplate')) {
        try {
          const t = this.parseTemplateFromString(content);
          this.templates.set(t.name, t);
        } catch (e: any) {
          console.warn(`[WorkerEngine] Skipping invalid template '${filename}': ${e?.message || e}`);
        }
      }
    }
  }

  private parseTemplateFromString(fileContent: string): PromptTemplate {
    const parts = fileContent.split('---');
    if (parts.length < 3) {
      throw new Error('Invalid template format: missing frontmatter.');
    }
    const frontmatter = yaml.load(parts[1]) as any;
    const content = parts.slice(2).join('---').trim();
    return {
      name: frontmatter.name,
      content,
      variables: frontmatter.variables || [],
      metadata: {
        description: frontmatter.description || '',
        author: frontmatter.author || '',
        version: frontmatter.version || '1.0.0',
        tags: frontmatter.tags || [],
        created: new Date(),
        updated: new Date(),
      },
    };
  }

  // Public API mirrors PromptEngine
  async render(templateName: string, variables: Record<string, any>): Promise<string> {
    await this.ensureLoaded();
    return renderCommon(this.parser, this.templates, templateName, variables);
  }

  async renderWithMeta(templateName: string, variables: Record<string, any>): Promise<{ text: string; sections: Record<string, string>; constraints: any[] }> {
    await this.ensureLoaded();
    return renderWithMetaCommon(this.parser, this.templates, templateName, variables);
  }

  async renderMulti(templateName: string, variables: Record<string, any>): Promise<Record<string, string>> {
    await this.ensureLoaded();
    return renderMultiCommon(this.parser, this.templates, templateName, variables);
  }

  validateVariables(templateName: string, variables: Record<string, any>): ValidationResult {
    this.ensureLoadedSync();
    return validateVariablesCommon(this.templates, templateName, variables);
  }

  getTemplate(templateName: string): PromptTemplate | undefined { return this.templates.get(templateName); }
  listTemplates(): string[] { return Array.from(this.templates.keys()); }

  generateTypeDefinitions(): string {
    this.ensureLoadedSync();
    return generateTypeDefinitionsCommon(this.templates);
  }
}

// Helpers
function normalizeDir(dir: string): string {
  if (!dir) return '';
  return dir.replace(/\\+/g, '/').replace(/\/$/, '').replace(/^\./, '').replace(/^\//, '/');
}
function ensureTrailingSlash(dir: string): string { return dir.endsWith('/') ? dir : dir + '/'; }
// mapToTsType and toPascalCase moved to engine-helpers
function resolveManifest(input: WorkerEngineOptions['manifest']): Record<string, string> | undefined {
  if (!input) return undefined;
  try {
    if (typeof input === 'string') return JSON.parse(input);
    return input;
  } catch {
    return undefined;
  }
}
