import { Provider, ProviderType, ProviderConfig, ModelDefinition, ContentGenerator } from '../types.js';
import { OpenAICompatibleContentGenerator } from './openAICompatibleGenerator.js';

export interface CustomProviderConfig extends ProviderConfig {
  type: 'custom';
  baseUrl: string;
  apiKey: string;
  modelName: string;
}

export class CustomProvider implements Provider {
  id: string;
  name: string;
  type: ProviderType = 'custom';

  constructor(config: { id: string, name: string }) {
    this.id = config.id;
    this.name = config.name;
  }

  createContentGenerator(config: ProviderConfig): ContentGenerator {
    return new OpenAICompatibleContentGenerator(config);
  }

  getModels(): ModelDefinition[] {
    // For custom providers, models are often dynamic or user-specified
    return [];
  }

  async validateConfig(config: ProviderConfig): Promise<boolean> {
    return !!config.baseUrl && !!config.apiKey;
  }
}
