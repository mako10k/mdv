import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: new URL('./index.html', import.meta.url).pathname,
        chat: new URL('./chat.html', import.meta.url).pathname,
      },
    },
  },
})
