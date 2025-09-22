import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PromptEngine } from '../engine';

function writeTemplate(dir: string, fileName: string, frontmatter: any, body: string) {
  const fm = ['---',
    `name: ${frontmatter.name}`,
    frontmatter.variables ? `variables:\n${frontmatter.variables.map((v: any) => `  - name: ${v.name}\n    type: ${v.type}\n    required: ${v.required}`).join('\n')}` : '',
    frontmatter.description ? `description: ${JSON.stringify(frontmatter.description)}` : '',
    frontmatter.author ? `author: ${JSON.stringify(frontmatter.author)}` : '',
    frontmatter.version ? `version: ${JSON.stringify(frontmatter.version)}` : '',
    '---' ].filter(Boolean).join('\n');
  const content = `${fm}\n${body.trim()}\n`;
  fs.writeFileSync(path.join(dir, fileName), content, 'utf-8');
}

describe('PromptEngine (unit)', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompteng-core-tests-'));
    // greet template (no sections)
    writeTemplate(tmpDir, 'greet.ptemplate', {
      name: 'greet',
      variables: [ { name: 'name', type: 'string', required: true } ]
    }, `Hello {{ name }}`);

    // with-sections template
    writeTemplate(tmpDir, 'with-sections.ptemplate', {
      name: 'with-sections',
      variables: [ { name: 'name', type: 'string', required: false }, { name: 'words', type: 'array', required: false } ]
    }, `
{% must_include_each words %}
{% section prompt %}Hello {{ name | default: 'world' }}{% endsection %}
Footer
`);

    // with-system template (captures both system and prompt sections)
    writeTemplate(tmpDir, 'with-system.ptemplate', {
      name: 'with-system',
      variables: [ { name: 'name', type: 'string', required: false } ]
    }, `
{% section system %}You are a helpful assistant.{% endsection %}
{% section prompt %}Hello {{ name | default: 'world' }}{% endsection %}
Footer
`);

    // no-sections template for renderMulti fallback
    writeTemplate(tmpDir, 'no-sections.ptemplate', {
      name: 'no-sections',
      variables: [ { name: 'x', type: 'string', required: false } ]
    }, `Plain {{ x | default: 'ok' }}`);
  });

  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('loads templates from directory and lists them', () => {
    const engine = new PromptEngine(tmpDir);
    const names = engine.listTemplates();
    expect(names).toEqual(expect.arrayContaining(['greet', 'with-sections', 'no-sections']));
    const t = engine.getTemplate('greet');
    expect(t?.name).toBe('greet');
    expect(t?.content).toContain('{{ name }}');
  });

  it('render returns interpolated text', async () => {
    const engine = new PromptEngine(tmpDir);
    const out = await engine.render('greet', { name: 'Ada' });
    expect(out).toBe('Hello Ada');
  });

  it('validateVariables reports missing required variables', () => {
    const engine = new PromptEngine(tmpDir);
    const res = engine.validateVariables('greet', {});
    expect(res.valid).toBe(false);
    expect(res.errors.join('\n')).toMatch(/Missing required variable: 'name'/);
  });

  it('renderWithMeta returns text, sections and constraints', async () => {
    const engine = new PromptEngine(tmpDir);
    const { text, sections, constraints } = await engine.renderWithMeta('with-sections', { name: 'Bob', words: ['alpha', 'beta'] });
    // must_include_each emits an IMPORTANT helper line before the footer
    expect(text).toContain('IMPORTANT:');
    expect(text).toContain('Footer');
    expect(sections).toBeDefined();
    expect(sections.prompt).toBe('Hello Bob');
    expect(constraints).toEqual(expect.arrayContaining([
      { type: 'must_include_each', words: ['alpha', 'beta'] }
    ]));
  });

  it('captures both system and prompt sections via renderWithMeta and renderMulti', async () => {
    const engine = new PromptEngine(tmpDir);
    const { text, sections } = await engine.renderWithMeta('with-system', { name: 'Bob' });
    expect(text.trim()).toBe('Footer');
    expect(sections.system).toBe('You are a helpful assistant.');
    expect(sections.prompt).toBe('Hello Bob');

    const multi = await engine.renderMulti('with-system', { name: 'Bob' });
    expect(multi).toEqual({ system: 'You are a helpful assistant.', prompt: 'Hello Bob' });
  });

  it('renderMulti falls back to { prompt: text } when no sections exist', async () => {
    const engine = new PromptEngine(tmpDir);
    const res = await engine.renderMulti('no-sections', {});
    expect(res).toEqual({ prompt: 'Plain ok' });
  });

  it('throws on missing template for render and renderWithMeta', async () => {
    const engine = new PromptEngine(tmpDir);
    await expect(engine.render('missing', {})).rejects.toThrow("Template 'missing' not found.");
    await expect(engine.renderWithMeta('missing', {})).rejects.toThrow("Template 'missing' not found.");
  });
});
