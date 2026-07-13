export function prioritizeInteractiveProposalCall<T>(
  functionCalls: readonly T[],
  isInteractiveProposalCall: (functionCall: T) => boolean,
): T[] {
  const candidates: T[] = []
  const siblings: T[] = []

  for (const functionCall of functionCalls) {
    if (isInteractiveProposalCall(functionCall)) {
      candidates.push(functionCall)
    } else {
      siblings.push(functionCall)
    }
  }

  return [...candidates, ...siblings]
}

export function normalizeAiWriteDestinationEditorId(destination: unknown): string {
  if (!destination || typeof destination !== 'object') {
    return 'editor:active'
  }

  const editorId = (destination as { editorId?: unknown }).editorId
  return typeof editorId === 'string' && editorId.length > 0 ? editorId : 'editor:active'
}

export function isInteractiveAiChangeProposalArgs(
  toolName: unknown,
  args: unknown,
  activeEditorId: string,
  isActiveEditorAlias: (editorId: string) => boolean,
): boolean {
  if (toolName !== 'write_target' || !args || typeof args !== 'object') {
    return false
  }

  const writeArgs = args as { destination?: unknown; dryRun?: unknown }
  const destinationEditorId = normalizeAiWriteDestinationEditorId(writeArgs.destination)
  return writeArgs.dryRun === true
    && (isActiveEditorAlias(destinationEditorId) || destinationEditorId === activeEditorId)
}

module.exports = {
  prioritizeInteractiveProposalCall,
  normalizeAiWriteDestinationEditorId,
  isInteractiveAiChangeProposalArgs,
}
