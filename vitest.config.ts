import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

const alias = {
  '@renderer': resolve('src/renderer/src'),
  '@shared': resolve('src/shared')
}

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'shared',
          environment: 'node',
          include: ['src/shared/**/*.{test,spec}.ts', 'src/main/**/*.{test,spec}.ts']
        }
      },
      {
        resolve: { alias },
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['src/renderer/**/*.{test,spec}.{ts,tsx}']
        }
      }
    ]
  }
})
