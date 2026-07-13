import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createWindowController } = require('../../electron/lib/main/window-controller.cjs')

function createBrowserWindowHarness() {
  const allWindows = []
  let nextId = 1
  let focusedWindow = null

  class FakeBrowserWindow {
    constructor(options = {}) {
      this.id = nextId++
      this.options = options
      this.destroyed = false
      this.visible = options.show !== false
      this.minimized = false
      this.focusCount = 0
      this.loadURLCalls = []
      this.loadFileCalls = []
      this.listeners = new Map()
      this.webContents = {
        isLoading: () => false,
        send: () => {},
        on: (event, handler) => this.onWebContents(event, handler),
        getURL: () => 'app://index.html',
        openDevTools: () => {},
      }
      allWindows.push(this)
    }

    on(event, handler) {
      const handlers = this.listeners.get(event) || []
      handlers.push(handler)
      this.listeners.set(event, handlers)
    }

    emit(event, ...args) {
      for (const handler of this.listeners.get(event) || []) {
        handler(...args)
      }
    }

    onWebContents(event, handler) {
      const key = `web:${event}`
      const handlers = this.listeners.get(key) || []
      handlers.push(handler)
      this.listeners.set(key, handlers)
    }

    emitWebContents(event, ...args) {
      for (const handler of this.listeners.get(`web:${event}`) || []) {
        handler(...args)
      }
    }

    isDestroyed() {
      return this.destroyed
    }

    isVisible() {
      return this.visible
    }

    isMinimized() {
      return this.minimized
    }

    restore() {
      this.minimized = false
    }

    focus() {
      this.focusCount += 1
      focusedWindow = this
    }

    close() {
      this.destroyed = true
      this.emit('closed')
    }

    show() {
      this.visible = true
    }

    loadURL(url) {
      this.loadURLCalls.push(url)
    }

    loadFile(filePath) {
      this.loadFileCalls.push(filePath)
    }
  }

  FakeBrowserWindow.getAllWindows = () => allWindows.filter((window) => !window.destroyed)
  FakeBrowserWindow.getFocusedWindow = () => focusedWindow
  FakeBrowserWindow.fromId = (id) => allWindows.find((window) => window.id === id && !window.destroyed) ?? null

  return { BrowserWindow: FakeBrowserWindow, allWindows }
}

function createMenuMessages() {
  return {
    menu: {
      file: 'File',
      newDocument: 'New Document',
      open: 'Open',
      reloadFile: 'Reload File',
      save: 'Save',
      saveAs: 'Save As',
      settings: 'Settings',
      view: 'View',
      aiChat: 'AI Chat',
      editor: 'Editor',
      renderedPreview: 'Rendered Preview',
      help: 'Help',
      about: 'About MDV',
    },
  }
}

test('openSettingsWindow reuses a single auxiliary window', () => {
  const { BrowserWindow, allWindows } = createBrowserWindowHarness()
  const controller = createWindowController({
    BrowserWindow,
    Menu: { setApplicationMenu: () => {}, buildFromTemplate: (template) => template },
    isDev: false,
    windowIcon: '/tmp/icon.png',
    preloadPath: '/tmp/preload.cjs',
    rendererDistPath: '/tmp/dist',
    writeLog: () => {},
    getMainI18n: () => ({ menu: {} }),
    focusWindow: (window) => window.focus(),
    approveWindowClose: () => {},
    approvedWindowCloseIds: new Set(),
    pendingWindowCloseIds: new Set(),
    resolveInitialPanelForLaunch: () => 'write',
    findEditorWindowByTrackedFilePath: () => null,
    getPendingLaunchRequest: () => null,
    setPendingLaunchRequest: () => {},
    launchStateByWindowId: new Map(),
    hiddenLaunchRevealTimerByWindowId: new Map(),
    emitDebugChannelEvent: () => {},
    confirmEditorWindowClose: async () => {},
    clearEditorRuntimeState: () => {},
    isManagedClient: () => false,
    registerManagedClient: async () => {},
    setManagedMainWindow: () => {},
  })

  const editorWindow = new BrowserWindow()
  const first = controller.openSettingsWindow(editorWindow)
  const second = controller.openSettingsWindow(editorWindow)

  assert.deepEqual(first, { status: 'opened' })
  assert.deepEqual(second, { status: 'focused' })
  assert.equal(allWindows.length, 2)
  assert.equal(controller.getSettingsWindow().loadFileCalls[0], '/tmp/dist/settings.html')
})

test('application menu blocks native and auxiliary actions while a change proposal is active', () => {
  const { BrowserWindow, allWindows } = createBrowserWindowHarness()
  let applicationMenu = null
  let blockEditorAction = true
  const controller = createWindowController({
    BrowserWindow,
    Menu: {
      setApplicationMenu: (menu) => {
        applicationMenu = menu
      },
      buildFromTemplate: (template) => template,
    },
    isDev: false,
    windowIcon: '/tmp/icon.png',
    preloadPath: '/tmp/preload.cjs',
    rendererDistPath: '/tmp/dist',
    writeLog: () => {},
    getMainI18n: createMenuMessages,
    focusWindow: (window) => window.focus(),
    approveWindowClose: () => {},
    approvedWindowCloseIds: new Set(),
    pendingWindowCloseIds: new Set(),
    resolveInitialPanelForLaunch: () => 'write',
    findEditorWindowByTrackedFilePath: () => null,
    getPendingLaunchRequest: () => null,
    setPendingLaunchRequest: () => {},
    launchStateByWindowId: new Map(),
    hiddenLaunchRevealTimerByWindowId: new Map(),
    emitDebugChannelEvent: () => {},
    confirmEditorWindowClose: async () => {},
    clearEditorRuntimeState: () => {},
    isEditorActionBlocked: () => blockEditorAction,
    isManagedClient: () => false,
    registerManagedClient: async () => {},
    setManagedMainWindow: () => {},
  })
  const editorWindow = new BrowserWindow()
  const sent = []
  editorWindow.webContents.send = (channel, payload) => {
    sent.push({ channel, payload })
  }

  controller.createApplicationMenu()

  const fileMenu = applicationMenu.find((item) => item.label === 'File')
  const reloadItem = fileMenu.submenu.find((item) => item.label === 'Reload File')
  const viewMenu = applicationMenu.find((item) => item.label === 'View')
  const helpMenu = applicationMenu.find((item) => item.label === 'Help')
  const aboutItem = helpMenu.submenu.find((item) => item.label === 'About MDV')
  assert.equal(reloadItem.accelerator, 'F5')
  assert.equal(viewMenu.submenu.find((item) => item.role === 'reload').enabled, false)
  assert.equal(viewMenu.submenu.find((item) => item.role === 'forceReload').enabled, false)
  assert.equal(aboutItem.enabled, false)

  reloadItem.click()
  aboutItem.click()
  const blockedFetchResult = controller.openFetchPermissionsWindow(editorWindow)

  assert.deepEqual(sent, [])
  assert.deepEqual(blockedFetchResult, { status: 'focused' })
  assert.equal(allWindows.length, 1)

  blockEditorAction = false
  reloadItem.click()
  const fetchResult = controller.openFetchPermissionsWindow(editorWindow)

  assert.deepEqual(sent, [{ channel: 'mdv:menu-action', payload: 'reload-file' }])
  assert.deepEqual(fetchResult, { status: 'opened' })
  assert.equal(allWindows.length, 2)
})

test('queueOrDispatchOpenFile queues until an editor window is ready', () => {
  const { BrowserWindow } = createBrowserWindowHarness()
  let pendingLaunchRequest = null
  const focusedWindowIds = []
  const clearedProposalWindowIds = []
  const controller = createWindowController({
    BrowserWindow,
    Menu: { setApplicationMenu: () => {}, buildFromTemplate: (template) => template },
    isDev: false,
    windowIcon: '/tmp/icon.png',
    preloadPath: '/tmp/preload.cjs',
    rendererDistPath: '/tmp/dist',
    writeLog: () => {},
    getMainI18n: () => ({ menu: {} }),
    focusWindow: (window) => {
      focusedWindowIds.push(window.id)
      window.focus()
    },
    approveWindowClose: () => {},
    approvedWindowCloseIds: new Set(),
    pendingWindowCloseIds: new Set(),
    resolveInitialPanelForLaunch: () => 'preview',
    findEditorWindowByTrackedFilePath: () => null,
    getPendingLaunchRequest: () => pendingLaunchRequest,
    setPendingLaunchRequest: (value) => {
      pendingLaunchRequest = value
    },
    launchStateByWindowId: new Map(),
    hiddenLaunchRevealTimerByWindowId: new Map(),
    emitDebugChannelEvent: () => {},
    confirmEditorWindowClose: async () => {},
    clearEditorRuntimeState: () => {},
    clearChangeProposalForWindow: (windowId) => clearedProposalWindowIds.push(windowId),
    isManagedClient: () => false,
    registerManagedClient: async () => {},
    setManagedMainWindow: () => {},
  })

  controller.queueOrDispatchOpenFile({ filePath: '/tmp/doc.md' })
  assert.deepEqual(pendingLaunchRequest, { filePath: '/tmp/doc.md' })

  const editorWindow = new BrowserWindow()
  const sent = []
  editorWindow.webContents.send = (channel, payload) => {
    sent.push({ channel, payload })
  }

  controller.attachWindowLogging(editorWindow)
  editorWindow.emitWebContents('did-finish-load')

  assert.equal(pendingLaunchRequest, null)
  assert.deepEqual(sent, [{
    channel: 'mdv:open-file-requested',
    payload: {
      filePath: '/tmp/doc.md',
      initialPanel: 'preview',
      isInitialLaunch: false,
    },
  }])
  assert.deepEqual(focusedWindowIds, [])

  editorWindow.emitWebContents('render-process-gone', {}, { reason: 'crashed' })
  assert.deepEqual(clearedProposalWindowIds, [editorWindow.id])
})
