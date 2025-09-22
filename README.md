# PromptEng Monorepo

Monorepo for PromptEng: core library, CLI, and VSCode extension.

## Packages

- packages/core — Core rendering engine, providers, testing framework
- packages/cli — Command-line interface for init/test/generate-types
- packages/vscode-extension — VSCode extension: syntax highlighting and commands

## Quickstart

Prerequisites: pnpm >= 9, Node 18+

Install dependencies:

```sh
pnpm install
```

### Core

Run tests (Vitest):

```sh
pnpm -F @prompteng/core test
```

Build:

```sh
pnpm -F @prompteng/core build
```

Generate types from templates:

```ts
import { PromptEngine } from '@prompteng/core';
const engine = new PromptEngine('prompts/templates');
const dts = engine.generateTypeDefinitions();
```

### CLI

Build:

```sh
pnpm -F @prompteng/cli build
```

Initialize a project structure:

```sh
node packages/cli/lib/index.js init
```

Run prompt tests:

```sh
# Optional: set real provider key
export OPENAI_API_KEY=sk-...

node packages/cli/lib/index.js test
```

Generate TypeScript types:

```sh
node packages/cli/lib/index.js generate-types
```

### VSCode Extension

Build:

```sh
pnpm -F prompteng-vscode build
```

Launch VSCode with this workspace and press F5 to start the Extension Development Host. The extension provides:

- Prompt Template syntax highlighting (`.ptemplate`)
- Prompt Test syntax highlighting (`.ptest`)
- Explorer views: "Prompt Templates" and "Prompt Tests"
- Commands:
  - "PromptEng: Run Prompt"
  - "PromptEng: Run Tests"
  - "PromptEng: Generate TypeScript Types"

To use OpenAI inside the extension, set:

Settings → Extensions → PromptEng → Providers → OpenAI API Key

## Conventions

- Testing uses Vitest.
- Templates live under `prompts/templates/`.
- Tests live under `prompts/tests/`.

## Roadmap

- Provider adapters beyond OpenAI
