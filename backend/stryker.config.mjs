/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'npm',
  testRunner: 'jest',
  jest: {
    projectType: 'custom',
    configFile: 'jest.config.js',
    enableFindRelatedTests: true
  },
  mutate: [
    'src/routes/**/*.js',
    'src/validation/**/*.js'
  ],
  reporters: ['html', 'clear-text', 'progress', 'json'],
  htmlReporter: { fileName: 'reports/mutation/mutation.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  coverageAnalysis: 'perTest',
  thresholds: { high: 80, low: 60, break: null },
  tempDirName: '.stryker-tmp',
  timeoutMS: 15000,
  concurrency: 4
};
