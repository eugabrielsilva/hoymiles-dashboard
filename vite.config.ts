import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'

// O servidor da Hoymiles não envia CORS; o proxy repassa as chamadas para neapi.
const proxy = {
  '/api': {
    target: 'https://neapi.hoymiles.com',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api/, ''),
  },
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: { proxy },
  preview: { proxy },
})
