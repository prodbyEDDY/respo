import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  isIpcChannel,
  MAIN_EVENT_CHANNEL,
  type IpcChannel,
  type IpcInvokeMap,
  type MainEvent,
  type RespoApi
} from '@shared/ipc'

/**
 * The whole renderer-facing surface. No generic `ipcRenderer` escape hatch is
 * exposed: every channel is declared in `@shared/ipc` and checked here.
 */
const respo: RespoApi = {
  invoke<K extends IpcChannel>(
    channel: K,
    ...args: IpcInvokeMap[K]['args']
  ): Promise<IpcInvokeMap[K]['result']> {
    if (!isIpcChannel(channel)) {
      return Promise.reject(new Error(`Unknown IPC channel: ${String(channel)}`))
    }
    return ipcRenderer.invoke(channel, ...args) as Promise<IpcInvokeMap[K]['result']>
  },

  onMainEvent(callback: (event: MainEvent) => void): () => void {
    const listener = (_event: IpcRendererEvent, payload: MainEvent): void => callback(payload)
    ipcRenderer.on(MAIN_EVENT_CHANNEL, listener)
    return () => {
      ipcRenderer.off(MAIN_EVENT_CHANNEL, listener)
    }
  }
}

if (!process.contextIsolated) {
  throw new Error('Respo requires contextIsolation: true')
}

contextBridge.exposeInMainWorld('respo', respo)
