module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.(t|j)sx?$': ['@swc/jest', {
      jsc: { parser: { syntax: 'typescript' } },
      module: { type: 'commonjs' },
    }],
  },
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  collectCoverageFrom: [
    'src/modules/route-comparison/exposure.service.ts',
    'src/modules/route-comparison/weather-advisory.service.ts',
  ],
  coverageReporters: ['text', 'html', 'lcov'],
  coverageThreshold: { global: { branches: 70, functions: 80, lines: 80, statements: 80 } },
}
