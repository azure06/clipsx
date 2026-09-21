import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { sentryVitePlugin } from '@sentry/vite-plugin'

// https://vitejs.dev/config/
const sentryPlugin =
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_RELEASE
    ? sentryVitePlugin({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: 'infiniti-next',
        project: 'clipsx-desktop',
        release: { name: process.env.SENTRY_RELEASE },
        sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
        telemetry: false,
      })
    : null

export default defineConfig({
  plugins: [react(), sentryPlugin].filter(Boolean),
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    target: 'esnext',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/'))
            return 'react'
          if (id.includes('/node_modules/@tauri-apps/api/')) return 'tauri'
        },
      },
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
})
