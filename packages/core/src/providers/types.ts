export type ProviderType = 'claude' | 'gemini' | 'custom';

export interface ModelDefinition {
  id: string;
  displayName: string;
  tier: 'pro' | 'flash' | 'basic';
}

export interface ProviderConfig {
  type: ProviderType;
  name: string;
  apiKey?: string;
  baseUrl?: string;
  models: ModelDefinition[];
  defaultModel?: string;
}

export interface ContentGenerator {
  generateContent(request: any, userPromptId?: string, role?: string): Promise<any>;
  generateContentStream?(request: any, userPromptId?: string, role?: string): Promise<AsyncGenerator<any>>;
}

export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  createContentGenerator(config: ProviderConfig): ContentGenerator;
  getModels(): ModelDefinition[];
  validateConfig(config: ProviderConfig): Promise<boolean>;
}
