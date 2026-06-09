import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const mainSource = fs.readFileSync(new URL('../../src/electron/main.cts', import.meta.url), 'utf8')

test('replace_structure schema requires handle and omits selector caps', () => {
  assert.match(mainSource, /name: 'replace_structure',[\s\S]*handle: buildRequiredAiToolParameter\(\{ type: 'string', description: 'Exact structure handle from a previous structure result\.'/)
  assert.doesNotMatch(mainSource, /maxReplacements/)
  assert.doesNotMatch(mainSource, /onMaxExceeded/)
})

test('replace_all_structures schema requires query and expectedMatchCount', () => {
  assert.match(mainSource, /name: 'replace_all_structures',[\s\S]*query: buildRequiredAiToolParameter\(\{ type: 'string', description: aiStructureSelectorDescription \}\),[\s\S]*expectedMatchCount: buildRequiredAiToolParameter\(\{ type: 'integer', description: 'Exact confirmed number of structure matches that must be replaced\.'/)
})

test('replace tool dispatch keeps single-handle and query-batch selector modes separate', () => {
  assert.match(mainSource, /toolName === 'replace_structure'[\s\S]*selectorOptions: \{[\s\S]*requireHandle: true,[\s\S]*disallowQuery: true,[\s\S]*\}/)
  assert.match(mainSource, /toolName === 'replace_all_structures'[\s\S]*selectorOptions: \{[\s\S]*requireQuery: true,[\s\S]*disallowHandle: true,[\s\S]*\}/)
})

test('structure mutation results expose dryRun and expectedMatchCount', () => {
  assert.match(mainSource, /dryRun,\s*matched: Number\.isFinite\(Number\(mutationResult\.matched\)\) \? Number\(mutationResult\.matched\) : undefined,\s*expectedMatchCount: Number\.isFinite\(Number\(mutationPayload\.expectedMatchCount\)\) \? Number\(mutationPayload\.expectedMatchCount\) : undefined/)
  assert.match(mainSource, /expectedMatchCount: Number\.isFinite\(Number\(result\?\.expectedMatchCount\)\) \? Number\(result\.expectedMatchCount\) : null/)
  assert.match(mainSource, /dryRun: result\?\.dryRun === true/)
})

test('structure help explains single-node and multi-node replace split', () => {
  assert.match(mainSource, /replace_structure replaces exactly one structure node and requires one exact handle from a prior structure read\./)
  assert.match(mainSource, /replace_all_structures replaces every node matched by one query only when the actual normalized match count equals expectedMatchCount exactly\./)
  assert.match(mainSource, /replace_all_structures fails when expectedMatchCount does not match the actual normalized query match count\./)
})
