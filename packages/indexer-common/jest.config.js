const bail = (s) => {
  throw new Error(s)
}

module.exports = {
  collectCoverage: true,
  preset: 'ts-jest',
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
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
  },
}
