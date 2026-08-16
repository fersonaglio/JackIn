import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // DB integration tests (schema/media-library) share /data/jackin.db via
    // sql.js — run test files sequentially to avoid concurrent file access.
    fileParallelism: false,
  },
});
