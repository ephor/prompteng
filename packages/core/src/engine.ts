import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { PromptTemplate, ValidationResult } from './types';
import { TemplateParser } from './parser';

export interface EngineOptions {
  // Options for future enhancements
}

export class PromptEngine {
  private templates: Map<string, PromptTemplate> = new Map();
  private parser: TemplateParser;

  constructor(private templateDir: string, options?: EngineOptions) {
    this.parser = new TemplateParser();
    this.loadTemplatesFromDir(templateDir);
  }

  // Expose parser extension points
  registerFilter(name: string, fn: (...args: any[]) => any) {
    this.parser.registerFilter(name, fn);
  }

  registerTag(name: string, impl: any) {
    this.parser.registerTag(name, impl);
  }

  private loadTemplatesFromDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      console.warn(`Template directory not found: ${dir}`);
      return;
    }

    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (path.extname(file) === '.ptemplate') {
        const filePath = path.join(dir, file);
        this.loadTemplate(filePath);
      }
    }
  }

  private loadTemplate(filePath: string): void {
    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const parts = fileContent.split('---');
      if (parts.length < 3) {
        throw new Error('Invalid template format: missing frontmatter.');
      }

      const frontmatter = yaml.load(parts[1]) as any;
      const content = parts.slice(2).join('---').trim();

      const template: PromptTemplate = {
        name: frontmatter.name,
        content: content,
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

      this.templates.set(template.name, template);
    } catch (error: any) {
      console.error(`Failed to load template ${filePath}: ${error.message}`);
    }
  }

  /**
   * Render a template into a single combined string.
   *
   * Use this when your template does not use `{% section %}` blocks or when you only
   * need the concatenated text output.
   *
   * See also:
   * - {@link PromptEngine.renderWithMeta} — returns `{ text, sections, constraints }`.
   * - {@link PromptEngine.renderMulti} — returns a section map and falls back to `{ prompt: text }` when no sections present.
   */
  async render(templateName: string, variables: Record<string, any>): Promise<string> {
    const template = this.templates.get(templateName);
    if (!template) {
      throw new Error(`Template '${templateName}' not found.`);
    }

    this.validateVariables(templateName, variables);
    return this.parser.render(template.content, variables);
  }

  /**
   * Render a template and return both the final text and metadata.
   *
   * Returns:
   * - `text`: the full combined output string.
   * - `sections`: a map of named outputs captured via `{% section 'name' %}...{% endsection %}`.
   * - `constraints`: structured metadata (e.g., from constraint tags) useful for tests/validation.
   *
   * Use this when you need access to sections and/or constraints in addition to the combined text.
   */
  async renderWithMeta(templateName: string, variables: Record<string, any>): Promise<{ text: string; sections: Record<string, string>; constraints: any[] }> {
    const template = this.templates.get(templateName);
    if (!template) {
      throw new Error(`Template '${templateName}' not found.`);
    }
    this.validateVariables(templateName, variables);
    const { text, meta } = await this.parser.renderWithMeta(template.content, variables);
    const sections = (meta && meta.sections) || {};
    const constraints = (meta && meta.constraints) || [];
    return { text, sections, constraints };
  }

  /**
   * Convenience wrapper that always returns a name→text map of sections.
   *
   * If the template defines no sections, this method falls back to `{ prompt: text }`.
   * Use this when the caller expects a section map (e.g., `{ system, prompt }`) and
   * does not need constraints.
   */
  async renderMulti(templateName: string, variables: Record<string, any>): Promise<Record<string, string>> {
    const { text, sections } = await this.renderWithMeta(templateName, variables);
    if (!sections || Object.keys(sections).length === 0) {
      // fallback: treat whole output as a single 'prompt' section
      return { prompt: text };
    }
    return sections;
  }

  validateVariables(templateName: string, variables: Record<string, any>): ValidationResult {
    const template = this.templates.get(templateName);
    if (!template) {
      throw new Error(`Template '${templateName}' not found.`);
    }

    const errors: string[] = [];
    for (const varDef of template.variables) {
      if (varDef.required && !(varDef.name in variables)) {
        errors.push(`Missing required variable: '${varDef.name}'`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  getTemplate(templateName: string): PromptTemplate | undefined {
    return this.templates.get(templateName);
  }

  listTemplates(): string[] {
    return Array.from(this.templates.keys());
  }
  
  generateTypeDefinitions(): string {
    const interfaces: string[] = [];

    for (const [name, template] of this.templates) {
      const interfaceName = this.toPascalCase(name) + 'Variables';
      const properties: string[] = [];

      for (const varDef of template.variables) {
        const tsType = this.mapToTsType(varDef.type);
        const optional = varDef.required ? '' : '?';
        const comment = varDef.description ? ` // ${varDef.description}` : '';
        properties.push(`    ${varDef.name}${optional}: ${tsType};${comment}`);
      }

      if (properties.length > 0) {
        interfaces.push(`export interface ${interfaceName} {\n${properties.join('\n')}\n}`);
      }
    }

    return interfaces.join('\n\n');
  }

  private toPascalCase(str: string): string {
    return str
      .split(/[-_\s]+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  }

  private mapToTsType(type: string): string {
    switch (type) {
      case 'string': return 'string';
      case 'number': return 'number';
      case 'boolean': return 'boolean';
      case 'array': return 'any[]';
      case 'object': return 'Record<string, any>';
      default: return 'any';
    }
  }
}
