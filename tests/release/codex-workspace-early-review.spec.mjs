import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import {
  getEarlyContractReviewPlan,
  isVersionOnlyPackageDiff,
  parseValidationOptions,
} from '../../scripts/codex-workspace.mjs'

test('dependency and generated-runtime changes route an early evidence review', () => {
  const plan = getEarlyContractReviewPlan([
    { status: 'M', file: 'package-lock.json' },
    { status: 'M', file: 'vite.config.ts' },
  ])

  assert.equal(plan.required, true)
  assert.deepEqual(plan.areas, ['Dependency and generated-runtime wiring', 'Packaging and release'])
  assert.deepEqual(plan.agents, ['consistency-review', 'packaging-review'])
  assert.ok(plan.checks.some((check) => check.includes('actual runtime or generated bundle')))
  assert.ok(plan.checks.some((check) => check.includes('stale or partial artifacts')))
})

test('Electron boundary changes route an early cross-process contract review', () => {
  const plan = getEarlyContractReviewPlan([{ status: 'M', file: 'electron/preload.cjs' }])

  assert.equal(plan.required, true)
  assert.deepEqual(plan.areas, ['Electron bridge and IPC'])
  assert.deepEqual(plan.agents, ['consistency-review'])
  assert.ok(plan.checks.some((check) => check.includes('main, preload, renderer, and declared types')))
})

test('ordinary renderer changes do not automatically require the early contract checkpoint', () => {
  const plan = getEarlyContractReviewPlan([{ status: 'M', file: 'src/App.css' }])

  assert.deepEqual(plan, {
    required: false,
    areas: [],
    agents: [],
    checks: [],
  })
})

test('version-only package metadata does not trigger the early contract checkpoint', () => {
  const packageDiff = [
    '--- a/package.json',
    '+++ b/package.json',
    '-  "version": "0.2.0",',
    '+  "version": "0.2.1",',
    '--- a/package-lock.json',
    '+++ b/package-lock.json',
    '-  "version": "0.2.0",',
    '+  "version": "0.2.1",',
  ].join('\n')
  const entries = [
    { status: 'M', file: 'package.json' },
    { status: 'M', file: 'package-lock.json' },
  ]

  assert.equal(isVersionOnlyPackageDiff(packageDiff), true)
  assert.equal(getEarlyContractReviewPlan(entries, { packageDiff }).required, false)
})

test('dependency changes in package metadata still trigger the early checkpoint', () => {
  const packageDiff = [
    '--- a/package.json',
    '+++ b/package.json',
    '-    "dompurify": "3.4.11",',
    '+    "dompurify": "3.4.12",',
  ].join('\n')

  assert.equal(isVersionOnlyPackageDiff(packageDiff), false)
  assert.equal(getEarlyContractReviewPlan([{ status: 'M', file: 'package.json' }], { packageDiff }).required, true)
})

test('validate options accept an explicit early-review comparison range', () => {
  assert.deepEqual(parseValidationOptions([
    '--phase', 'early',
    '--base=v0.2.0',
    '--head', 'e7554e8',
  ]), {
    phase: 'early',
    base: 'v0.2.0',
    head: 'e7554e8',
  })
})

test('explicit range validation fails closed when the base ref does not exist', () => {
  const result = spawnSync(process.execPath, [
    'scripts/codex-workspace.mjs',
    'validate',
    '--phase', 'early',
    '--base', 'definitely-not-an-mdv-ref',
    '--head', 'HEAD',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Could not inspect validation target/)
  assert.doesNotMatch(result.stdout, /Not auto-routed for this diff/)
})

test('early phase prints targeted checks before broad regression commands', () => {
  const result = spawnSync(process.execPath, [
    'scripts/codex-workspace.mjs',
    'validate',
    '--phase', 'early',
    '--base', 'v0.2.0',
    '--head', 'e7554e8',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })

  assert.equal(result.status, 0)
  assert.match(result.stdout, /Early targeted commands \(before broad regression\):/)
  assert.doesNotMatch(result.stdout, /^  - npm test$/m)
  assert.doesNotMatch(result.stdout, /^  - npm run test:e2e:electron$/m)
})
