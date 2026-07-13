import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const mainSource = fs.readFileSync(new URL('../../src/electron/main.cts', import.meta.url), 'utf8')
const appSource = fs.readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')

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

test('write_target exposes dryRun preview contract', () => {
  const previewFunctionSource = mainSource.match(/function buildAiWritePreviewPayload[\s\S]*?\n}\n\nfunction waitForWindowDidFinishLoad/)?.[0] || ''
  const writeFunctionSource = mainSource.match(/async function writeAiTargetForWindow[\s\S]*?\n}\n\nasync function listAiBuffersForWindow/)?.[0] || ''

  assert.match(mainSource, /name: 'write_target',[\s\S]*dryRun: \{ type: 'boolean', description: 'Optional\. When true, return bounded markdownPreview, preview-after span, before-coordinate replacedSpan, and wouldWriteBytes without mutating the destination target or returning full source text\. Dry-run checks the same destination write permission gates as a real write before source reads; active-editor dry runs also require active document read permission to build the post-write preview\. Dry-run does not return a reusable target; large or abbreviated previews may be stored as raw session temp buffers referenced by previewTarget for read_target pagination, but read_target still applies public-display redaction and normal bounded source-read limits apply if previewTarget is later used as a slice-ref source\.' \}/)
  assert.match(mainSource, /write_target: \{[\s\S]*\{ name: 'dryRun', required: false, type: 'boolean', description: 'Optional\. Return bounded markdownPreview, preview-after span, before-coordinate replacedSpan, and wouldWriteBytes without mutating the destination target or returning full source text\. Dry-run checks the same destination write permission gates as a real write before source reads; active-editor dry runs also require active document read permission to build the post-write preview\. Dry-run does not return a reusable target; large or abbreviated previews may be stored as raw session temp buffers referenced by previewTarget for read_target pagination, but read_target still applies public-display redaction and normal bounded source-read limits apply if previewTarget is later used as a slice-ref source\.' \}/)
  assert.match(mainSource, /dryRun: args\?\.dryRun === true/)
  assert.match(mainSource, /dryRun: result\?\.dryRun === true/)
  assert.doesNotMatch(mainSource, /function resolveAnySpanToOffsets/)
  const newDocumentPermissionIndex = writeFunctionSource.indexOf("if (!settingsState.ai.toolPermissions.writeNewDocument)")
  const firstMaterializeIndex = writeFunctionSource.indexOf('const content = await materializeWriteSources(editorWindow, payload?.sources)')
  const activeReadPermissionIndex = writeFunctionSource.indexOf("if (dryRun && !settingsState.ai.toolPermissions.readActiveDocument)")
  const activeMaterializeIndex = writeFunctionSource.lastIndexOf('const content = await materializeWriteSources(editorWindow, payload?.sources)')

  assert.notEqual(newDocumentPermissionIndex, -1)
  assert.notEqual(firstMaterializeIndex, -1)
  assert.notEqual(activeReadPermissionIndex, -1)
  assert.notEqual(activeMaterializeIndex, -1)
  assert.ok(newDocumentPermissionIndex < firstMaterializeIndex)
  assert.ok(activeReadPermissionIndex < activeMaterializeIndex)
  assert.match(mainSource, /const markdownPreview = publicPreviewText\.slice\(0, maxPreviewChars\)/)
  assert.doesNotMatch(previewFunctionSource, /\btext: content\b/)
  assert.doesNotMatch(previewFunctionSource, /\btarget = buildAiTargetRef\(editorId, writtenSpan\)/)
  assert.match(previewFunctionSource, /preview: createPreviewText\(publicPreviewText\)/)
  assert.match(previewFunctionSource, /replacedTextPreview: createPreviewText\(abbreviateInlineDataImageMarkdownSlice\(currentText, replacedStartOffset, replacedEndOffset\)\)/)
  assert.match(mainSource, /previewTarget = buildAiTargetRef\(previewBufferRecord\.editorId, \{ kind: 'document' \}\)/)
  assert.match(mainSource, /wouldCreate: options\.wouldCreate === true/)
  assert.match(previewFunctionSource, /bytesWritten: 0,\s*wouldWriteBytes,\s*dryRun: true/)
  assert.match(previewFunctionSource, /wouldWriteBytes: Buffer\.byteLength\(content, 'utf8'\)/)
})

test('interactive active-editor dryRun uses typed atomic proposal capture and terminates the tool turn', () => {
  const proposalBuildSource = mainSource.match(/async function buildInteractiveAiChangeProposal[\s\S]*?\n}\n\nasync function writeAiTargetForWindow/)?.[0] || ''
  const toolLoopSource = mainSource.match(/async function requestOpenAiChatResponse[\s\S]*?\n}\n\nfunction emitAiChatStreamEvent/)?.[0] || ''
  const captureSource = appSource.match(/if \(request\.type === 'capture-change-proposal'\)[\s\S]*?\n\s+if \(request\.type === 'apply-change-proposal'\)/)?.[0] || ''
  const applySource = appSource.match(/if \(request\.type === 'apply-change-proposal'\)[\s\S]*?\n\s+if \(request\.type === 'write'\)/)?.[0] || ''

  assert.match(proposalBuildSource, /type: 'capture-change-proposal'/)
  assert.match(proposalBuildSource, /createPreviewBuffer: proposal === null/)
  assert.match(proposalBuildSource, /changeProposalController\.createProposal\(/)
  assert.doesNotMatch(proposalBuildSource, /changeProposal:[\s\S]*baselineMarkdown/)
  const resultEventIndex = toolLoopSource.indexOf("type: 'tool-event',\n          phase: 'result'")
  const proposalTerminalIndex = toolLoopSource.indexOf("if (result?.changeProposal?.proposalId)")
  const workingInputIndex = toolLoopSource.indexOf('workingInput.push({', proposalTerminalIndex)

  assert.notEqual(resultEventIndex, -1)
  assert.notEqual(proposalTerminalIndex, -1)
  assert.notEqual(workingInputIndex, -1)
  assert.ok(resultEventIndex < proposalTerminalIndex)
  assert.ok(proposalTerminalIndex < workingInputIndex)
  assert.match(toolLoopSource, /sanitizeInteractiveProposalCallArgs\(args\)/)
  assert.match(toolLoopSource, /sanitizeInteractiveProposalResult\(result\)/)
  assert.match(toolLoopSource, /prioritizeInteractiveProposalCall\(functionCalls/)
  assert.match(toolLoopSource, /status: 'proposal-pending'/)
  assert.match(toolLoopSource, /status: 'proposal-pending',[\s\S]*?reply: '',/)
  assert.doesNotMatch(toolLoopSource, /status: 'proposal-pending',[\s\S]*?reply: finalOutputText \|\| doneReply \|\| streamedReply/)
  assert.match(captureSource, /const liveMarkdown = editorRef\.current\?\.getMarkdown\(\) \?\? markdownText/)
  assert.match(captureSource, /instanceId: documentInstanceIdRef\.current/)
  assert.match(captureSource, /currentFilePath: currentFilePathRef\.current/)
  assert.match(applySource, /documentInstanceIdRef\.current === request\.expectedDocumentIdentity\.instanceId/)
  assert.match(applySource, /currentFilePathRef\.current === request\.expectedDocumentIdentity\.currentFilePath/)
  assert.match(applySource, /liveMarkdown !== request\.expectedBaselineMarkdown/)
  assert.ok(applySource.indexOf('liveMarkdown !== request.expectedBaselineMarkdown') < applySource.indexOf('applyMarkdownContent(request.nextMarkdown'))
})

test('read_target public display preserves bounded active-editor reads', () => {
  const readFunctionSource = mainSource.match(/async function readAiTargetForWindow[\s\S]*?\n}\n\nasync function materializeWriteSources/)?.[0] || ''
  const rendererReadSource = appSource.match(/if \(request\.type === 'read'\) \{[\s\S]*?\n\s+if \(request\.type === 'write'\)/)?.[0] || ''

  assert.match(readFunctionSource, /publicDisplay: options\.publicDisplay === true/)
  assert.doesNotMatch(readFunctionSource, /if \(options\.publicDisplay === true\)[\s\S]*readFullTargetTextForWindow/)
  assert.match(rendererReadSource, /request\.publicDisplay === true[\s\S]*abbreviateInlineDataImageMarkdownSlice\(markdownText, resolvedOffsets\.startOffset, finalEndOffset\)/)
  assert.match(appSource, /'data:image\/\*;base64,<continued data image omitted>'/)
})
