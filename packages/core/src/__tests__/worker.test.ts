import { describe, it, expect, beforeEach } from 'vitest';
import { WorkerEngine, registerVfs } from '../worker';

function tpl(front: string, body: string) {
  return `---\n${front}\n---\n${body.trim()}\n`;
}

describe('WorkerEngine (VFS)', () => {
  beforeEach(() => {
    // fresh VFS per test
    (globalThis as any).__PROMPTENG_VFS__ = undefined;
  });

  it('loads templates from virtual FS and lists them', async () => {
    registerVfs({
      '/prompts/templates/greet.ptemplate': tpl(
        [
          'name: greet',
          'variables:',
          '  - name: name',
          '    type: string',
          '    required: true',
        ].join('\n'),
        'Hello {{ name }}'
      ),
    });

    const engine = new WorkerEngine('/prompts/templates');
    // force lazy load
    const text = await engine.render('greet', { name: 'Ada' });
    expect(text).toBe('Hello Ada');

    const names = engine.listTemplates();
    expect(names).toEqual(expect.arrayContaining(['greet']));
    const t = engine.getTemplate('greet');
    expect(t?.name).toBe('greet');
  });

  it('supports sections and renderMulti fallback', async () => {
    registerVfs({
      '/prompts/templates/with-system.ptemplate': tpl(
        [
          'name: with-system',
          'variables:',
          '  - name: name',
          '    type: string',
          '    required: false',
        ].join('\n'),
        `
{% section system %}You are a helpful assistant.{% endsection %}
{% section prompt %}Hello {{ name | default: 'world' }}{% endsection %}
Footer
`
      ),
      '/prompts/templates/no-sections.ptemplate': tpl(
        [
          'name: no-sections',
          'variables:',
          '  - name: x',
          '    type: string',
          '    required: false',
        ].join('\n'),
        'Plain {{ x | default: "ok" }}'
      ),
    });

    const engine = new WorkerEngine('/prompts/templates');

    const { text, sections } = await engine.renderWithMeta('with-system', { name: 'Bob' });
    expect(text.trim()).toBe('Footer');
    expect(sections.system).toBe('You are a helpful assistant.');
    expect(sections.prompt).toBe('Hello Bob');

    const multi = await engine.renderMulti('with-system', { name: 'Bob' });
    expect(multi).toEqual({ system: 'You are a helpful assistant.', prompt: 'Hello Bob' });

    const fallback = await engine.renderMulti('no-sections', {});
    expect(fallback).toEqual({ prompt: 'Plain ok' });
  });

  it('validates required variables', async () => {
    registerVfs({
      '/prompts/templates/greet.ptemplate': tpl(
        [
          'name: greet',
          'variables:',
          '  - name: name',
          '    type: string',
          '    required: true',
        ].join('\n'),
        'Hello {{ name }}'
      ),
    });
    const engine = new WorkerEngine('/prompts/templates');
    const res = engine.validateVariables('greet', {});
    expect(res.valid).toBe(false);
    expect(res.errors.join('\n')).toMatch(/Missing required variable: 'name'/);
  });

  it('generates type definitions', async () => {
    registerVfs({
      '/prompts/templates/typed.ptemplate': tpl(
        [
          'name: typed',
          'variables:',
          '  - name: topic',
          '    type: string',
          '    required: true',
          '    description: The topic',
          '  - name: optional',
          '    type: number',
          '    required: false',
        ].join('\n'),
        'Topic: {{ topic }}'
      ),
    });
    const engine = new WorkerEngine('/prompts/templates');
    const dts = engine.generateTypeDefinitions();
    expect(dts).toMatch(/export interface TypedVariables/);
    expect(dts).toMatch(/topic: string; \/\/ The topic/);
    expect(dts).toMatch(/optional\?: number;/);
  });
});
