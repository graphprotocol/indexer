module.exports = {
  root: true,
  parserOptions: {
    tsconfigRootDir: '../..',
    project: true,
  },
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended-type-checked',
    'prettier',
  ],
}
