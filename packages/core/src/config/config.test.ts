import { describe, it, expect, beforeEach } from 'vitest';
import { getProvider, setProvider, addCustomProvider, getProviderConfig, setAppConfig } from './config.js';

describe('AppConfig', () => {
  beforeEach(() => {
    setAppConfig({
      provider: 'claude',
      providerConfigs: {},
      customProviders: []
    });
  });

  it('should get and set provider', () => {
    expect(getProvider()).toBe('claude');
    setProvider('gemini');
    expect(getProvider()).toBe('gemini');
  });

  it('should add and retrieve custom providers', () => {
    const customConfig = {
      type: 'custom' as const,
      name: 'local-ollama',
      baseUrl: 'http://localhost:11434',
      apiKey: 'none',
      models: []
    };
    addCustomProvider(customConfig);
    expect(getProviderConfig('local-ollama')).toBe(customConfig);
  });
});
