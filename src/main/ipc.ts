import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import {
  isIpcChannel,
  MAIN_EVENT_CHANNEL,
  type IpcChannel,
  type IpcInvokeMap,
  type MainEvent
} from '@shared/ipc'

export type IpcHandler<K extends IpcChannel> = (
  event: IpcMainInvokeEvent,
  ...args: IpcInvokeMap[K]['args']
) => IpcInvokeMap[K]['result'] | Promise<IpcInvokeMap[K]['result']>

const registered = new Set<IpcChannel>()

/**
 * The only place an `ipcMain` handler may be attached. Channels must exist in
 * `@shared/ipc`, and each may be claimed once.
 */
export function registerHandler<K extends IpcChannel>(channel: K, handler: IpcHandler<K>): void {
  if (!isIpcChannel(channel)) throw new Error(`Unknown IPC channel: ${String(channel)}`)
  if (registered.has(channel)) throw new Error(`IPC channel already registered: ${channel}`)

  registered.add(channel)
  ipcMain.handle(channel, (event, ...args) => handler(event, ...(args as IpcInvokeMap[K]['args'])))
}

/**
 * Push a batched update to a renderer. Callers coalesce their own events —
 * there is no per-event IPC (CLAUDE.md §4).
 */
export function sendMainEvent(target: WebContents, event: MainEvent): void {
  if (target.isDestroyed()) return
  target.send(MAIN_EVENT_CHANNEL, event)
}

/** Test seam: clears the registry so suites can re-register channels. */
export function __resetHandlersForTests(): void {
  registered.clear()
}
