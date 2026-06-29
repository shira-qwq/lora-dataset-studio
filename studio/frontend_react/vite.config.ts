import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Allow launcher to override via .env.local or environment variables.
// VITE_API_PROXY_TARGET sets the backend URL for dev proxy.
const apiTarget = process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8003';

const serverPort = Number(process.env.VITE_PORT) || 5173;

export default defineConfig({
  plugins: [react()],
  server: {
    port: serverPort,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  base: '/react/',
})
