import { app, shell, BrowserWindow, Menu, Tray } from 'electron'
import path from 'path'
import log from 'electron-log'
import { is } from '@electron-toolkit/utils'
import { getDb } from './db'
import { registerIpcHandlers } from './ipc'
import { startScheduler, runPriceUpdate } from './scheduler'

log.initialize()
log.info('SteamPortfolio starting', app.getVersion())

Menu.setApplicationMenu(null)

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-setuid-sandbox')
  // Steam Deck AMD GPU crashes Chromium's GPU process; other Linux machines don't need this
  if (process.env['SteamDeck'] === '1') {
    app.disableHardwareAcceleration()
  }
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

function getIconPath(): string {
  return path.join(
    app.isPackaged ? process.resourcesPath : path.join(__dirname, '../../resources'),
    'icon.png'
  )
}

function updateTray(): void {
  const db = getDb()
  const minimizeToTray =
    (db.prepare("SELECT value FROM settings WHERE key = 'minimize_to_tray'").get() as { value: string } | undefined)
      ?.value === '1'

  if (minimizeToTray && !tray) {
    tray = new Tray(getIconPath())
    tray.setToolTip('SteamPortfolio')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show', click: () => { mainWindow?.show(); mainWindow?.focus() } },
        { type: 'separator' },
        { label: 'Quit', click: () => { isQuitting = true; app.quit() } }
      ])
    )
    tray.on('click', () => { mainWindow?.show(); mainWindow?.focus() })
    log.info('Tray created')
  } else if (!minimizeToTray && tray) {
    tray.destroy()
    tray = null
    log.info('Tray destroyed')
  }
}

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

  mainWindow.on('close', (e) => {
    if (!isQuitting && tray) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  if (!app.isPackaged) {
    const url = rendererUrl ?? 'http://127.0.0.1:5173/'
    log.info('Loading renderer from', url)
    mainWindow.loadURL(url)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  log.info('loadURL called, webContents id:', mainWindow.webContents.id)
}

app.on('before-quit', () => { isQuitting = true })

app.on('will-quit', () => {
  if (tray) { tray.destroy(); tray = null }
})

app.whenReady().then(async () => {
  getDb()
  createWindow()
  updateTray()
  if (mainWindow) {
    registerIpcHandlers(mainWindow, updateTray)
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
  // When minimized to tray, the window is hidden (not closed), so this event won't fire.
  // Only quit if tray is not active.
  if (process.platform !== 'darwin' && !tray) app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
