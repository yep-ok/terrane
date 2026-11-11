import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5183, strictPort: true },
  worker: { format: 'es' },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
} as any);
