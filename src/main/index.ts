import { app, shell, BrowserWindow, Menu } from 'electron'
import path from 'path'
import log from 'electron-log'
import { is } from '@electron-toolkit/utils'
import { getDb } from './db'
import { registerIpcHandlers } from './ipc'
import { startScheduler, runPriceUpdate } from './scheduler'

log.initialize()
log.info('SteamPortfolio starting', app.getVersion())

Menu.setApplicationMenu(null)

// On SteamOS/Linux the Chromium zygote sandbox crashes; disable sandboxing for stable launch
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-setuid-sandbox')
// Software rendering avoids GPU process crashes on Steam Deck AMD GPU
app.disableHardwareAcceleration()

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1b2838',
    icon: path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, '../../resources'), 'icon.png'),
    show: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  log.info('is.dev:', is.dev, '| ELECTRON_RENDERER_URL:', rendererUrl ?? '(not set)')

  mainWindow.on('ready-to-show', () => {
    log.info('ready-to-show fired')
    mainWindow!.show()
    mainWindow!.focus()
  })

  mainWindow.webContents.on('did-finish-load', () => log.info('did-finish-load'))
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) =>
    log.error('did-fail-load', code, desc)
  )

  if (!app.isPackaged) {
    const url = rendererUrl ?? 'http://127.0.0.1:5173/'
    log.info('Loading renderer from', url)
    mainWindow.loadURL(url)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  log.info('loadURL called, webContents id:', mainWindow.webContents.id)
}

app.whenReady().then(async () => {
  getDb()
  createWindow()
  if (mainWindow) {
    registerIpcHandlers(mainWindow)
    startScheduler(mainWindow)

    // Refresh prices on launch if stale
    const staleMs = 6 * 60 * 60 * 1000
    const db = getDb()
    const lastFetched = (
      db.prepare('SELECT MAX(last_fetched) as lf FROM price_snapshots').get() as { lf: number | null }
    ).lf
    if (!lastFetched || Date.now() / 1000 - lastFetched > staleMs / 1000) {
      setTimeout(() => {
        runPriceUpdate(mainWindow).catch((err) => log.error('Initial price update failed', err))
      }, 3000)
    }
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
