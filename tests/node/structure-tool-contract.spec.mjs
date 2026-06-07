import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const mainSource = fs.readFileSync(new URL('../../src/electron/main.cts', import.meta.url), 'utf8')

test('replace_structure schema documents maxReplacements as an integer', () => {
  assert.match(mainSource, /maxReplacements: \{ type: 'integer', description: 'Optional positive integer cap\. Defaults to 1\.'/)
})

test('replace_structure result surface exposes overflow indicators', () => {
  assert.match(mainSource, /effectiveMatched: Number\.isFinite\(Number\(mutationResult\.effectiveMatched\)\) \? Number\(mutationResult\.effectiveMatched\) : undefined/)
  assert.match(mainSource, /maxExceeded: mutationResult\?\.maxExceeded === true/)
  assert.match(mainSource, /effectiveMatched: Number\.isFinite\(Number\(result\?\.effectiveMatched\)\) \? Number\(result\.effectiveMatched\) : null/)
  assert.match(mainSource, /maxExceeded: result\?\.maxExceeded === true/)
})

test('structure help explains how to detect capped replace success', () => {
  assert.match(mainSource, /By default, replace_structure replaces one effective match and returns an error as soon as a second effective match would be touched\./)
  assert.match(mainSource, /effectiveMatched means the overlap-normalized match count used for cap decisions\./)
  assert.match(mainSource, /On a successful call, maxExceeded=false means full success and maxExceeded=true means a cap-limited partial success\./)
  assert.match(mainSource, /When onMaxExceeded is break, inspect maxExceeded and effectiveMatched in the result\./)
  assert.match(mainSource, /matched is the raw selector match count before overlap normalization\. effectiveMatched is the normalized count used for maxReplacements and overflow decisions\. changed is the number of replacements actually applied\./)
})
