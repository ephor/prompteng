import { AIProvider } from './base';
import { CompletionOptions, CompletionResult } from '../types';
import OpenAI from 'openai';

export class OpenAIProvider extends AIProvider {
  name = 'openai';
  models = ['gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo'];

  private client: OpenAI;

  constructor(apiKey: string) {
    super();
    if (!apiKey) {
      throw new Error('OpenAI API key is required.');
    }
    this.client = new OpenAI({ apiKey });
  }

  async complete(prompt: string, options: CompletionOptions): Promise<CompletionResult> {
    try {
      const response = await this.client.chat.completions.create({
        model: options.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: options.temperature,
        max_tokens: options.max_tokens,
      });

      const choice = response.choices[0];
      if (!choice) {
        throw new Error('No completion returned from OpenAI');
      }

      return {
        text: choice.message.content || '',
        tokenUsage: {
          prompt: response.usage?.prompt_tokens || 0,
          completion: response.usage?.completion_tokens || 0,
          total: response.usage?.total_tokens || 0,
        },
      };
    } catch (error: any) {
      throw new Error(`OpenAI API error: ${error.message}`);
    }
  }

  estimateTokens(text: string): number {
    // Rough approximation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  getMaxTokens(model: string): number {
    switch (model) {
      case 'gpt-4':
        return 8192;
      case 'gpt-4-turbo':
        return 128000;
      case 'gpt-3.5-turbo':
        return 16385;
      default:
        return 4096;
    }
  }
}
