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
  // Cloudflare __STATIC_CONTENT (KV) binding for assets
  staticContentKV?: { get: (key: string, type?: unknown) => Promise<string | ArrayBuffer | null> };
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
    const g: any = globalThis as any;

    // Strategy 1: Cloudflare Assets + manifest OR index fallback
    const optAssets = this.options?.assetsBinding;
    const optManifest = resolveManifest(this.options?.manifest);
    const gAssets = (g.__PROMPTENG_ASSETS__ as WorkerEngineOptions['assetsBinding']) || undefined;
    const gManifest = resolveManifest(g.__STATIC_CONTENT_MANIFEST);
    const assets = optAssets || gAssets;
    const manifest = optManifest || gManifest;
    if (assets) {
      if (manifest) {
        await this.loadFromAssetsManifest(manifest, assets);
        this.loaded = true;
        return;
      }
      // try index files if manifest is not present
      const loadedViaIndex = await this.tryLoadFromAssetsIndex(assets);
      if (loadedViaIndex) {
        this.loaded = true;
        return;
      }
    }

    // Strategy 2: Cloudflare __STATIC_CONTENT (KV) + manifest via options or globals
    const kvManifest = resolveManifest(this.options?.manifest) || resolveManifest((globalThis as any).__STATIC_CONTENT_MANIFEST);
    const kv = this.options?.staticContentKV || (g.__STATIC_CONTENT as WorkerEngineOptions['staticContentKV']);
    if (kvManifest && kv) {
      await this.loadFromStaticKV(kvManifest, kv);
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

  private async tryLoadFromAssetsIndex(assets: { fetch: (req: Request) => Promise<Response> }): Promise<boolean> {
    const base = this.baseDir.replace(/\/$/, '');
    const candidates = [
      `${base}/prompteng.manifest.json`, // preferred format { "files": ["a.ptemplate", ...] }
    ];
    for (const indexPath of candidates) {
      try {
        const url = new URL('http://local' + (indexPath.startsWith('/') ? '' : '/') + indexPath);
        const res = await assets.fetch(new Request(url.toString()));
        if (!res.ok) continue;
        const text = await res.text();
        const data = JSON.parse(text);
        const files: string[] = Array.isArray(data) ? data : (Array.isArray(data.files) ? data.files : []);
        if (!files.length) continue;
        for (const rel of files) {
          const assetPath = (this.baseDir.replace(/^\//, '') + '/' + rel).replace(/\\+/g, '/');
          const fileUrl = new URL('http://local/' + assetPath);
          const resp = await assets.fetch(new Request(fileUrl.toString()));
          if (!resp.ok) { console.warn(`[WorkerEngine] Failed to fetch asset '${assetPath}': ${resp.status}`); continue; }
          const fileContent = await resp.text();
          try {
            const t = this.parseTemplateFromString(fileContent);
            this.templates.set(t.name, t);
          } catch (e: any) {
            console.warn(`[WorkerEngine] Skipping invalid template '${assetPath}': ${e?.message || e}`);
          }
        }
        return this.templates.size > 0;
      } catch {}
    }
    return false;
  }

  private async loadFromStaticKV(manifest: Record<string, string>, kv: { get: (key: string, type?: unknown) => Promise<string | ArrayBuffer | null> }) {
    const keys = Object.keys(manifest);
    const dirPrefix = this.baseDir.replace(/^\//, '');
    const candidates = keys.filter(k => k.startsWith(dirPrefix) && k.endsWith('.ptemplate'));
    for (const assetPath of candidates) {
      const storedKey = manifest[assetPath];
      if (!storedKey) continue;
      try {
        const text = await kv.get(storedKey, 'text' as any);
        if (typeof text !== 'string') { console.warn(`[WorkerEngine] Asset not found in KV for '${assetPath}'`); continue; }
        const t = this.parseTemplateFromString(text);
        this.templates.set(t.name, t);
      } catch (e: any) {
        console.warn(`[WorkerEngine] Failed to read KV asset '${assetPath}': ${e?.message || e}`);
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
