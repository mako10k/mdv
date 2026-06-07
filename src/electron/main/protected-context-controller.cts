// @ts-nocheck
const { randomUUID } = require('node:crypto')

function createProtectedContextController({
  ensureEditorRuntimeState,
  estimateTokenCount,
  getProtectedContextBudgetTokens,
  AiToolUserError,
  touchEditorRuntimeState,
}) {
  const DEFAULT_PROTECTED_CONTEXT_MAX_ITEMS = 8
  const DEFAULT_PROTECTED_CONTEXT_MAX_ITEM_TOKENS = 128

  function normalizeProtectedContextPriority(value) {
    if (value === 'high' || value === 'low') {
      return value
    }

    return 'normal'
  }

  function pickHigherProtectedContextPriority(left, right) {
    const priorityOrder = { high: 0, normal: 1, low: 2 }
    const normalizedLeft = normalizeProtectedContextPriority(left)
    const normalizedRight = normalizeProtectedContextPriority(right)
    return (priorityOrder[normalizedLeft] ?? 1) <= (priorityOrder[normalizedRight] ?? 1)
      ? normalizedLeft
      : normalizedRight
  }

  function getProtectedContextRegistry(editorWindow) {
    const runtimeState = ensureEditorRuntimeState(editorWindow)

    if (!(runtimeState.protectedContextItems instanceof Map)) {
      runtimeState.protectedContextItems = new Map()
    }

    return runtimeState.protectedContextItems
  }

  function listProtectedContextItemRecords(editorWindow) {
    const registry = getProtectedContextRegistry(editorWindow)

    return Array.from(registry.values())
      .sort((left, right) => {
        const priorityOrder = { high: 0, normal: 1, low: 2 }
        const priorityDelta = (priorityOrder[left.priority] ?? 1) - (priorityOrder[right.priority] ?? 1)

        if (priorityDelta !== 0) {
          return priorityDelta
        }

        return Date.parse(right.updatedAt || 0) - Date.parse(left.updatedAt || 0)
      })
  }

  function formatProtectedContextItemLine(item) {
    return `- [${item.priority}] ${item.title}: ${item.content}`
  }

  function buildProtectedContextBlockText(items, maxTokens = Number.POSITIVE_INFINITY) {
    const normalizedItems = Array.isArray(items) ? items.filter(Boolean) : []

    if (normalizedItems.length === 0) {
      return ''
    }

    const header = 'Protected context items. Keep these stable unless the user explicitly changes them:\n'
    const lines = []
    let remainingTokens = Number.isFinite(maxTokens)
      ? Math.max(0, maxTokens - estimateTokenCount(header))
      : Number.POSITIVE_INFINITY

    for (const item of normalizedItems) {
      const line = formatProtectedContextItemLine(item)
      const lineTokens = estimateTokenCount(line)

      if (lineTokens > remainingTokens) {
        break
      }

      lines.push(line)
      remainingTokens -= lineTokens
    }

    if (lines.length === 0) {
      return ''
    }

    return `${header}${lines.join('\n')}`
  }

  function getProtectedContextUsage(editorWindow, model) {
    const items = listProtectedContextItemRecords(editorWindow)
    const totalTokens = estimateTokenCount(buildProtectedContextBlockText(items))

    return {
      budgetTokens: getProtectedContextBudgetTokens(model),
      totalTokens,
      itemCount: items.length,
      maxItems: DEFAULT_PROTECTED_CONTEXT_MAX_ITEMS,
      maxItemTokens: DEFAULT_PROTECTED_CONTEXT_MAX_ITEM_TOKENS,
    }
  }

  function summarizeProtectedContextItem(item) {
    return {
      itemId: item.itemId,
      title: item.title,
      content: item.content,
      priority: item.priority,
      estimatedTokens: item.estimatedTokens,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }
  }

  function buildProtectedContextDeleteCandidateHint(editorWindow) {
    const items = listProtectedContextItemRecords(editorWindow)
    const candidates = items
      .slice()
      .reverse()
      .slice(0, 3)
      .map((item) => `${item.itemId} (${item.title})`)

    if (candidates.length === 0) {
      return 'Delete or shorten existing protected items before saving another one.'
    }

    return `Delete or shorten existing protected items before saving another one. Candidates: ${candidates.join(', ')}`
  }

  function saveProtectedContextItemForWindow(editorWindow, payload) {
    const title = typeof payload?.title === 'string' ? payload.title.trim() : ''
    const content = typeof payload?.content === 'string' ? payload.content.trim() : ''

    if (title.length === 0) {
      throw new AiToolUserError('save_context_item', 'title must be a non-empty string.', 'Provide title as a short label such as "Current release constraint".')
    }

    if (content.length === 0) {
      throw new AiToolUserError('save_context_item', 'content must be a non-empty string.', 'Provide content as a short fact, constraint, or TODO to preserve.')
    }

    const priority = normalizeProtectedContextPriority(payload?.priority)
    const estimatedTokens = estimateTokenCount(formatProtectedContextItemLine({ title, content, priority }))

    if (estimatedTokens > DEFAULT_PROTECTED_CONTEXT_MAX_ITEM_TOKENS) {
      throw new AiToolUserError(
        'save_context_item',
        `content is too large for protected context (${estimatedTokens} tokens).`,
        `Shorten the content to about ${DEFAULT_PROTECTED_CONTEXT_MAX_ITEM_TOKENS} tokens or less.`,
      )
    }

    const usage = getProtectedContextUsage(editorWindow)

    if (usage.itemCount >= usage.maxItems) {
      throw new AiToolUserError(
        'save_context_item',
        'protected context is full by item count.',
        buildProtectedContextDeleteCandidateHint(editorWindow),
      )
    }

    const nextTotalTokens = estimateTokenCount(buildProtectedContextBlockText([
      ...listProtectedContextItemRecords(editorWindow),
      { title, content, priority },
    ]))

    if (nextTotalTokens > usage.budgetTokens) {
      throw new AiToolUserError(
        'save_context_item',
        'protected context budget would overflow.',
        `${buildProtectedContextDeleteCandidateHint(editorWindow)} Or save a shorter fact.`,
      )
    }

    const timestamp = new Date().toISOString()
    const item = {
      itemId: `context:${randomUUID()}`,
      title,
      content,
      priority,
      estimatedTokens,
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    const registry = getProtectedContextRegistry(editorWindow)
    registry.set(item.itemId, item)
    touchEditorRuntimeState(editorWindow)

    return {
      item: summarizeProtectedContextItem(item),
      usage: getProtectedContextUsage(editorWindow),
    }
  }

  function updateProtectedContextItemForWindow(editorWindow, payload) {
    const itemId = typeof payload?.itemId === 'string' ? payload.itemId.trim() : ''

    if (itemId.length === 0) {
      throw new AiToolUserError('update_context_item', 'itemId must be a non-empty string.', 'Call list_context_items first and reuse one returned itemId.')
    }

    const registry = getProtectedContextRegistry(editorWindow)
    const existingItem = registry.get(itemId)

    if (!existingItem) {
      throw new AiToolUserError('update_context_item', `Unknown protected context item: ${itemId}`, 'Call list_context_items first and reuse one returned itemId.')
    }

    const hasTitle = Object.prototype.hasOwnProperty.call(payload || {}, 'title')
    const hasContent = Object.prototype.hasOwnProperty.call(payload || {}, 'content')
    const hasPriority = Object.prototype.hasOwnProperty.call(payload || {}, 'priority')

    if (!hasTitle && !hasContent && !hasPriority) {
      throw new AiToolUserError('update_context_item', 'At least one field must be provided to update.', 'Provide one or more of title, content, or priority.')
    }

    const nextTitle = hasTitle ? String(payload.title || '').trim() : existingItem.title
    const nextContent = hasContent ? String(payload.content || '').trim() : existingItem.content

    if (nextTitle.length === 0) {
      throw new AiToolUserError('update_context_item', 'title must be a non-empty string.', 'Provide title as a short label or omit it to keep the current value.')
    }

    if (nextContent.length === 0) {
      throw new AiToolUserError('update_context_item', 'content must be a non-empty string.', 'Provide content as a short fact, constraint, or TODO, or omit it to keep the current value.')
    }

    const nextPriority = hasPriority ? normalizeProtectedContextPriority(payload.priority) : existingItem.priority
    const estimatedTokens = estimateTokenCount(formatProtectedContextItemLine({ title: nextTitle, content: nextContent, priority: nextPriority }))

    if (estimatedTokens > DEFAULT_PROTECTED_CONTEXT_MAX_ITEM_TOKENS) {
      throw new AiToolUserError(
        'update_context_item',
        `content is too large for protected context (${estimatedTokens} tokens).`,
        `Shorten the content to about ${DEFAULT_PROTECTED_CONTEXT_MAX_ITEM_TOKENS} tokens or less.`,
      )
    }

    const usage = getProtectedContextUsage(editorWindow)
    const nextItems = listProtectedContextItemRecords(editorWindow).map((item) => (
      item.itemId === itemId
        ? {
            ...item,
            title: nextTitle,
            content: nextContent,
            priority: nextPriority,
          }
        : item
    ))
    const nextTotalTokens = estimateTokenCount(buildProtectedContextBlockText(nextItems))

    if (nextTotalTokens > usage.budgetTokens) {
      throw new AiToolUserError(
        'update_context_item',
        'protected context budget would overflow after this update.',
        `${buildProtectedContextDeleteCandidateHint(editorWindow)} Or shorten the updated item.`,
      )
    }

    const updatedItem = {
      ...existingItem,
      title: nextTitle,
      content: nextContent,
      priority: nextPriority,
      estimatedTokens,
      updatedAt: new Date().toISOString(),
    }

    registry.set(itemId, updatedItem)
    touchEditorRuntimeState(editorWindow)

    return {
      item: summarizeProtectedContextItem(updatedItem),
      usage: getProtectedContextUsage(editorWindow),
    }
  }

  function mergeProtectedContextItemsForWindow(editorWindow, payload) {
    const itemIds = Array.from(new Set((Array.isArray(payload?.itemIds) ? payload.itemIds : [])
      .filter((itemId) => typeof itemId === 'string')
      .map((itemId) => itemId.trim())
      .filter((itemId) => itemId.length > 0)))

    if (itemIds.length < 2) {
      throw new AiToolUserError('merge_context_items', 'itemIds must contain at least two protected context item ids.', 'Call list_context_items first and provide two or more returned itemIds.')
    }

    const title = typeof payload?.title === 'string' ? payload.title.trim() : ''
    const content = typeof payload?.content === 'string' ? payload.content.trim() : ''

    if (title.length === 0) {
      throw new AiToolUserError('merge_context_items', 'title must be a non-empty string.', 'Provide a short label for the merged protected context item.')
    }

    if (content.length === 0) {
      throw new AiToolUserError('merge_context_items', 'content must be a non-empty string.', 'Provide merged content as one short fact, constraint, or TODO.')
    }

    const registry = getProtectedContextRegistry(editorWindow)
    const sourceItems = itemIds.map((itemId) => registry.get(itemId) || null)

    if (sourceItems.some((item) => !item)) {
      const missingItemId = itemIds.find((itemId) => !registry.get(itemId))
      throw new AiToolUserError('merge_context_items', `Unknown protected context item: ${missingItemId}`, 'Call list_context_items first and reuse only returned itemIds.')
    }

    const priority = Object.prototype.hasOwnProperty.call(payload || {}, 'priority')
      ? normalizeProtectedContextPriority(payload.priority)
      : sourceItems.reduce((currentPriority, item) => pickHigherProtectedContextPriority(currentPriority, item?.priority), 'low')
    const estimatedTokens = estimateTokenCount(formatProtectedContextItemLine({ title, content, priority }))

    if (estimatedTokens > DEFAULT_PROTECTED_CONTEXT_MAX_ITEM_TOKENS) {
      throw new AiToolUserError(
        'merge_context_items',
        `merged content is too large for protected context (${estimatedTokens} tokens).`,
        `Shorten the merged content to about ${DEFAULT_PROTECTED_CONTEXT_MAX_ITEM_TOKENS} tokens or less.`,
      )
    }

    const usage = getProtectedContextUsage(editorWindow)
    const nextItems = [
      ...listProtectedContextItemRecords(editorWindow).filter((item) => !itemIds.includes(item.itemId)),
      { title, content, priority },
    ]
    const nextTotalTokens = estimateTokenCount(buildProtectedContextBlockText(nextItems))

    if (nextTotalTokens > usage.budgetTokens) {
      throw new AiToolUserError(
        'merge_context_items',
        'protected context budget would overflow after this merge.',
        'Shorten the merged item before retrying.',
      )
    }

    const timestamp = new Date().toISOString()
    const mergedItem = {
      itemId: `context:${randomUUID()}`,
      title,
      content,
      priority,
      estimatedTokens,
      createdAt: timestamp,
      updatedAt: timestamp,
      mergedFromItemIds: itemIds,
    }

    itemIds.forEach((itemId) => {
      registry.delete(itemId)
    })
    registry.set(mergedItem.itemId, mergedItem)
    touchEditorRuntimeState(editorWindow)

    return {
      item: summarizeProtectedContextItem(mergedItem),
      mergedFromItemIds: itemIds,
      usage: getProtectedContextUsage(editorWindow),
    }
  }

  function listProtectedContextItemsForWindow(editorWindow) {
    return {
      items: listProtectedContextItemRecords(editorWindow).map(summarizeProtectedContextItem),
      usage: getProtectedContextUsage(editorWindow),
    }
  }

  function deleteProtectedContextItemForWindow(editorWindow, payload) {
    const itemId = typeof payload?.itemId === 'string' ? payload.itemId.trim() : ''

    if (itemId.length === 0) {
      throw new AiToolUserError('delete_context_item', 'itemId must be a non-empty string.', 'Call list_context_items first and reuse one returned itemId.')
    }

    const registry = getProtectedContextRegistry(editorWindow)
    const deleted = registry.delete(itemId)
    touchEditorRuntimeState(editorWindow)

    return {
      itemId,
      deleted,
      usage: getProtectedContextUsage(editorWindow),
    }
  }

  function buildProtectedContextInput(editorWindow, maxTokens) {
    const content = buildProtectedContextBlockText(listProtectedContextItemRecords(editorWindow), maxTokens)

    if (content.length === 0) {
      return null
    }

    return {
      role: 'user',
      content,
    }
  }

  return {
    buildProtectedContextInput,
    getProtectedContextUsage,
    saveProtectedContextItemForWindow,
    updateProtectedContextItemForWindow,
    mergeProtectedContextItemsForWindow,
    listProtectedContextItemsForWindow,
    deleteProtectedContextItemForWindow,
  }
}

module.exports = {
  createProtectedContextController,
}
