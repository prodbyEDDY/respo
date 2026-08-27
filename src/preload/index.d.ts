import type { RespoApi } from '@shared/ipc'

declare global {
  interface Window {
    /** Exposed by src/preload/index.ts. Absent outside Electron. */
    respo: RespoApi
  }
}

export {}
