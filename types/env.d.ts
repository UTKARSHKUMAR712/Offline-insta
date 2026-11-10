/**
 * Metro inlines `process.env.EXPO_PUBLIC_*` at build time. React Native ships no
 * Node typings, so declare just what the app reads.
 */
declare const process: {
  env: {
    EXPO_PUBLIC_API_URL?: string;
    [key: string]: string | undefined;
  };
};
