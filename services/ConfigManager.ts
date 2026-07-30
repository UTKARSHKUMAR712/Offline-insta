import AsyncStorage from '@react-native-async-storage/async-storage';

const CONFIG_URL = 'https://apiinsta.pages.dev/app-config';
const STORAGE_KEY_API_URL = '@api_url';
const DEFAULT_API_URL = 'https://api-insta-tawny.vercel.app/api/extract';

export class ConfigManager {
  private static currentApiUrl: string = DEFAULT_API_URL;
  private static isInitialized = false;

  static async getApiUrl(): Promise<string> {
    if (!this.isInitialized) {
      this.isInitialized = true;
      try {
        const savedUrl = await AsyncStorage.getItem(STORAGE_KEY_API_URL);
        if (savedUrl && typeof savedUrl === 'string' && savedUrl.trim() !== '') {
          this.currentApiUrl = savedUrl;
        }
      } catch (e) {
        console.error('Error reading saved API URL', e);
      }
      
      // Fire and forget remote fetch to update config for the next call
      this.fetchRemoteConfig();
    }
    return this.currentApiUrl;
  }

  private static async fetchRemoteConfig() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(CONFIG_URL, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) return;

      const data = await response.json();
      const newApiUrl = data?.apiUrl;

      if (newApiUrl && typeof newApiUrl === 'string' && newApiUrl.trim() !== '') {
        this.currentApiUrl = newApiUrl;
        await AsyncStorage.setItem(STORAGE_KEY_API_URL, newApiUrl);
      }
    } catch (e) {
      console.error('Failed to fetch remote config', e);
      // Ignore failure, keep current saved URL
    }
  }
}
