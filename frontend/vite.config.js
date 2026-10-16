import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, the browser talks only to :5173; Vite forwards API + WebSocket traffic to the backend.
const target = process.env.BACKEND_URL || 'http://localhost:8080';
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': target, '/ws': { target, ws: true } } },
});
