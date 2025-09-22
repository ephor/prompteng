#!/usr/bin/env node

import { Command } from 'commander';
import { PromptEngine, TestRunner, AIProvider, OpenAIProvider } from '@prompteng/core';
import * as fs from 'fs';
import * as path from 'path';

const program = new Command();

program
  .name('prompteng')
  .description('PromptEng CLI for prompt engineering')
  .version('1.0.0');

program.command('init')
  .description('Initialize a new PromptEng project')
  .action(async () => {
    console.log('Initializing PromptEng project...');
    const workspaceRoot = process.cwd();

    const dirs = [
      'prompts/templates',
      'prompts/tests',
      'types'
    ];

    for (const dir of dirs) {
      const fullPath = path.join(workspaceRoot, dir);
      await fs.promises.mkdir(fullPath, { recursive: true });
      console.log(`Created directory: ${dir}`);
    }

    // Create example template
    const exampleTemplate = `---
name: "example"
description: "Example template"
author: "your-name"
version: "1.0.0"
variables:
  - name: "topic"
    type: "string"
    required: true
    description: "The topic to discuss"
---
Write a short paragraph about {{topic}}.
`;

    const templatePath = path.join(workspaceRoot, 'prompts/templates/example.ptemplate');
    await fs.promises.writeFile(templatePath, exampleTemplate);
    console.log('Created example template: prompts/templates/example.ptemplate');

    // Create example test
    const exampleTest = `template: "example"
description: "Test example template"

providers:
  - name: "mock"
    model: "mock-1"

test_cases:
  - name: "Basic topic"
    variables:
      topic: "artificial intelligence"
    assertions:
      - contains: "artificial intelligence"
`;

    const testPath = path.join(workspaceRoot, 'prompts/tests/example.ptest');
    await fs.promises.writeFile(testPath, exampleTest);
    console.log('Created example test: prompts/tests/example.ptest');

    console.log('\nPromptEng project initialized! Run "prompteng test" to run the example test.');
  });

program.command('build')
  .description('Build templates manifest and types')
  .option('-o, --out <dir>', 'Output directory', 'dist')
  .action(async (options) => {
    const workspaceRoot = process.cwd();
    const outDir = path.resolve(workspaceRoot, options.out);
    const engine = new PromptEngine(path.join(workspaceRoot, 'prompts', 'templates'));

    await fs.promises.mkdir(outDir, { recursive: true });

    // 1) Emit types
    const typesOut = path.join(outDir, 'types');
    await fs.promises.mkdir(typesOut, { recursive: true });
    const dts = engine.generateTypeDefinitions();
    await fs.promises.writeFile(path.join(typesOut, 'prompts.d.ts'), dts);

    // 2) Emit manifest.json
    const manifestPath = path.join(outDir, 'prompteng.manifest.json');
    const manifest = await buildManifest(engine);
    await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    console.log(`Build complete.\n- Types: ${path.relative(workspaceRoot, path.join(typesOut, 'prompts.d.ts'))}\n- Manifest: ${path.relative(workspaceRoot, manifestPath)}`);
  });

program.command('run')
  .description('Render a template with variables')
  .requiredOption('-t, --template <name>', 'Template name')
  .option('--vars <json>', 'Variables as JSON string')
  .option('--varsFile <path>', 'Path to JSON file with variables')
  .action(async (options) => {
    const workspaceRoot = process.cwd();
    const engine = new PromptEngine(path.join(workspaceRoot, 'prompts', 'templates'));

    let vars: Record<string, any> = {};
    if (options.varsFile) {
      const filePath = path.resolve(process.cwd(), options.varsFile);
      const content = await fs.promises.readFile(filePath, 'utf-8');
      vars = JSON.parse(content);
    } else if (options.vars) {
      vars = JSON.parse(options.vars);
    }

    // Keep types up to date automatically
    await ensureTypes(engine, workspaceRoot);

    const rendered = await engine.render(options.template, vars);
    process.stdout.write(rendered + '\n');
  });

program.command('test')
  .description('Run prompt tests')
  .option('-p, --pattern <pattern>', 'Test file pattern', '**/*.ptest')
  .action(async (options) => {
    console.log(`Running tests matching ${options.pattern}...`);
    const workspaceRoot = process.cwd();
    const engine = new PromptEngine(path.join(workspaceRoot, 'prompts', 'templates'));

    // Keep types up to date automatically
    await ensureTypes(engine, workspaceRoot);

    // Initialize providers
    const providers: AIProvider[] = [];
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (openaiApiKey) {
      try {
        providers.push(new OpenAIProvider(openaiApiKey));
        console.log('Using OpenAI provider');
      } catch (error) {
        console.warn('Failed to initialize OpenAI provider:', error);
      }
    }
    if (providers.length === 0) {
      // Add a mock provider if no real providers are available
      providers.push({
        name: 'mock',
        models: ['mock-1'],
        async complete(prompt: string) {
          const text = `Mock response for prompt: ${prompt}`;
          const tokens = Math.ceil(text.length / 4);
          return {
            text,
            tokenUsage: { prompt: tokens, completion: tokens, total: tokens * 2 },
          };
        },
        estimateTokens(text: string): number { return Math.ceil(text.length / 4); },
        getMaxTokens(): number { return 8192; }
      });
      console.log('Using mock provider. Set OPENAI_API_KEY for real completions.');
    }

    const testRunner = new TestRunner(engine, providers);

    // Find all test files
    const testFiles = await findFiles(workspaceRoot, options.pattern);
    if (testFiles.length === 0) {
      console.log('No test files found.');
      return;
    }

    let totalPassed = 0;
    let totalFailed = 0;

    for (const testFile of testFiles) {
      console.log(`\nRunning ${path.relative(workspaceRoot, testFile)}`);
      try {
        const results = await testRunner.runTests(testFile);
        console.log(`  Passed: ${results.passed}, Failed: ${results.failed}`);
        totalPassed += results.passed;
        totalFailed += results.failed;
      } catch (error: any) {
        console.error(`  Error: ${error.message}`);
        totalFailed++;
      }
    }

    console.log(`\nTotal: Passed: ${totalPassed}, Failed: ${totalFailed}`);
  });

program.command('generate-types')
  .description('Generate TypeScript types for templates')
  .option('-o, --out <file>', 'Output file', 'types/prompts.d.ts')
  .action(async (options) => {
    console.log(`Generating types to ${options.out}...`);
    const workspaceRoot = process.cwd();
    const engine = new PromptEngine(path.join(workspaceRoot, 'prompts', 'templates'));

    const types = engine.generateTypeDefinitions();
    const outPath = path.join(workspaceRoot, options.out);
    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
    await fs.promises.writeFile(outPath, types);
    console.log(`Types generated at ${options.out}`);
  });

program.parse();

async function ensureTypes(engine: PromptEngine, workspaceRoot: string) {
  try {
    const dts = engine.generateTypeDefinitions();
    const typesDir = path.join(workspaceRoot, 'types');
    await fs.promises.mkdir(typesDir, { recursive: true });
    await fs.promises.writeFile(path.join(typesDir, 'prompts.d.ts'), dts);
  } catch (e) {
    console.warn('Failed to generate types:', e);
  }
}

async function buildManifest(engine: PromptEngine) {
  const templates = engine.listTemplates().map(name => {
    const t = engine.getTemplate(name)!;
    return {
      name: t.name,
      description: t.metadata.description,
      author: t.metadata.author,
      version: t.metadata.version,
      tags: t.metadata.tags,
      variables: t.variables.map(v => ({
        name: v.name,
        type: v.type,
        required: !!v.required,
        description: v.description || ''
      }))
    };
  });

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    templates
  };
}

async function findFiles(dir: string, pattern: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      results.push(...await findFiles(fullPath, pattern));
    } else if (entry.isFile() && matchesPattern(entry.name, pattern)) {
      results.push(fullPath);
    }
  }

  return results;
}

function matchesPattern(filename: string, pattern: string): boolean {
  // Simple glob matching for **/*.ptest
  if (pattern === '**/*.ptest') {
    return filename.endsWith('.ptest');
  }
  return filename.includes(pattern.replace('*', ''));
}
