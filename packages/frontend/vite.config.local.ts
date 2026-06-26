import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config'

// Local dev override — proxies /api to local wrangler dev (port 8787).
// Used by dev.sh only. Does NOT affect production build or vite.config.ts.
export default mergeConfig(base, defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '^/project/.+/llms\\.txt': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/auth/github': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
}))
