import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const API_TARGET = process.env.VITE_API_PROXY ?? 'http://127.0.0.1:8710'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5710,
    strictPort: true,
    proxy: { '/api': { target: API_TARGET, changeOrigin: true } },
  },
  preview: { port: 5711, proxy: { '/api': { target: API_TARGET, changeOrigin: true } } },
  build: { chunkSizeWarningLimit: 1500 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
} as never)
