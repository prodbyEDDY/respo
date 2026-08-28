import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import {
  isIpcChannel,
  MAIN_EVENT_CHANNEL,
  SYNC_INPUT_CHANNEL,
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

let inputListenerAttached = false

/**
 * Attach the one-way input stream from the device views.
 *
 * Separate from `registerHandler` because this is `ipcMain.on`, not `handle`:
 * the sender is a *page*, it gets no reply, and nothing it sends may throw back
 * into it. `senderId` is the sender's `webContents.id` — the only identity the
 * engine needs, and one the page cannot forge.
 *
 * `payload` is deliberately `unknown`: it arrives from an untrusted page and
 * has to be validated before anything looks at it (CLAUDE.md §6).
 */
export function registerInputListener(handler: (senderId: number, payload: unknown) => void): void {
  if (inputListenerAttached) throw new Error('Input listener already registered')
  inputListenerAttached = true
  ipcMain.on(SYNC_INPUT_CHANNEL, (event, payload: unknown) => {
    handler(event.sender.id, payload)
  })
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
  inputListenerAttached = false
}
