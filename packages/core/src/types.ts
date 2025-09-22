export interface PromptTemplate {
  name: string;
  content: string;
  variables: VariableDefinition[];
  metadata: TemplateMetadata;
}

export interface VariableDefinition {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required: boolean;
  description?: string;
  default?: any;
}

export interface TemplateMetadata {
  description: string;
  author: string;
  version: string;
  tags: string[];
  created: Date;
  updated: Date;
}

// Added for testing framework
export interface CompletionOptions {
  model: string;
  temperature?: number;
  max_tokens?: number;
}

export interface CompletionResult {
  text: string;
  tokenUsage: {
    prompt: number;
    completion: number;
    total: number;
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface TestCase {
  name: string;
  template: string;
  variables: Record<string, any>;
  assertions: any[]; // Define more specific assertion types later
  options?: CompletionOptions;
}

export interface TestResult {
  testCase: string;
  provider: string;
  success: boolean;
  responseTime: number;
  tokenUsage?: any;
  assertions?: any[];
  error?: string;
}

export class TestResults {
  constructor(public results: TestResult[]) {}

  get passed(): number {
    return this.results.filter(r => r.success).length;
  }

  get failed(): number {
    return this.results.filter(r => !r.success).length;
  }

  get details(): TestResult[] {
    return this.results;
  }
}
