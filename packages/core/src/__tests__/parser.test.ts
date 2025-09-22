import { describe, it, expect } from 'vitest';
import { TemplateParser } from '../parser';

describe('TemplateParser', () => {
  it('renders variables with filters (join, upper)', async () => {
    const parser = new TemplateParser();
    const tpl = 'Names: {{ names | join: "; " | upper }}';
    const out = await parser.render(tpl, { names: ['alice', 'bob'] });
    expect(out).toBe('Names: ALICE; BOB');
  });

  it('supports custom tag: upper', async () => {
    const parser = new TemplateParser();
    const tpl = '{% upper name %}';
    const out = await parser.render(tpl, { name: 'MiXeD' });
    expect(out).toBe('MIXED');
  });

  it('captures sections via section/endsection and excludes them from output', async () => {
    const parser = new TemplateParser();
    const tpl = '{% section prompt %}Hello {{ name }}{% endsection %}\nBody';
    const { text, meta } = await parser.renderWithMeta(tpl, { name: 'Ada' });
    // Section captured
    expect(meta.sections.prompt).toBe('Hello Ada');
    // Section content not emitted inline
    expect(text.trim()).toBe('Body');
  });

  it('records constraints via must_include_each tag and returns helper text', async () => {
    const parser = new TemplateParser();
    const tpl = '{% must_include_each words %}';
    const { text, meta } = await parser.renderWithMeta(tpl, { words: ['red', 'green'] });
    expect(meta.constraints).toEqual([
      { type: 'must_include_each', words: ['red', 'green'] }
    ]);
    expect(text).toContain('IMPORTANT:');
    expect(text).toContain('red');
    expect(text).toContain('green');
  });

  it('render() returns only text, while renderWithMeta returns text+meta', async () => {
    const parser = new TemplateParser();
    const tpl = 'Hi {{ who | default: "world" }}';
    const out = await parser.render(tpl, {});
    expect(out).toBe('Hi world');

    const res = await parser.renderWithMeta(tpl, {});
    expect(res.text).toBe('Hi world');
    expect(res.meta).toBeDefined();
    expect(res.meta.sections).toBeDefined();
    expect(res.meta.constraints).toBeDefined();
  });
});
