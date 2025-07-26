const bail = s => {
  throw new Error(s)
}

// until we find a way to avoid `punycode` we suppress the warnings in tests
process.env.NODE_NO_WARNINGS = '1'

module.exports = {
  collectCoverage: false,
  preset: 'ts-jest',
  forceExit: true,
  testEnvironment: 'node',
  // The glob patterns Jest uses to detect test files
  testMatch: ['**/?(*.)+(spec|test).ts?(x)'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '.yalc'],
  transformIgnorePatterns: ['node_modules/(?!(strip-ansi|ansi-regex)/)'],
  testTimeout: 60000,
  globals: {
    __DATABASE__: {
      host: process.env.POSTGRES_TEST_HOST || bail('POSTGRES_TEST_HOST is not defined'),
      port: parseInt(process.env.POSTGRES_TEST_PORT || '5432'),
      username:
        process.env.POSTGRES_TEST_USERNAME ||
        bail('POSTGRES_TEST_USERNAME is not defined'),
      password:
        process.env.POSTGRES_TEST_PASSWORD ||
        bail('POSTGRES_TEST_PASSWORD is not defined'),
      database:
        process.env.POSTGRES_TEST_DATABASE ||
        bail('POSTGRES_TEST_DATABASE is not defined'),
    },
    __LOG_LEVEL__: process.env.LOG_LEVEL || 'info',
  },
}
