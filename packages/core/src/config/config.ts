import { ProviderType, ProviderConfig } from '../providers/types.js';

export interface AppConfig {
  provider: ProviderType;
  providerConfigs: Record<string, ProviderConfig>;
  customProviders: ProviderConfig[];
}

let currentConfig: AppConfig = {
  provider: 'claude',
  providerConfigs: {},
  customProviders: []
};

export function getProvider(): ProviderType {
  return currentConfig.provider;
}

export function setProvider(provider: ProviderType): void {
  currentConfig.provider = provider;
}

export function getProviderConfig(providerId: string): ProviderConfig | undefined {
  // Check standard providers first
  if (currentConfig.providerConfigs[providerId]) {
    return currentConfig.providerConfigs[providerId];
  }
  // Then check custom providers
  return currentConfig.customProviders.find(p => p.name === providerId);
}

export function setAppConfig(config: AppConfig): void {
  currentConfig = config;
}

export function addCustomProvider(config: ProviderConfig): void {
  currentConfig.customProviders.push(config);
}

export function getCustomProviders(): ProviderConfig[] {
  return currentConfig.customProviders;
}
