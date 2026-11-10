const preset = require('jest-expo/jest-preset');

/**
 * expo-modules-core is installed under expo/node_modules (npm chose not to
 * hoist it), so Jest needs that directory on its module path — jest-expo's
 * setup resolves it from the project root.
 */
module.exports = {
  ...preset,
  setupFiles: [...(preset.setupFiles ?? []), '<rootDir>/jest.setup.js'],
  testMatch: ['**/__tests__/**/*.test.[jt]s?(x)'],
  modulePaths: ['<rootDir>/node_modules/expo/node_modules'],
};
