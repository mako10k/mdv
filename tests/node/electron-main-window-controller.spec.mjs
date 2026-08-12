import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const { createWindowController } = require('../../electron/lib/main/window-controller.cjs')

function createBrowserWindowHarness() {
  const allWindows = []
  let nextId = 1
  let focusedWindow = null
  let beforeFileRequestFilter = null
  let beforeFileRequestListener = null
  const sharedSession = {
    webRequest: {
      onBeforeRequest: (filter, listener) => {
        beforeFileRequestFilter = filter
        beforeFileRequestListener = listener
      },
    },
  }

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
      this.currentUrl = 'app://index.html'
      this.windowOpenHandler = null
      this.sent = []
      this.listeners = new Map()
      this.webContents = {
        isLoading: () => false,
        send: (channel, payload) => this.sent.push({ channel, payload }),
        on: (event, handler) => this.onWebContents(event, handler),
        getURL: () => this.currentUrl,
        openDevTools: () => {},
        session: sharedSession,
        setWindowOpenHandler: (handler) => {
          this.windowOpenHandler = handler
        },
      }
      allWindows.push(this)
    }

    on(event, handler) {
      const handlers = this.listeners.get(event) || []
      handlers.push(handler)
      this.listeners.set(event, handlers)
    }

    once(event, handler) {
      const wrappedHandler = (...args) => {
        const handlers = this.listeners.get(event) || []
        this.listeners.set(event, handlers.filter((candidate) => candidate !== wrappedHandler))
        handler(...args)
      }
      this.on(event, wrappedHandler)
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
      this.currentUrl = url
    }

    loadFile(filePath) {
      this.loadFileCalls.push(filePath)
      this.currentUrl = pathToFileURL(filePath).href
    }
  }

  FakeBrowserWindow.getAllWindows = () => allWindows.filter((window) => !window.destroyed)
  FakeBrowserWindow.getFocusedWindow = () => focusedWindow
  FakeBrowserWindow.fromId = (id) => allWindows.find((window) => window.id === id && !window.destroyed) ?? null

  return {
    BrowserWindow: FakeBrowserWindow,
    allWindows,
    getBeforeFileRequestFilter: () => beforeFileRequestFilter,
    invokeBeforeFileRequest: (details) => new Promise((resolve) => {
      if (!beforeFileRequestListener) {
        throw new Error('No before-request listener registered')
      }
      beforeFileRequestListener(details, resolve)
    }),
  }
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

test('Mermaid viewer is reused per editor, receives the latest diagram, and closes with its owner', () => {
  const { BrowserWindow, allWindows } = createBrowserWindowHarness()
  const approvedWindowIds = []
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
    approveWindowClose: (window) => approvedWindowIds.push(window.id),
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
  const firstPayload = { code: 'flowchart TD\nA-->B', theme: 'light' }
  const secondPayload = { code: 'flowchart TD\nB-->C', theme: 'dark' }

  assert.deepEqual(controller.openMermaidViewer(editorWindow, firstPayload), { status: 'opened' })
  const viewerWindow = allWindows[1]
  assert.equal(viewerWindow.loadFileCalls[0], '/tmp/dist/mermaid-viewer.html')
  const navigationEvent = { prevented: false, preventDefault() { this.prevented = true } }
  viewerWindow.emitWebContents('will-navigate', navigationEvent, 'https://example.com')
  assert.equal(navigationEvent.prevented, true)
  assert.deepEqual(viewerWindow.windowOpenHandler({ url: 'https://example.com' }), { action: 'deny' })
  viewerWindow.emitWebContents('did-finish-load')
  assert.deepEqual(viewerWindow.sent, [{ channel: 'mdv:mermaid-viewer-diagram', payload: firstPayload }])

  assert.deepEqual(controller.openMermaidViewer(editorWindow, secondPayload), { status: 'focused' })
  assert.equal(allWindows.length, 2)
  assert.deepEqual(viewerWindow.sent.at(-1), { channel: 'mdv:mermaid-viewer-diagram', payload: secondPayload })
  assert.equal(controller.isEditorWindow(viewerWindow), false)

  controller.closeAuxiliaryWindowsForEditor(editorWindow)
  assert.equal(viewerWindow.isDestroyed(), true)
  assert.deepEqual(approvedWindowIds, [viewerWindow.id])
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

test('editor windows deny navigation outside the expected app entry and ignore drifted load completion', async () => {
  const {
    BrowserWindow,
    getBeforeFileRequestFilter,
    invokeBeforeFileRequest,
  } = createBrowserWindowHarness()
  const logs = []
  let applicationMenu = null
  const controller = createWindowController({
    BrowserWindow,
    Menu: {
      setApplicationMenu: (menu) => { applicationMenu = menu },
      buildFromTemplate: (template) => template,
    },
    isDev: false,
    windowIcon: '/tmp/icon.png',
    preloadPath: '/tmp/preload.cjs',
    rendererDistPath: '/tmp/dist',
    writeLog: (...parts) => logs.push(parts),
    getMainI18n: createMenuMessages,
    focusWindow: (window) => window.focus(),
    approveWindowClose: () => {},
    approvedWindowCloseIds: new Set(),
    pendingWindowCloseIds: new Set(),
    resolveInitialPanelForLaunch: () => 'preview',
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

  const editorWindow = await controller.createWindow({ filePath: '/tmp/source.md', explicitInitialPanel: 'preview' })
  const sent = []
  editorWindow.webContents.send = (channel, payload) => sent.push({ channel, payload })
  const navigationEvent = { prevented: false, preventDefault() { this.prevented = true } }

  editorWindow.emitWebContents('will-navigate', navigationEvent, 'file:///tmp/dist/target.md')
  assert.equal(navigationEvent.prevented, true)
  const queryNavigationEvent = { prevented: false, preventDefault() { this.prevented = true } }
  editorWindow.emitWebContents('will-navigate', queryNavigationEvent, 'file:///tmp/dist/index.html?reload=1')
  assert.equal(queryNavigationEvent.prevented, true)
  const fragmentNavigationEvent = { prevented: false, preventDefault() { this.prevented = true } }
  editorWindow.emitWebContents('will-navigate', fragmentNavigationEvent, 'file:///tmp/dist/index.html#section')
  assert.equal(fragmentNavigationEvent.prevented, false)
  assert.deepEqual(editorWindow.windowOpenHandler({ url: 'https://example.com' }), { action: 'deny' })
  assert.deepEqual(getBeforeFileRequestFilter(), { urls: ['file://*/*'] })
  assert.deepEqual(await invokeBeforeFileRequest({
    url: 'file:///tmp/dist/assets/index.js',
    resourceType: 'script',
    webContentsId: editorWindow.id,
  }), {})
  assert.deepEqual(await invokeBeforeFileRequest({
    url: 'file:///tmp/private-image.png',
    resourceType: 'image',
    webContentsId: editorWindow.id,
  }), { cancel: true })
  assert.deepEqual(await invokeBeforeFileRequest({
    url: 'file:///tmp/dist/../private-image.png',
    resourceType: 'image',
    webContentsId: editorWindow.id,
  }), { cancel: true })
  assert.deepEqual(await invokeBeforeFileRequest({
    url: 'file:///tmp/outside-app-entry.html',
    resourceType: 'mainFrame',
    webContentsId: editorWindow.id,
  }), {})

  editorWindow.currentUrl = 'file:///tmp/dist/target.md'
  editorWindow.emitWebContents('did-finish-load')
  controller.dispatchOpenFileToWindow(editorWindow, { filePath: '/tmp/other.md', explicitInitialPanel: 'preview' })
  controller.createApplicationMenu()
  applicationMenu[0].submenu[2].click()

  assert.deepEqual(sent, [])
  assert.equal(controller.getDefaultEditorWindow(), null)
  assert.ok(logs.some((entry) => entry[1] === 'navigation' && entry[2] === 'Ignored load completion outside expected app entry'))
  assert.ok(logs.some((entry) => entry[1] === 'navigation' && entry[2] === 'Ignored open-file dispatch outside expected app entry'))
  assert.ok(logs.some((entry) => entry[1] === 'menu' && entry[2] === 'No window available for action'))
  assert.ok(logs.some((entry) => entry[1] === 'navigation' && entry[2] === 'Blocked renderer local file subresource outside application assets'))
})
