import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { PromptEngine } from '../engine';
import { AIProvider } from '../providers/base';
import { TestCase, TestResult, TestResults, CompletionOptions } from '../types';

interface TestFile {
  template: string;
  description: string;
  providers?: { name: string; model: string; temperature?: number }[];
  test_cases: TestCase[];
}

interface Assertion {
  [key: string]: any;
}

interface AssertionResult {
  description: string;
  passed: boolean;
}

export class TestRunner {
  constructor(
    private engine: PromptEngine,
    private providers: AIProvider[]
  ) {}

  private loadTestConfig(testFilePath: string): TestFile {
    const fileContent = fs.readFileSync(testFilePath, 'utf-8');
    return yaml.load(fileContent) as TestFile;
  }

  async runTests(testFilePath: string): Promise<TestResults> {
    const testConfig = this.loadTestConfig(testFilePath);
    const results: TestResult[] = [];

    const providersToTest = this.getProvidersToTest(testConfig);

    for (const testCase of testConfig.test_cases) {
      for (const provider of providersToTest) {
        const result = await this.runSingleTest(testConfig.template, testCase, provider.provider, provider.options);
        results.push(result);
      }
    }

    return new TestResults(results);
  }

  private getProvidersToTest(testConfig: TestFile): { provider: AIProvider, options: CompletionOptions }[] {
    if (this.providers.length === 0) {
      throw new Error('No AI providers are configured.');
    }

    if (!testConfig.providers) {
      // If no providers are specified in the test file, use all configured providers with default options.
      return this.providers.map(p => ({ provider: p, options: { model: p.models[0] } }));
    }

    return testConfig.providers.map(pConfig => {
      const baseName = (pConfig.name || '').split('-')[0];
      let provider = this.providers.find(p => p.name === baseName);
      if (!provider) {
        // Fallback to first available provider (e.g., mock) with a warning
        console.warn(`Provider '${pConfig.name}' not configured. Falling back to '${this.providers[0].name}'.`);
        provider = this.providers[0];
      }
      return {
        provider,
        options: { model: pConfig.model || provider.models[0], temperature: pConfig.temperature }
      };
    });
  }

  private async runSingleTest(templateName: string, testCase: TestCase, provider: AIProvider, options: CompletionOptions): Promise<TestResult> {
    const startTime = Date.now();
    try {
      const { text, sections } = await this.engine.renderWithMeta(templateName, testCase.variables);
      const prompt = sections && Object.keys(sections).length > 0
        ? (sections['prompt'] ?? Object.values(sections).join('\n\n'))
        : text;

      const completion = await provider.complete(prompt, { ...options, ...testCase.options });
      const endTime = Date.now();

      const assertionResults = this.validateAssertions(completion.text, testCase.assertions);

      return {
        testCase: testCase.name,
        provider: `${provider.name} (${options.model})`,
        success: assertionResults.every(a => a.passed),
        responseTime: endTime - startTime,
        tokenUsage: completion.tokenUsage,
        assertions: assertionResults,
      };
    } catch (error: any) {
      return {
        testCase: testCase.name,
        provider: `${provider.name} (${options.model})`,
        success: false,
        responseTime: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  private validateAssertions(responseText: string, assertions: Assertion[]): AssertionResult[] {
    const results: AssertionResult[] = [];
    for (const assertion of assertions) {
      const key = Object.keys(assertion)[0];
      const value = assertion[key];

      switch (key) {
        case 'contains':
          results.push({
            description: `contains "${value}"`,
            passed: responseText.includes(value),
          });
          break;
        case 'not_contains':
          results.push({
            description: `not_contains "${value}"`,
            passed: !responseText.includes(value),
          });
          break;
        default:
          results.push({
            description: `unknown assertion "${key}"`,
            passed: false,
          });
      }
    }
    return results;
  }
}
