module.exports = {
  root: false,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  rules: {
    'semi': [2, 'never'],
    '@typescript-eslint/no-extra-semi': 'off',
  }
}
