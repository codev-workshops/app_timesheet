module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.js'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/server.js', // Exclude server startup file
    '!src/app.js', // Exclude express app wiring
    // DynamoDB backend is exercised by the emulator-backed e2e parity suite
    '!src/database/dynamoAdapter.js',
    '!src/database/dynamoTables.js',
    // Secrets Manager backend is exercised by the emulator-backed e2e parity suite
    '!src/config/secretsClient.js',
    '!src/config/secrets.js',
    '!src/config/secretsResources.js',
    '!**/node_modules/**'
  ],
  coverageReporters: ['text', 'lcov', 'html'],
  testMatch: ['**/__tests__/**/*.test.js'],
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 65,
      lines: 60,
      statements: 60
    }
  },
  verbose: true,
  testTimeout: 10000
};
