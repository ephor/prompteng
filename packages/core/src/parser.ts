import { Liquid, Tag, TagToken, TopLevelToken, Context, Emitter, Value, Template } from 'liquidjs';

type Constraint = { type: 'must_include_each'; words: string[] };
type Sections = Record<string, string>;
interface PromptEngMeta { constraints: Constraint[]; sections: Sections }

export class TemplateParser {
  private engine: Liquid;

  constructor() {
    this.engine = new Liquid({
      cache: true,
      jsTruthy: true,
      // keep strictVariables false to allow partial vars; our Engine.validateVariables handles requireds
      strictVariables: false,
    });

    // Example custom tag: upper implemented as a Tag subclass
    class UpperTag extends Tag {
      private value: Value;
      constructor(tagToken: TagToken, remainTokens: TopLevelToken[], liquid: Liquid) {
        super(tagToken, remainTokens, liquid);
        this.value = new Value(tagToken.args, liquid);
      }
      *render(ctx: Context): Generator<unknown, string, unknown> {
        const str = yield this.value.value(ctx);
        return String(str).toUpperCase();
      }
    }
    this.engine.registerTag('upper', UpperTag);

    // Helpful filters for prompt ergonomics
    this.registerFilter('join', (arr: unknown, sep: string = ', ') => Array.isArray(arr) ? arr.join(sep) : String(arr ?? ''));
    this.registerFilter('uniq', (arr: unknown) => Array.isArray(arr) ? Array.from(new Set(arr)) : arr);
    this.registerFilter('default', (val: unknown, def: unknown) => (val === undefined || val === null || val === '') ? def : val);
    this.registerFilter('length', (v: unknown) => {
      if (Array.isArray(v)) return v.length;
      if (typeof v === 'string') return v.length;
      if (v !== null && typeof v === 'object') return Object.keys(v as Record<string, unknown>).length;
      return 0;
    });
    this.registerFilter('lower', (s: unknown) => String(s ?? '').toLowerCase());
    this.registerFilter('upper', (s: unknown) => String(s ?? '').toUpperCase());
    this.registerFilter('compact', (arr: unknown) => Array.isArray(arr) ? arr.filter(Boolean) : arr);
    this.registerFilter('sort', (arr: unknown) => Array.isArray(arr) ? [...arr].sort() : arr);

    // Constraint tag: must_include_each <array|string>
    class MustIncludeEachTag extends Tag {
      private value: Value;
      constructor(tagToken: TagToken, remainTokens: TopLevelToken[], liquid: Liquid) {
        super(tagToken, remainTokens, liquid);
        this.value = new Value(tagToken.args, liquid);
      }
      *render(ctx: Context): Generator<unknown, string, unknown> {
        const raw = yield this.value.value(ctx);
        const words = Array.isArray(raw)
          ? (raw as unknown[]).map((x) => String(x))
          : (typeof raw === 'string' ? raw.split(',').map((s) => s.trim()).filter(Boolean) : []);
        let meta = ctx.get(['__promptengMeta']) as PromptEngMeta | undefined;
        if (!meta) { meta = { constraints: [], sections: {} }; ctx.push({ __promptengMeta: meta }); }
        meta.constraints.push({ type: 'must_include_each', words });
        return words.length ? `IMPORTANT: You MUST use EACH of these words at least once: ${words.join(', ')}.` : '';
      }
    }
    this.engine.registerTag('must_include_each', MustIncludeEachTag);

    // Block tag: section <name> ... endsection
    // Captures inner content into __promptengMeta.sections[name] and does not emit output inline
    class SectionTag extends Tag {
      private nameArg: string;
      private templates: Template[] = [];
      constructor(tagToken: TagToken, remainTokens: TopLevelToken[], liquid: Liquid) {
        super(tagToken, remainTokens, liquid);
        // Accept either quoted string ("prompt") or bare identifier (prompt) as literal section name
        this.nameArg = (tagToken.args || '').trim();
        const stream = this.liquid.parser.parseStream(remainTokens)
          .on('template', (tpl: Template) => this.templates.push(tpl))
          .on('tag:endsection', () => { stream.stop(); })
          .on('end', () => { throw new Error(`tag ${tagToken.getText()} not closed`); });
        stream.start();
      }
      *render(ctx: Context): Generator<unknown, string, unknown> {
        let name = this.nameArg;
        if ((name.startsWith('"') && name.endsWith('"')) || (name.startsWith("'") && name.endsWith("'"))) {
          name = name.slice(1, -1);
        }
        let meta = ctx.get(['__promptengMeta']) as PromptEngMeta | undefined;
        if (!meta) { meta = { constraints: [], sections: {} }; ctx.push({ __promptengMeta: meta }); }
        class CaptureEmitter implements Emitter {
          buffer: string = '';
          write(html: string): void { this.buffer += html; }
          raw(html?: string): void { if (html) this.buffer += html; }
        }
        const emitter = new CaptureEmitter();
        yield this.liquid.renderer.renderTemplates(this.templates, ctx, emitter);
        meta.sections[name] = emitter.buffer;
        return '';
      }
    }
    this.engine.registerTag('section', SectionTag);
  }

  public async render(template: string, variables: Record<string, any>): Promise<string> {
    return this.engine.parseAndRender(template, variables);
  }

  public async renderWithMeta(template: string, variables: Record<string, unknown>): Promise<{ text: string; meta: PromptEngMeta }> {
    const meta: PromptEngMeta = { constraints: [], sections: {} };
    const scope: Record<string, unknown> = { ...variables, __promptengMeta: meta };
    const text = await this.engine.parseAndRender(template, scope);
    return { text, meta };
  }

  // Allow consumers (and our Engine later) to register custom filters/tags
  public registerFilter(name: string, fn: Parameters<Liquid['registerFilter']>[1]) {
    this.engine.registerFilter(name, fn);
  }

  public registerTag(name: string, impl: Parameters<Liquid['registerTag']>[1]) {
    this.engine.registerTag(name, impl);
  }
}
