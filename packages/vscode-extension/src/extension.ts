import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { PromptEngine, TestRunner, AIProvider, OpenAIProvider } from '@prompteng/core';

class MockProvider extends AIProvider {
  name = 'mock';
  models = ['mock-1'];
  async complete(prompt: string) {
    const text = `Mock response for prompt: ${prompt}`;
    const tokens = Math.ceil(text.length / 4);
    return {
      text,
      tokenUsage: { prompt: tokens, completion: tokens, total: tokens * 2 },
    };
  }
  estimateTokens(text: string): number { return Math.ceil(text.length / 4); }
  getMaxTokens(): number { return 8192; }
}

class TemplatesDataProvider implements vscode.TreeDataProvider<TemplateItem> {
  constructor(private engine: PromptEngine) {}

  getTreeItem(element: TemplateItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TemplateItem): Thenable<TemplateItem[]> {
    if (element) return Promise.resolve([]);
    
    const templates = this.engine.listTemplates();
    return Promise.resolve(templates.map(name => {
      const template = this.engine.getTemplate(name);
      return new TemplateItem(name, template?.metadata.description || '', vscode.TreeItemCollapsibleState.None);
    }));
  }
}

class TemplateItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly tooltip: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
    this.tooltip = tooltip;
    this.contextValue = 'template';
    this.iconPath = new vscode.ThemeIcon('file-text');
  }
}

class TestsDataProvider implements vscode.TreeDataProvider<TestItem> {
  constructor(private workspaceRoot: string) {}

  getTreeItem(element: TestItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TestItem): Promise<TestItem[]> {
    if (element) return [];
    
    const testFiles = await vscode.workspace.findFiles('**/*.ptest');
    return testFiles.map(uri => {
      const label = path.basename(uri.fsPath, '.ptest');
      return new TestItem(label, uri.fsPath, vscode.TreeItemCollapsibleState.None);
    });
  }
}

class TestItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly tooltip: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
    this.tooltip = tooltip;
    this.contextValue = 'test';
    this.iconPath = new vscode.ThemeIcon('beaker');
  }
}

export function activate(context: vscode.ExtensionContext) {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    vscode.window.showWarningMessage('PromptEng: Open a workspace to enable extension features.');
    return;
  }

  const templatesDir = path.join(workspaceRoot, 'prompts', 'templates');
  const engine = new PromptEngine(templatesDir);

  // Initialize providers - try OpenAI first, fallback to mock
  const providers: AIProvider[] = [];
  const openaiApiKey = vscode.workspace.getConfiguration('prompteng').get<string>('providers.openai.apiKey');
  if (openaiApiKey) {
    try {
      providers.push(new OpenAIProvider(openaiApiKey));
    } catch (error) {
      console.warn('Failed to initialize OpenAI provider:', error);
    }
  }
  if (providers.length === 0) {
    providers.push(new MockProvider());
    vscode.window.showInformationMessage('PromptEng: Using mock provider. Configure OpenAI API key for real completions.');
  }

  const testRunner = new TestRunner(engine, providers);

  const templatesProvider = new TemplatesDataProvider(engine);
  const testsProvider = new TestsDataProvider(workspaceRoot);

  vscode.window.registerTreeDataProvider('prompteng.templates', templatesProvider);
  vscode.window.registerTreeDataProvider('prompteng.tests', testsProvider);

  // Auto-generate types when templates change (no manual build step needed)
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.ptemplate');
  const regenerateTypes = async () => {
    try {
      const types = engine.generateTypeDefinitions();
      const typesDirPath = path.join(workspaceRoot, 'types');
      const typesFilePath = path.join(typesDirPath, 'prompts.d.ts');
      await fs.promises.mkdir(typesDirPath, { recursive: true });
      await fs.promises.writeFile(typesFilePath, types);
    } catch (e) {
      console.warn('PromptEng: Failed to regenerate types:', e);
    }
  };
  watcher.onDidCreate(regenerateTypes);
  watcher.onDidChange(regenerateTypes);
  watcher.onDidDelete(regenerateTypes);
  context.subscriptions.push(watcher);

  const runPrompt = vscode.commands.registerCommand('prompteng.runPrompt', async (arg?: vscode.Uri | TemplateItem) => {
    try {
      let templateName: string | undefined;

      if (arg instanceof TemplateItem) {
        templateName = arg.label;
      } else if (arg && arg.fsPath?.endsWith('.ptemplate')) {
        templateName = await getTemplateNameFromFile(arg.fsPath);
      } else {
        const activeUri = vscode.window.activeTextEditor?.document.uri;
        if (activeUri && activeUri.fsPath.endsWith('.ptemplate')) {
          templateName = await getTemplateNameFromFile(activeUri.fsPath);
        }
      }

      if (!templateName) {
        templateName = await vscode.window.showInputBox({ prompt: 'Template name', placeHolder: 'e.g. user-onboarding' });
      }
      if (!templateName) return;

      const variables = await promptForVariablesFromFrontmatter(templatesDir, templateName)
        || await promptForVariablesJson();

      const { text, sections } = await engine.renderWithMeta(templateName, variables);
      let content: string;
      if (sections && Object.keys(sections).length > 0) {
        // Render all sections in a single markdown doc, in a stable order
        const order = ['system', 'developer', 'prompt'];
        const keys = Array.from(new Set([...order, ...Object.keys(sections)]));
        const parts = keys
          .filter(k => sections[k] != null && String(sections[k]).trim().length > 0)
          .map(k => `### [${k}]\n\n${sections[k]}`);
        content = parts.join('\n\n---\n\n');
      } else {
        content = text;
      }

      const doc = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (err: any) {
      vscode.window.showErrorMessage(`PromptEng: ${err.message || String(err)}`);
    }
  });

  const runTests = vscode.commands.registerCommand('prompteng.runTests', async (arg?: vscode.Uri | TestItem) => {
    let testPath: string | undefined;

    if (arg instanceof TestItem) {
      testPath = arg.tooltip;
    } else if (arg && arg.fsPath?.endsWith('.ptest')) {
      testPath = arg.fsPath;
    } else {
      const activeUri = vscode.window.activeTextEditor?.document.uri;
      if (activeUri && activeUri.fsPath.endsWith('.ptest')) {
        testPath = activeUri.fsPath;
      } else {
        const picked = await pickPtestFile();
        testPath = picked?.fsPath;
      }
    }
    if (!testPath) return;

    const channel = vscode.window.createOutputChannel('PromptEng Tests');
    channel.clear();
    channel.show(true);
    channel.appendLine(`Running tests: ${testPath}`);
    try {
      const results = await testRunner.runTests(testPath);
      channel.appendLine(`\nPassed: ${results.passed}, Failed: ${results.failed}`);
      for (const r of results.details) {
        channel.appendLine(`\n${r.testCase} [${r.provider}] -> ${r.success ? 'OK' : 'FAIL'}`);
        if (r.assertions) {
          for (const a of r.assertions) channel.appendLine(`  - ${a.passed ? '✓' : '✗'} ${a.description}`);
        }
        if (r.error) channel.appendLine(`  Error: ${r.error}`);
      }
    } catch (err: any) {
      channel.appendLine(`Error: ${err.message || String(err)}`);
    }
  });

  const generateTypes = vscode.commands.registerCommand('prompteng.generateTypes', async () => {
    try {
      const types = engine.generateTypeDefinitions();
      const typesDir = vscode.Uri.file(path.join(workspaceRoot, 'types'));
      const typesFile = vscode.Uri.file(path.join(workspaceRoot, 'types', 'prompts.d.ts'));
      await fs.promises.mkdir(typesDir.fsPath, { recursive: true });
      await vscode.workspace.fs.writeFile(typesFile, Buffer.from(types));
      vscode.window.showInformationMessage('PromptEng: TypeScript types generated at types/prompts.d.ts');
    } catch (err: any) {
      vscode.window.showErrorMessage(`PromptEng: ${err.message || String(err)}`);
    }
  });

  context.subscriptions.push(runPrompt, runTests, generateTypes);
}

async function getTemplateNameFromFile(filePath: string): Promise<string | undefined> {
  const content = await fs.promises.readFile(filePath, 'utf-8');
  const parts = content.split('---');
  if (parts.length < 3) return undefined;
  const fm = yaml.load(parts[1]) as any;
  return fm?.name;
}

async function promptForVariablesJson(): Promise<Record<string, any>> {
  const input = await vscode.window.showInputBox({ prompt: 'Variables (JSON)', value: '{ }' });
  if (!input) return {};
  try { return JSON.parse(input); } catch { vscode.window.showErrorMessage('Invalid JSON'); return {}; }
}

async function promptForVariablesFromFrontmatter(templatesDir: string, templateName: string): Promise<Record<string, any> | null> {
  try {
    const filePath = await findTemplateByName(templatesDir, templateName);
    if (!filePath) return null;
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const fm = yaml.load(content.split('---')[1]) as any;
    const vars = fm?.variables as Array<any> | undefined;
    if (!vars || vars.length === 0) return null;

    const result: Record<string, any> = {};
    for (const v of vars) {
      const val = await vscode.window.showInputBox({ prompt: `${v.name} (${v.type})${v.required ? ' [required]' : ''}`, value: v.default != null ? String(v.default) : undefined });
      if (val == null && v.required) throw new Error(`Missing required variable: ${v.name}`);
      if (val != null) result[v.name] = coerceType(val, v.type);
    }
    return result;
  } catch {
    return null;
  }
}

function coerceType(value: string, type: string): any {
  switch (type) {
    case 'number': return Number(value);
    case 'boolean': return value.toLowerCase() === 'true';
    case 'array': try { return JSON.parse(value); } catch { return [value]; }
    case 'object': try { return JSON.parse(value); } catch { return { value }; }
    default: return value;
  }
}

async function findTemplateByName(templatesDir: string, name: string): Promise<string | null> {
  const files = await fs.promises.readdir(templatesDir);
  for (const f of files) {
    if (!f.endsWith('.ptemplate')) continue;
    const full = path.join(templatesDir, f);
    const content = await fs.promises.readFile(full, 'utf-8');
    const parts = content.split('---');
    if (parts.length < 3) continue;
    const fm = yaml.load(parts[1]) as any;
    if (fm?.name === name) return full;
  }
  return null;
}

async function pickPtestFile(): Promise<vscode.Uri | undefined> {
  const files = await vscode.workspace.findFiles('**/*.ptest');
  if (files.length === 0) {
    vscode.window.showInformationMessage('No .ptest files found in workspace.');
    return undefined;
  }
  if (files.length === 1) return files[0];
  const items = files.map((f: vscode.Uri) => ({ label: path.basename(f.fsPath), description: f.fsPath }));
  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select a .ptest file' });
  const match = files.find((f: vscode.Uri) => f.fsPath === picked?.description);
  return match;
}

export function deactivate() {}
