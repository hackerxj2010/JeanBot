import { ContentGenerator, ProviderConfig } from '../types.js';
import Anthropic from '@anthropic-ai/sdk';

export class ClaudeContentGenerator implements ContentGenerator {
  private client: Anthropic;

  constructor(private config: ProviderConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl
    });
  }

  async generateContent(request: any): Promise<any> {
    const claudeRequest = this.convertRequest(request);
    const response = await this.client.messages.create(claudeRequest);
    return this.convertResponse(response);
  }

  async generateContentStream(request: any): Promise<AsyncGenerator<any>> {
    const claudeRequest = this.convertRequest(request);
    const stream = await this.client.messages.create({
      ...claudeRequest,
      stream: true
    });

    async function* generator() {
      for await (const chunk of (stream as any)) {
        if (chunk.type === 'content_block_delta') {
          yield { text: chunk.delta.text };
        }
      }
    }

    return generator();
  }

  private convertRequest(request: any): any {
    return {
      model: this.config.defaultModel || 'claude-3-5-sonnet-20240620',
      max_tokens: 1024,
      messages: request.messages || []
    };
  }

  private convertResponse(response: any): any {
    const content = response.content[0];
    return {
      text: content.type === 'text' ? content.text : '',
      finishReason: response.stop_reason
    };
  }
}
