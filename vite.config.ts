/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base ("./") + HashRouter = the same build works at https://user.github.io/<repo>/,
// on a custom domain, or when opened from any sub-path. Override with VITE_BASE if you want
// absolute asset URLs (e.g. VITE_BASE=/my-repo/).
export default defineConfig({
  base: process.env.VITE_BASE || './',
  plugins: [react()],
  build: { sourcemap: false, target: 'es2022' },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
