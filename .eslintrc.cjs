module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    '@typescript-eslint/no-explicit-any': 'warn',
  },
  overrides: [
    {
      // Vercel serverless functions run on Node, not in the browser.
      files: ['api/**/*.ts'],
      env: { node: true, browser: false },
      parserOptions: { sourceType: 'module' },
    },
  ],
};
