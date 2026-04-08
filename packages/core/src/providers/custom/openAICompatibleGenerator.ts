import { ContentGenerator, ProviderConfig } from '../types.js';

export class OpenAICompatibleContentGenerator implements ContentGenerator {
  constructor(private config: ProviderConfig) {}

  async generateContent(request: any): Promise<any> {
    const openAIRequest = this.convertToOpenAIFormat(request);
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(openAIRequest),
    });

    if (!response.ok) {
      throw new Error(`Custom provider request failed: ${response.statusText}`);
    }

    return this.convertFromOpenAIFormat(await response.json());
  }

  private convertToOpenAIFormat(request: any): any {
    return {
      model: this.config.defaultModel,
      messages: request.messages || [],
      stream: false
    };
  }

  private convertFromOpenAIFormat(data: any): any {
    return {
      text: data.choices[0].message.content,
      finishReason: data.choices[0].finish_reason
    };
  }
}
