const fs = require('node:fs')
const path = require('node:path')

const compiledMainPath = path.join(__dirname, 'lib', 'main.cjs')

try {
  require(compiledMainPath)
} catch (error) {
  if (error && typeof error === 'object' && error.code === 'MODULE_NOT_FOUND' && !fs.existsSync(compiledMainPath)) {
    error.message = `Failed to load compiled Electron main process entry at ${compiledMainPath}. Run "npm run electron:build" first.\n${error.message}`
  }

  throw error
}
