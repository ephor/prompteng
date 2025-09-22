# @prompteng/core

PromptEng Core is a type-safe, testable prompt templating and rendering engine powered by LiquidJS. It is designed for safe user-authored templates, strong extensibility (custom tags/filters), and first-class testing with Vitest.

- Safe, logic-light templating via [LiquidJS](https://liquidjs.com/)
- Custom tags/filters in TypeScript (e.g., sections, constraints)
- Multi-output rendering (e.g., `{ system, prompt }`) using `{% section %}`
- Simple prompt tests (`.ptest`) with contains/not_contains assertions
- Type generation from template frontmatter

## Install

```sh
npm i @prompteng/core
# or
pnpm add @prompteng/core
```

Requires Node 18+.

## Templates (.ptemplate)

Each template file uses YAML frontmatter for metadata and variables, followed by Liquid content. You can define multiple named outputs using the `section` block.

```liquid
---
name: "email-welcome"
description: "Welcome email generator"
variables:
  - name: recipientName
    type: string
    required: true
  - name: productName
    type: string
    required: true
---
{% section 'system' %}
You are a helpful assistant writing concise, friendly emails.
{% endsection %}

{% section 'prompt' %}
Write a short welcome email for {{ recipientName }} to introduce {{ productName }}.
End with a friendly call-to-action.
{% endsection %}
```

## Tests (.ptest)

Prompt tests are YAML files that reference a template by name and define test cases. Assertions validate the final rendered output returned by the provider.

```yaml
template: "email-welcome"
description: "Welcome email basic test"

providers:
  - name: "mock"
    model: "mock-1"

test_cases:
  - name: "Simple welcome"
    variables:
      recipientName: "Ada"
      productName: "Acme"
    assertions:
      - contains: "Acme"
      - not_contains: "unsubscribe"
```

## Usage

Render a single output string:

```ts
import { PromptEngine } from '@prompteng/core';

const engine = new PromptEngine('prompts/templates');
const text = await engine.render('email-welcome', {
  recipientName: 'Ada',
  productName: 'Acme'
});
```

Render multiple sections with metadata (e.g., `{ system, prompt }`):

```ts
const { sections } = await engine.renderWithMeta('email-welcome', {
  recipientName: 'Ada',
  productName: 'Acme'
});
// sections.system, sections.prompt
```

Or directly get a name->text map:

```ts
const out = await engine.renderMulti('email-welcome', { recipientName: 'Ada', productName: 'Acme' });
// { system: string, prompt: string }
```

## Templating guide (self‑contained)

PromptEng uses a Liquid-compatible syntax, but you don’t need the Liquid docs to get started. This guide summarizes what you’ll use 90% of the time when writing `.ptemplate` files.

### Cheatsheet

```liquid
{{ variable }}                  # print a variable
{{ var | default: 'fallback' }} # filters mutate output
{%- assign x = 1 -%}            # assign a value (whitespace-trimmed)
{%- capture buf -%}...{%- endcapture -%}  # capture rendered text into a variable

{% if cond %}...{% elsif other %}...{% else %}...{% endif %}
{% case kind %}{% when 'a' %}...{% when 'b' %}...{% else %}...{% endcase %}
{% for item in list %}{{ forloop.index }}. {{ item }}{% endfor %}

{% section 'name' %}...{% endsection %}  # capture a named output (e.g., system, prompt)
{% render 'partial.liquid' %}            # include a partial file (optional)
```

Whitespace control: use `-{%` and `%}-` (or `{{-`/`-}}`) to trim spaces/newlines around tags.

### Variables and filters

```liquid
Hello, {{ userName | default: 'friend' }}!
You picked: {{ items | uniq | join: ', ' }}
Count: {{ items | length }}
Lower: {{ brand | lower }}  Upper: {{ brand | upper }}
```

Built‑in helper filters (shipped by PromptEng):
- `join`, `uniq`, `default`, `length`, `lower`, `upper`, `compact`, `sort`

### Control flow

```liquid
{% if plan == 'pro' %}
  Thanks for being a Pro user!
{% elsif plan == 'free' %}
  You’re on the free plan.
{% else %}
  Welcome!
{% endif %}

{% case locale %}
  {% when 'en' %}Hello
  {% when 'es' %}Hola
  {% else %}Hi
{% endcase %}
```

### assign and capture

```liquid
{%- assign tone = tone | default: 'friendly' -%}

{%- capture style -%}
{% case tone %}
  {% when 'friendly' %}Warm and concise.
  {% when 'professional' %}Precise and respectful.
  {% else %}Neutral.
{% endcase %}
{%- endcapture -%}

Style: {{ style | strip }}
```

### Loops and helpers

```liquid
{% for w in words %}
  {{ forloop.index }}. {{ w }}
{% endfor %}

{%- assign top3 = words | uniq | sort -%}
Top picks: {{ top3 | join: ', ' }}
```

### Partials (optional)

If you organize fragments into partial files, you can include them:

```liquid
{% render 'partials/header.liquid' %}
```

### Sections (multi‑output)

Use sections to produce multiple named outputs in one render (e.g., `system`, `prompt`). They do not emit inline text; the engine captures their content.

```liquid
{% section 'system' %}
System instruction here.
{% endsection %}

{% section 'prompt' %}
User‑facing prompt here.
{% endsection %}
```

Read them back with `renderWithMeta()` or `renderMulti()`.

### Constraint tags

PromptEng includes an example constraint tag you can use and extend:

- `{% must_include_each words %}`
  - Adds a clear instruction for the model.
  - Records the requirement in metadata so test tools can validate later.

Example:

```liquid
{% must_include_each primaryTerms %}
```

### Custom filters and tags

Register filters:

```ts
engine.registerFilter('truncate_words', (s: unknown, n = 12) => {
  const words = String(s ?? '').split(/\s+/);
  return words.length <= n ? words.join(' ') : words.slice(0, n).join(' ') + '…';
});
```

Register class‑based tags (extends `Tag`):

```ts
import { Liquid, Tag, TagToken, TopLevelToken, Context, Value } from 'liquidjs';

class UpperTag extends Tag {
  private value: Value;
  constructor(token: TagToken, remain: TopLevelToken[], liquid: Liquid) {
    super(token, remain, liquid);
    this.value = new Value(token.args, liquid);
  }
  *render(ctx: Context) {
    const v = yield this.value.value(ctx);
    return String(v).toUpperCase();
  }
}

engine.registerTag('upper', UpperTag);
```

## Quick Reference

- **Variables**
  - Print: `{{ name }}`
  - With default: `{{ name | default: 'N/A' }}`
  - Assign: `{% assign x = 1 %}` (use `{%-`/`-%}` to trim whitespace)
  - Capture: `{% capture buf %}...{% endcapture %}`

- **Control flow**
  - If: `{% if cond %}...{% elsif other %}...{% else %}...{% endif %}`
  - Case: `{% case kind %}{% when 'a' %}...{% else %}...{% endcase %}`
  - Loop: `{% for it in list %}{{ forloop.index }}. {{ it }}{% endfor %}`

- **Sections (multi-output)**
  - `{% section 'system' %}...{% endsection %}`
  - Read via `engine.renderWithMeta()` or `engine.renderMulti()`.

- **Built-in helper filters**
  - `default`, `join`, `uniq`, `length`, `lower`, `upper`, `compact`, `sort`

- **Constraints (example)**
  - `{% must_include_each words %}` — instructs and records metadata for tests.

- **Partials (optional)**
  - `{% render 'partials/header.liquid' %}`

## Cookbook

### 1) Tone/style switch with assign + capture + case/when

```liquid
{%- assign tone = tone | default: 'friendly' -%}
{%- capture style -%}
{% case tone %}
  {% when 'friendly' %}Warm and concise.
  {% when 'professional' %}Precise and respectful.
  {% else %}Neutral.
{% endcase %}
{%- endcapture -%}
Style: {{ style | strip }}
```

### 2) Multi-output prompts (system + prompt)

```liquid
{% section 'system' %}
You are a helpful assistant.
{% endsection %}

{% section 'prompt' %}
Write a short note for {{ userName | default: 'friend' }}.
{% endsection %}
```

```ts
const out = await engine.renderMulti('template-name', { userName: 'Ada' });
// out.system, out.prompt
```

### 3) List processing (uniq, sort, join)

```liquid
{%- assign picks = terms | default: [] | uniq | sort -%}
Use these: {{ picks | join: ', ' }}
```

### 4) Partials

```liquid
{% render 'partials/header.liquid' %}
Main content...
{% render 'partials/footer.liquid' %}
```

### 5) Simple .ptest for contains/not_contains

```yaml
template: "email-welcome"
description: "Smoke test"
providers:
  - name: "mock"
    model: "mock-1"
test_cases:
  - name: "Basic"
    variables: { recipientName: "Ada", productName: "Acme" }
    assertions:
      - contains: "Acme"
      - not_contains: "unsubscribe"
```

## Generate Types

From template frontmatter, PromptEng can generate TypeScript types for variables:

```ts
import { PromptEngine } from '@prompteng/core';
const engine = new PromptEngine('prompts/templates');
const dts = engine.generateTypeDefinitions();
```

## Testing (Vitest)

```sh
pnpm -F @prompteng/core test
```

Internally, tests use a `TestRunner` that:
- Loads `.ptest` files
- Renders templates with a provider (mock or real)
- Validates `contains` and `not_contains` assertions

## Publishing

This repo uses a unified CI & Release workflow with Changesets (see `.github/workflows/ci-release.yml`). When a Changesets “Version Packages” PR is merged into `main`, the pipeline will:

- Install deps, build the workspace, and run tests (Vitest)
- Version packages and generate changelogs via Changesets
- Publish updated packages to npm (`@prompteng/core`, `@prompteng/cli`, etc.)

Setup required:
- Add `NPM_TOKEN` as a repository secret for publishing.

Developer flow:
- Run `pnpm changeset` to create a changeset describing your changes and bump type.
- Commit and push; CI opens/updates a “Version Packages” PR.
- Merge that PR to `main` to publish to npm.

## License

MIT
