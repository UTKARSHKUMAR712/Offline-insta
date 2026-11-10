import AsyncStorage from '@react-native-async-storage/async-storage';

const CONFIG_URL = 'https://apiinsta.pages.dev/app-config';
const STORAGE_KEY_API_URL = '@api_url';
const DEFAULT_API_URL = 'https://api-insta-tawny.vercel.app/api/extract';
const REMOTE_CONFIG_TIMEOUT_MS = 5_000;

export class ConfigManager {
  private static currentApiUrl: string = DEFAULT_API_URL;
  private static initPromise: Promise<void> | null = null;

  /** Resolves the API URL to use for the next request. */
  static async getApiUrl(): Promise<string> {
    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }
    await this.initPromise;
    return this.currentApiUrl;
  }

  /**
   * Loads the cached URL before the first request. Remote config is fetched
   * afterwards (fire-and-forget) and applies to subsequent requests, so the
   * first download never waits on an extra network round-trip.
   */
  private static async initialize(): Promise<void> {
    try {
      const savedUrl = await AsyncStorage.getItem(STORAGE_KEY_API_URL);
      if (this.isValidApiUrl(savedUrl)) {
        this.currentApiUrl = savedUrl;
      }
    } catch (e) {
      console.error('Error reading saved API URL', e);
    }

    void this.fetchRemoteConfig();
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
      const response = await fetch(CONFIG_URL, { signal: controller.signal });
      if (!response.ok) return;

      const data = await response.json();
      const newApiUrl = data?.apiUrl;

      if (this.isValidApiUrl(newApiUrl) && newApiUrl.trim() !== this.currentApiUrl) {
        this.currentApiUrl = newApiUrl.trim();
        await AsyncStorage.setItem(STORAGE_KEY_API_URL, this.currentApiUrl);
      }
    } catch (e) {
      console.error('Failed to fetch remote config', e);
      // Ignore failure, keep current saved URL
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
