import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('recharts') || id.includes('victory-vendor') || id.includes('d3-')) return 'vendor-charts'
          if (id.includes('react-router') || id.includes('@remix-run') || id.includes('/react-dom/') || id.includes('/react/') || id.includes('/scheduler/')) return 'vendor-react'
          if (id.includes('@tanstack') || id.includes('zustand') || id.includes('axios')) return 'vendor-data'
          return 'vendor'
        },
      },
    },
  },
  preview: {
    port: 4173,
  },
})
