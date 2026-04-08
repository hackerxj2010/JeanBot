export interface CredentialStorage {
  loadApiKey(service: string): Promise<string | undefined>;
  saveApiKey(service: string, key: string): Promise<void>;
}

export class KeyringCredentialStorage implements CredentialStorage {
  async loadApiKey(service: string): Promise<string | undefined> {
    // In a real CLI, this would use something like 'keytar' or 'node-keyring'
    // For now, we'll use environment variables as a fallback
    const envKey = `JEAN_${service.toUpperCase().replace(/-/g, '_')}_API_KEY`;
    return process.env[envKey];
  }

  async saveApiKey(service: string, key: string): Promise<void> {
    console.info(`Saving API key for ${service}`);
    // Logic to save to system keyring
  }
}

export const credentialStorage = new KeyringCredentialStorage();

export async function loadClaudeApiKey(): Promise<string | undefined> {
  return credentialStorage.loadApiKey('claude');
}

export async function saveClaudeApiKey(key: string): Promise<void> {
  return credentialStorage.saveApiKey('claude', key);
}
