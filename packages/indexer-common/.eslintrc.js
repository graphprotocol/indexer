module.exports = {
  root: false,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  rules: {
    // Pino emits a per-call field whose key matches a logger binding as a SECOND JSON
    // key; strict parsers keep only the last. Forbid pino reserved keys as per-call fields.
    'no-restricted-syntax': [
      'error',
      {
        selector:
          "CallExpression[callee.property.name=/^(trace|debug|info|warn|error|fatal)$/] > ObjectExpression > Property[key.name=/^(name|level|time|pid|hostname|msg|v)$/]",
        message:
          'Do not pass a pino reserved key (name, level, time, pid, hostname, msg, v) as a per-call log field: it collides with the logger bindings and emits a duplicate JSON key that strict parsers silently drop. Use a distinct key (e.g. subgraphName) or set bindings via logger.child({ ... }).',
      },
    ],
  },
}
