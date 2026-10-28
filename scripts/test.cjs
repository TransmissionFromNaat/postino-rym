const { mkdirSync } = require('node:fs');
const { spawnSync } = require('node:child_process');

mkdirSync('artifacts', { recursive: true });
const coverage = process.argv.includes('--coverage') ? [
  '--experimental-test-coverage',
  '--test-coverage-include=postino.*.user.js',
  '--test-coverage-lines=80'
] : [];
const result = spawnSync(process.execPath, [
  '--test', ...coverage,
  '--test-reporter=spec', '--test-reporter-destination=stdout',
  '--test-reporter=junit', '--test-reporter-destination=artifacts/test-results.xml',
  'tests/*.test.cjs'
], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
