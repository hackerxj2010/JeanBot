import { Provider, ProviderType, ProviderConfig, ModelDefinition, ContentGenerator } from '../types.js';
import { ClaudeContentGenerator } from './claudeContentGenerator.js';

export class ClaudeProvider implements Provider {
  id = 'claude';
  name = 'Claude (Anthropic)';
  type: ProviderType = 'claude';

  createContentGenerator(config: ProviderConfig): ContentGenerator {
    return new ClaudeContentGenerator(config);
  }

  getModels(): ModelDefinition[] {
    return [
      { id: 'claude-3-opus-20240229', displayName: 'Claude 3 Opus', tier: 'pro' },
      { id: 'claude-3-sonnet-20240229', displayName: 'Claude 3 Sonnet', tier: 'pro' },
      { id: 'claude-3-haiku-20240307', displayName: 'Claude 3 Haiku', tier: 'flash' },
      { id: 'claude-3-5-sonnet-20240620', displayName: 'Claude 3.5 Sonnet', tier: 'pro' },
    ];
  }

  async validateConfig(config: ProviderConfig): Promise<boolean> {
    return !!config.apiKey;
  }
}
