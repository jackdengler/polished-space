import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'sidebar',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'fixture/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
  },
});
