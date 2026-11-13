import { defineConfig } from 'vitest/config';

// Every workspace folder is its own vitest project. A package that needs
// something special (e.g. the sidebar wanting jsdom) adds its own
// vitest.config.ts inside its folder; this file never needs editing.
export default defineConfig({
  test: {
    projects: ['packages/*', 'seed'],
    passWithNoTests: true,
  },
});
