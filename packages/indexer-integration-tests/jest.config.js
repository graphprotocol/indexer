module.exports = {
  collectCoverage: true,
  forceExit: true,
  preset: 'ts-jest',
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '.yalc'],
  roots: ['<rootDir>/src'],
  transform: {
      '^.+\\.ts?$': 'ts-jest',
  },
  setupFilesAfterEnv: ['jest-extended'],
  globals: {
      'ts-jest': { 'tsconfig': 'tsconfig.json'},
  },
  globalSetup: '<rootDir>/src/global-setup.ts',
  globalTeardown: '<rootDir>/src/global-teardown.ts',
}