import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@atlas/contracts': resolve(__dirname, '../../packages/contracts/src')
    }
  },
  server: {
    port: 5173,
    host: '0.0.0.0'
  }
});
