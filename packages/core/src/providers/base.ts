import { CompletionOptions, CompletionResult } from '../types';

export abstract class AIProvider {
  abstract name: string;
  abstract models: string[];

  abstract complete(prompt: string, options: CompletionOptions): Promise<CompletionResult>;
  abstract estimateTokens(text: string): number;
  abstract getMaxTokens(model: string): number;
}
