import { defineConfig } from 'tsup'

export default defineConfig([
  {
    format: ['esm'],
    clean: true,
    minify: true,
    cjsInterop: true,
    dts: true,
    entry: ['src/index.ts'],
  },
  {
    format: ['cjs'],
    clean: true,
    minify: true,
    cjsInterop: true,
    dts: true,
    entry: ['src/index.cts'],
  },
])
