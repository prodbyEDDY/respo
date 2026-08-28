import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = resolve('src/shared')
const renderer = resolve('src/renderer/src')

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@shared': shared
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@shared': shared
      }
    },
    build: {
      rollupOptions: {
        // Two preloads: `index` is the UI window's typed bridge, `device-view`
        // is the input capture that rides along inside every device page.
        //
        // They must share no *runtime* module. A sandboxed preload gets a
        // `require` that resolves `electron` and little else — a relative path
        // is not loadable — so rollup factoring a common import into
        // `chunks/…js` would produce two preloads that cannot start. Types are
        // free (they are erased); values are not.
        input: {
          index: resolve('src/preload/index.ts'),
          'device-view': resolve('src/preload/device-view.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': renderer,
        '@shared': shared
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
