import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Port 5174 so this never collides with frontend/'s dev server on 5173.
// No /api proxy: the mockups are fixture-driven and talk to nothing.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5174,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
