import { ProviderRegistry } from '../providers/registry.js';
import { ProviderConfig, ContentGenerator } from '../providers/types.js';

export enum AuthType {
  API_KEY = 'API_KEY',
  CLAUDE_API_KEY = 'CLAUDE_API_KEY',
  CUSTOM_PROVIDER = 'CUSTOM_PROVIDER'
}

export interface ContentGeneratorConfig {
  providerId: string;
  config: ProviderConfig;
}

export function createContentGenerator(
  registry: ProviderRegistry,
  config: ContentGeneratorConfig
): ContentGenerator {
  const provider = registry.get(config.providerId);
  if (!provider) {
    throw new Error(`Provider ${config.providerId} not found`);
  }
  return provider.createContentGenerator(config.config);
}
