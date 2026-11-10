// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    rules: {
      // expo-video hands back an imperative player handle. Setting
      // `player.muted` / `player.currentTime` inside effects is the documented
      // API for that native object, not a mutation of React state.
      'react-hooks/immutability': 'off',
    },
  },
]);
