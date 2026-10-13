import { ipcMain } from 'electron'

/** 本地构建不连接第三方更新源。 */
export function initUpdater(): void {
  const unavailable = () => ({ ok: false, message: '此版本使用本地安装包更新。' })
  for (const channel of ['update:check', 'update:download', 'update:install', 'update:openPage']) {
    ipcMain.handle(channel, unavailable)
  }
}
