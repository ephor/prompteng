import { TemplateParser } from './parser';
import { PromptTemplate, ValidationResult } from './types';

export async function renderCommon(
  parser: TemplateParser,
  templates: Map<string, PromptTemplate>,
  templateName: string,
  variables: Record<string, any>
): Promise<string> {
  const template = templates.get(templateName);
  if (!template) {
    throw new Error(`Template '${templateName}' not found.`);
  }
  validateVariablesCommon(templates, templateName, variables);
  return parser.render(template.content, variables);
}

export async function renderWithMetaCommon(
  parser: TemplateParser,
  templates: Map<string, PromptTemplate>,
  templateName: string,
  variables: Record<string, any>
): Promise<{ text: string; sections: Record<string, string>; constraints: any[] }> {
  const template = templates.get(templateName);
  if (!template) {
    throw new Error(`Template '${templateName}' not found.`);
  }
  validateVariablesCommon(templates, templateName, variables);
  const { text, meta } = await parser.renderWithMeta(template.content, variables);
  const sections = meta?.sections || {};
  const constraints = meta?.constraints || [];
  return { text, sections, constraints };
}

export async function renderMultiCommon(
  parser: TemplateParser,
  templates: Map<string, PromptTemplate>,
  templateName: string,
  variables: Record<string, any>
): Promise<Record<string, string>> {
  const { text, sections } = await renderWithMetaCommon(parser, templates, templateName, variables);
  if (!sections || Object.keys(sections).length === 0) {
    return { prompt: text };
  }
  return sections;
}

export function validateVariablesCommon(
  templates: Map<string, PromptTemplate>,
  templateName: string,
  variables: Record<string, any>
): ValidationResult {
  const template = templates.get(templateName);
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

export function generateTypeDefinitionsCommon(templates: Map<string, PromptTemplate>): string {
  const interfaces: string[] = [];
  for (const [name, template] of templates) {
    const interfaceName = toPascalCase(name) + 'Variables';
    const properties: string[] = [];
    for (const varDef of template.variables) {
      const tsType = mapToTsType(varDef.type);
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

export function toPascalCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

export function mapToTsType(type: string): string {
  switch (type) {
    case 'string': return 'string';
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'array': return 'any[]';
    case 'object': return 'Record<string, any>';
    default: return 'any';
  }
}
