import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { MAIN_I18N, buildMergePreviewText, getMainI18n, getMainLocale } = require('../../electron/lib/main/i18n.cjs')

test('getMainLocale resolves ja and falls back to en', () => {
  assert.equal(getMainLocale({ general: { locale: 'ja' } }), 'ja')
  assert.equal(getMainLocale({ general: { locale: 'en' } }), 'en')
  assert.equal(getMainLocale({ general: { locale: 'fr' } }), 'en')
  assert.equal(getMainLocale(null), 'en')
})

test('getMainI18n returns locale bundle', () => {
  assert.equal(getMainI18n({ general: { locale: 'ja' } }).buttons.cancel, MAIN_I18N.ja.buttons.cancel)
  assert.equal(getMainI18n({ general: { locale: 'en' } }).buttons.cancel, MAIN_I18N.en.buttons.cancel)
})

test('buildMergePreviewText prints four labeled sections', () => {
  const text = buildMergePreviewText('', 'editor', 'merged', '')
  assert.match(text, /=== Merged result ===/)
  assert.match(text, /=== Current file on disk ===/)
  assert.match(text, /editor/)
  assert.match(text, /\(empty\)/)
})
