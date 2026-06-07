// @ts-nocheck
function createTrackedFileController(options: {
  fs: typeof import('node:fs')
  writeLog: (level: string, scope: string, ...parts: unknown[]) => void
  ensureEditorRuntimeState: (editorWindow: unknown) => unknown
}) {
  const { fs, writeLog, ensureEditorRuntimeState } = options
  const trackedFileWatchersByWindowId = new Map()

  function clearTrackedFileWatcher(windowId) {
    const watcherRecord = trackedFileWatchersByWindowId.get(windowId)

    if (!watcherRecord) {
      return
    }

    if (watcherRecord.timer) {
      clearTimeout(watcherRecord.timer)
    }

    if (watcherRecord.retryTimer) {
      clearTimeout(watcherRecord.retryTimer)
    }

    try {
      watcherRecord.watcher?.close()
    } catch {
      // Ignore watcher close failures during teardown.
    }

    trackedFileWatchersByWindowId.delete(windowId)
  }

  function notifyTrackedFileChanged(editorWindow, filePath) {
    if (!editorWindow || editorWindow.isDestroyed() || !filePath) {
      return
    }

    editorWindow.webContents.send('mdv:current-file-changed', {
      path: filePath,
      exists: fs.existsSync(filePath),
    })
  }

  function trackCurrentFileForWindow(editorWindow, filePath, options = {}) {
    if (!editorWindow || editorWindow.isDestroyed()) {
      return
    }

    const runtimeState = ensureEditorRuntimeState(editorWindow)
    const normalizedPath = typeof filePath === 'string' && filePath.trim().length > 0 ? filePath.trim() : null
    const forceRetrack = options.force === true

    if (!forceRetrack && runtimeState.trackedFilePath === normalizedPath) {
      return
    }

    runtimeState.trackedFilePath = normalizedPath
    clearTrackedFileWatcher(editorWindow.id)

    if (!normalizedPath) {
      return
    }

    try {
      const watcherRecord = {
        filePath: normalizedPath,
        watcher: null,
        timer: null,
        retryTimer: null,
      }

      watcherRecord.watcher = fs.watch(normalizedPath, { persistent: false }, () => {
        if (watcherRecord.timer) {
          clearTimeout(watcherRecord.timer)
        }

        watcherRecord.timer = setTimeout(() => {
          watcherRecord.timer = null
          trackCurrentFileForWindow(editorWindow, normalizedPath, { force: true })
          notifyTrackedFileChanged(editorWindow, normalizedPath)
        }, 120)
      })
      watcherRecord.watcher.on('error', (error) => {
        writeLog('WARN', 'watch', 'Tracked file watcher error', normalizedPath, error instanceof Error ? error.message : String(error))
        trackCurrentFileForWindow(editorWindow, normalizedPath, { force: true })
        notifyTrackedFileChanged(editorWindow, normalizedPath)
      })
      trackedFileWatchersByWindowId.set(editorWindow.id, watcherRecord)
    } catch (error) {
      writeLog('WARN', 'watch', 'Unable to watch tracked file', normalizedPath, error instanceof Error ? error.message : String(error))
      const retryRecord = {
        filePath: normalizedPath,
        watcher: null,
        timer: null,
        retryTimer: setTimeout(() => {
          trackCurrentFileForWindow(editorWindow, normalizedPath, { force: true })
        }, 1000),
      }
      trackedFileWatchersByWindowId.set(editorWindow.id, retryRecord)
    }
  }

  return {
    trackCurrentFileForWindow,
    clearTrackedFileWatcher,
  }
}

module.exports = {
  createTrackedFileController,
}
