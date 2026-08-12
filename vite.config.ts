import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { toastUiDompurifyTransform } from './scripts/toast-ui-dompurify-transform'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [toastUiDompurifyTransform(), react()],
  optimizeDeps: {
    // The pre-transform must see Toast UI's published ESM instead of an
    // optimizer cache so its bundled sanitizer can be rebound fail-closed.
    exclude: ['@toast-ui/editor'],
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        about: fileURLToPath(new URL('./about.html', import.meta.url)),
        settings: fileURLToPath(new URL('./settings.html', import.meta.url)),
        fetchPermissions: fileURLToPath(new URL('./fetch-permissions.html', import.meta.url)),
        mermaidViewer: fileURLToPath(new URL('./mermaid-viewer.html', import.meta.url)),
      },
    },
  },
})
