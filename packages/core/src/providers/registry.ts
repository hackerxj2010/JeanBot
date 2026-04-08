import { Provider, ProviderType } from './types.js';

export class ProviderRegistry {
  private providers: Map<string, Provider> = new Map();

  register(provider: Provider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): Provider | undefined {
    return this.providers.get(id);
  }

  getAll(): Provider[] {
    return Array.from(this.providers.values());
  }

  getByType(type: ProviderType): Provider[] {
    return this.getAll().filter(p => p.type === type);
  }
}
