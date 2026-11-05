import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// PGlite ships its own WASM + data files; keep it out of dependency pre-bundling
// so the files are resolved relative to the package (and emitted into the build).
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: {
    environment: 'node',
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
