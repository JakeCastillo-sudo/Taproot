import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@taproot/shared$': '<rootDir>/../../packages/shared/src/types/index.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: './tsconfig.test.json',
    }],
  },
  clearMocks: true,
  collectCoverageFrom: [
    'services/**/*.ts',
    '!**/__tests__/**',
  ],
};

export default config;
