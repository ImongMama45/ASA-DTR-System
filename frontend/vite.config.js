import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        host: true,
        configure: (proxy) => {
          proxy.on('error', (err, req, res) => {
            // Django is not running — send a clean 502 so the frontend
            // offline-detector receives a proper status code rather than
            // a dropped connection that might be misinterpreted.
            if (!res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Backend offline' }));
            }
          });
        },
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  }
})
