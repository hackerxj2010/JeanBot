import { describe, it, expect } from 'vitest';
import { ProviderRegistry } from './registry.js';
import { Provider, ProviderType, ProviderConfig, ModelDefinition, ContentGenerator } from './types.js';

class MockProvider implements Provider {
  constructor(public id: string, public name: string, public type: ProviderType) {}
  createContentGenerator(config: ProviderConfig): ContentGenerator {
    return { generateContent: async () => ({}) };
  }
  getModels(): ModelDefinition[] { return []; }
  async validateConfig(config: ProviderConfig): Promise<boolean> { return true; }
}

describe('ProviderRegistry', () => {
  it('should register and retrieve a provider', () => {
    const registry = new ProviderRegistry();
    const provider = new MockProvider('test', 'Test Provider', 'claude');
    registry.register(provider);
    expect(registry.get('test')).toBe(provider);
  });

  it('should return all providers', () => {
    const registry = new ProviderRegistry();
    registry.register(new MockProvider('p1', 'P1', 'claude'));
    registry.register(new MockProvider('p2', 'P2', 'gemini'));
    expect(registry.getAll().length).toBe(2);
  });

  it('should filter by type', () => {
    const registry = new ProviderRegistry();
    registry.register(new MockProvider('p1', 'P1', 'claude'));
    registry.register(new MockProvider('p2', 'P2', 'gemini'));
    expect(registry.getByType('claude').length).toBe(1);
    expect(registry.getByType('claude')[0].id).toBe('p1');
  });
});
