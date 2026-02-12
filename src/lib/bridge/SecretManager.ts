import { getOS } from '../common/os/index.ts';
import { logger } from '../logger.ts';

export interface Secrets {
  github: string;
  google: string;
  openai: string;
  anthropic: string;
}

export class SecretManager {
  private secrets: Secrets = {
    github: '',
    google: '',
    openai: '',
    anthropic: '',
  };

  constructor() {
    this.harvest();
  }

  private harvest() {
    const os = getOS();
    this.secrets.github = os.env.get('SBX_GITHUB_TOKEN') || '';
    this.secrets.google = os.env.get('SBX_GOOGLE_API_KEY') || '';
    this.secrets.openai = os.env.get('SBX_OPENAI_API_KEY') || '';
    this.secrets.anthropic = os.env.get('SBX_ANTHROPIC_API_KEY') || '';

    const found = Object.entries(this.secrets)
      .filter(([_, v]) => !!v)
      .map(([k]) => k);

    if (found.length === 0) {
      logger.warn('[SecretManager] No SBX_ secrets found in environment');
    } else {
      logger.info(`[SecretManager] Harvested secrets for: ${found.join(', ')}`);
    }
  }

  getSecrets(): Secrets {
    return { ...this.secrets };
  }

  getGithubToken(): string {
    return this.secrets.github;
  }

  getApiKey(provider: keyof Omit<Secrets, 'github'>): string {
    return this.secrets[provider];
  }

  hasSecret(key: keyof Secrets): boolean {
    return !!this.secrets[key];
  }
}
