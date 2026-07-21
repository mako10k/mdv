// @ts-nocheck
function createTrackedFileController(options: {
  fs: typeof import('node:fs')
  writeLog: (level: string, scope: string, ...parts: unknown[]) => void
  ensureEditorRuntimeState: (editorWindow: unknown) => unknown
  setTimeoutImpl?: typeof setTimeout
  clearTimeoutImpl?: typeof clearTimeout
}) {
  const {
    fs,
    writeLog,
    ensureEditorRuntimeState,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
  } = options
  const trackedFileWatchersByWindowId = new Map()
  const retryDelaysMs = [1000, 5000, 30_000, 300_000]

  function clearTrackedFileWatcher(windowId) {
    const watcherRecord = trackedFileWatchersByWindowId.get(windowId)

    if (!watcherRecord) {
      return
    }

    trackedFileWatchersByWindowId.delete(windowId)

    if (watcherRecord.timer) {
      clearTimeoutImpl(watcherRecord.timer)
    }

    if (watcherRecord.retryTimer) {
      clearTimeoutImpl(watcherRecord.retryTimer)
    }

    try {
      watcherRecord.watcher?.close()
    } catch {
      // Ignore watcher close failures during teardown.
    }

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

  function getWatcherErrorSignature(error) {
    const errorCode = error && typeof error === 'object' && typeof error.code === 'string' ? error.code : ''
    const errorMessage = error instanceof Error ? error.message : String(error)
    return `${errorCode}\u0000${errorMessage}`
  }

  function isCurrentTrackedPath(editorWindow, normalizedPath) {
    return !editorWindow.isDestroyed()
      && ensureEditorRuntimeState(editorWindow).trackedFilePath === normalizedPath
  }

  function scheduleTrackedFileRetry(editorWindow, normalizedPath, retryAttempt, reportedErrorSignatures, error, expectedRecord = null) {
    if (
      !isCurrentTrackedPath(editorWindow, normalizedPath)
      || (expectedRecord && trackedFileWatchersByWindowId.get(editorWindow.id) !== expectedRecord)
    ) {
      return false
    }

    const errorSignature = getWatcherErrorSignature(error)
    clearTrackedFileWatcher(editorWindow.id)
    const retryDelayIndex = Math.min(retryAttempt, retryDelaysMs.length - 1)
    const retryDelayMs = retryDelaysMs[retryDelayIndex]
    const hasReportedSignature = reportedErrorSignatures.has(errorSignature)

    if (retryAttempt < retryDelaysMs.length || !hasReportedSignature) {
      writeLog('WARN', 'watch', 'Unable to watch tracked file; retry scheduled', {
        filePath: normalizedPath,
        retryDelayMs,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    reportedErrorSignatures.add(errorSignature)

    const retryRecord = {
      filePath: normalizedPath,
      watcher: null,
      timer: null,
      retryTimer: null,
    }
    retryRecord.retryTimer = setTimeoutImpl(() => {
      if (
        trackedFileWatchersByWindowId.get(editorWindow.id) !== retryRecord
        || !isCurrentTrackedPath(editorWindow, normalizedPath)
      ) {
        return
      }

      trackCurrentFileForWindow(editorWindow, normalizedPath, {
        force: true,
        retryAttempt: retryAttempt + 1,
        reportedErrorSignatures,
      })
    }, retryDelayMs)
    trackedFileWatchersByWindowId.set(editorWindow.id, retryRecord)
    return true
  }

  function trackCurrentFileForWindow(editorWindow, filePath, options = {}) {
    if (!editorWindow || editorWindow.isDestroyed()) {
      return
    }

    const runtimeState = ensureEditorRuntimeState(editorWindow)
    const normalizedPath = typeof filePath === 'string' && filePath.trim().length > 0 ? filePath.trim() : null
    const forceRetrack = options.force === true
    const retryAttempt = Number.isInteger(options.retryAttempt) && options.retryAttempt >= 0
      ? options.retryAttempt
      : 0
    const reportedErrorSignatures = options.reportedErrorSignatures instanceof Set
      ? options.reportedErrorSignatures
      : new Set()

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
      let consecutiveRetryAttempt = retryAttempt
      let consecutiveReportedErrorSignatures = reportedErrorSignatures

      watcherRecord.watcher = fs.watch(normalizedPath, { persistent: false }, () => {
        if (
          trackedFileWatchersByWindowId.get(editorWindow.id) !== watcherRecord
          || !isCurrentTrackedPath(editorWindow, normalizedPath)
        ) {
          return
        }

        consecutiveRetryAttempt = 0
        consecutiveReportedErrorSignatures = new Set()
        if (watcherRecord.timer) {
          clearTimeoutImpl(watcherRecord.timer)
        }

        watcherRecord.timer = setTimeoutImpl(() => {
          if (
            trackedFileWatchersByWindowId.get(editorWindow.id) !== watcherRecord
            || !isCurrentTrackedPath(editorWindow, normalizedPath)
          ) {
            return
          }

          watcherRecord.timer = null
          trackCurrentFileForWindow(editorWindow, normalizedPath, { force: true })
          notifyTrackedFileChanged(editorWindow, normalizedPath)
        }, 120)
      })
      trackedFileWatchersByWindowId.set(editorWindow.id, watcherRecord)
      watcherRecord.watcher.on('error', (error) => {
        if (scheduleTrackedFileRetry(
          editorWindow,
          normalizedPath,
          consecutiveRetryAttempt,
          consecutiveReportedErrorSignatures,
          error,
          watcherRecord,
        )) {
          notifyTrackedFileChanged(editorWindow, normalizedPath)
        }
      })
    } catch (error) {
      scheduleTrackedFileRetry(editorWindow, normalizedPath, retryAttempt, reportedErrorSignatures, error)
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
