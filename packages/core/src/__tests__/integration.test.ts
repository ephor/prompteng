import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { PromptEngine } from '../engine';
import { TestRunner } from '../testing/runner';
import { AIProvider } from '../providers/base';

class MockOpenAIProvider extends AIProvider {
  name = 'openai';
  models = ['gpt-4'];
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

describe('PromptEng Integration Test', () => {
  it('should run tests and validate assertions', async () => {
    // Go up four levels from /packages/core/src/__tests__ to the project root
    const rootDir = path.resolve(__dirname, '../../../../');
    const templateDir = path.join(rootDir, 'prompts/templates');
    const testFilePath = path.join(rootDir, 'prompts/tests/basic-email.ptest');

    const engine = new PromptEngine(templateDir);
    const providers = [new MockOpenAIProvider()];
    const testRunner = new TestRunner(engine, providers);

    const results = await testRunner.runTests(testFilePath);

    // Basic assertions about the test run itself
    expect(results).toBeDefined();
    expect(results.details.length).toBeGreaterThanOrEqual(1);

    // Detailed assertions about the test result
    const result = results.details[0];
    expect(typeof result.success).toBe('boolean');
    expect(typeof result.testCase).toBe('string');
    expect(typeof result.provider).toBe('string');
    if (result.assertions) {
      expect(result.assertions.length).toBeGreaterThanOrEqual(2);

      const containsAssertion = result.assertions.find(a => a.description.startsWith('contains'));
      expect(containsAssertion).toBeDefined();
      expect(containsAssertion?.passed).toBe(true);

      const notContainsAssertion = result.assertions.find(a => a.description.startsWith('not_contains'));
      expect(notContainsAssertion).toBeDefined();
      expect(notContainsAssertion?.passed).toBe(true);
    } else {
      // Fail the test if assertions are missing
      throw new Error('Assertions array was not defined on the test result');
    }
  });
});

