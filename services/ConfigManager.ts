import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const REMOTE_CONFIG_URL = 'https://apiinsta.pages.dev/app-config';
const STORAGE_KEY_API_URL = '@api_url';
const DEFAULT_API_URL = 'https://api-insta-tawny.vercel.app/api/extract';
const REMOTE_CONFIG_TIMEOUT_MS = 5_000;
const HEALTH_PROBE_TIMEOUT_MS = 4_000;

/**
 * Resolves which extractor endpoint to use.
 *
 * Order: remote/saved override → EXPO_PUBLIC_API_URL → `extra.apiUrl` in
 * app.json → built-in default. Each candidate is health-probed before use so a dead
 * deployment silently falls through to the next one instead of failing every
 * download. A probe that answers 404 or 5xx counts as unhealthy; a 4xx such as
 * "missing postUrl" proves the endpoint is alive.
 */
export class ConfigManager {
  private static resolvedApiUrl: string | null = null;
  private static initPromise: Promise<void> | null = null;

  /** Resolves the API URL to use for the next request. */
  static async getApiUrl(): Promise<string> {
    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }
    await this.initPromise;
    return this.resolvedApiUrl ?? DEFAULT_API_URL;
  }

  /**
   * Endpoint configured at build time: EXPO_PUBLIC_API_URL wins over the
   * `extra.apiUrl` default baked into app.json.
   */
  private static get configuredApiUrl(): string | null {
    if (this.isValidApiUrl(process.env.EXPO_PUBLIC_API_URL)) {
      return process.env.EXPO_PUBLIC_API_URL.trim();
    }
    const value = (Constants.expoConfig?.extra as { apiUrl?: unknown } | undefined)?.apiUrl;
    return typeof value === 'string' ? value : null;
  }

  private static async initialize(): Promise<void> {
    let savedUrl: string | null = null;
    try {
      savedUrl = await AsyncStorage.getItem(STORAGE_KEY_API_URL);
    } catch (error) {
      console.error('Error reading saved API URL', error);
    }

    const candidates = [savedUrl, this.configuredApiUrl, DEFAULT_API_URL].filter(
      (url): url is string => this.isValidApiUrl(url)
    );

    this.resolvedApiUrl = (await this.firstHealthy(candidates)) ?? candidates[0] ?? DEFAULT_API_URL;

    // Applies to subsequent requests only, so the first download never waits
    // on an extra round-trip.
    void this.fetchRemoteConfig();
  }

  private static async firstHealthy(candidates: string[]): Promise<string | null> {
    for (const candidate of candidates) {
      if (await this.isHealthy(candidate)) return candidate;
    }
    return null;
  }

  private static async isHealthy(url: string): Promise<boolean> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_PROBE_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      return response.status < 500 && response.status !== 404;
    } catch {
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private static isValidApiUrl(value: unknown): value is string {
    if (typeof value !== 'string' || value.trim() === '') return false;
    try {
      const { protocol } = new URL(value.trim());
      return protocol === 'https:';
    } catch {
      return false;
    }
  }

  private static async fetchRemoteConfig(): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REMOTE_CONFIG_TIMEOUT_MS);

    try {
      const response = await fetch(REMOTE_CONFIG_URL, { signal: controller.signal });
      if (!response.ok) return;

      const data = await response.json();
      const newApiUrl = data?.apiUrl;
      if (!this.isValidApiUrl(newApiUrl)) return;

      const trimmed = newApiUrl.trim();
      if (trimmed === this.resolvedApiUrl) return;
      if (!(await this.isHealthy(trimmed))) return;

      this.resolvedApiUrl = trimmed;
      await AsyncStorage.setItem(STORAGE_KEY_API_URL, trimmed);
    } catch (error) {
      console.error('Failed to fetch remote config', error);
      // Keep the already-resolved endpoint.
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
