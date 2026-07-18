/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/packages', '<rootDir>/services'],
  testMatch: ['**/*.spec.ts'],
  moduleNameMapper: {
    '^@atlas/contracts$': '<rootDir>/packages/contracts/src',
    '^@atlas/platform$': '<rootDir>/packages/platform/src'
  },
  collectCoverageFrom: [
    'services/**/src/**/*.ts',
    '!services/**/src/main.ts'
  ]
};
