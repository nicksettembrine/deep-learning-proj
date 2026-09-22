import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The browser uses one origin; Vite forwards only annotation API requests to
// FastAPI. The production preview uses the same local backend for the demo.
const proxy = { '/api': 'http://127.0.0.1:8000' }
export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
})
