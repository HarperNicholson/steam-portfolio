import cron from 'node-cron'
import log from 'electron-log'
import { BrowserWindow } from 'electron'
import { getDb } from './db'
import { fetchCurrentPrice, findPriceAtDate, getCachedPriceHistory, fetchPriceHistory, CURRENCY_PARAMS, CurrencyParams } from './steam/market'
import { checkAlerts, sendSystemNotification, FiredAlert } from './portfolio/alerts'

let scheduledTask: cron.ScheduledTask | null = null
let lastRun = 0

export function startScheduler(mainWindow: BrowserWindow): void {
  if (scheduledTask) scheduledTask.stop()

  const db = getDb()
  const intervalHours = parseInt(
    (db.prepare("SELECT value FROM settings WHERE key = 'refresh_interval_hours'").get() as { value: string } | undefined)?.value ?? '6',
    10
  )

  log.info(`Starting price refresh scheduler every ${intervalHours}h`)
  scheduledTask = cron.schedule(`0 */${intervalHours} * * *`, () => {
    runPriceUpdate(mainWindow).catch((err) => log.error('Scheduled price update failed', err))
  })
}

export function stopScheduler(): void {
  scheduledTask?.stop()
  scheduledTask = null
}

export async function runPriceUpdate(mainWindow: BrowserWindow | null): Promise<FiredAlert[]> {
  const now = Date.now()
  if (now - lastRun < 60_000) {
    log.info('Price update throttled — ran less than 1 minute ago')
    return []
  }
  lastRun = now

  const db = getDb()
  const setting = db.prepare("SELECT value FROM settings WHERE key = 'session_cookie'").get() as { value: string } | undefined
  const sessionCookie = setting?.value || undefined

  const currencyKey = (db.prepare("SELECT value FROM settings WHERE key = 'currency'").get() as { value: string } | undefined)?.value ?? 'USD'
  const cp: CurrencyParams = CURRENCY_PARAMS[currencyKey] ?? CURRENCY_PARAMS.USD

  const uniqueItems = db.prepare(
    'SELECT DISTINCT market_hash_name, COALESCE(game_appid, 730) as game_appid FROM portfolio_items'
  ).all() as { market_hash_name: string; game_appid: number }[]

  log.info(`Refreshing prices for ${uniqueItems.length} unique items`)

  const allFired: FiredAlert[] = []

  for (const { market_hash_name: name, game_appid: appId } of uniqueItems) {
    try {
      await refreshItemPrice(name, sessionCookie, cp, appId)

      const snapshot = db
        .prepare('SELECT * FROM price_snapshots WHERE market_hash_name = ?')
        .get(name) as { current_price: number; acquisition_price: number | null; all_time_high: number; smart_peak: number | null } | undefined

      if (snapshot) {
        const fired = checkAlerts(name, snapshot.current_price, snapshot.acquisition_price, snapshot.all_time_high, snapshot.smart_peak)
        for (const alert of fired) {
          allFired.push(alert)
          sendSystemNotification('SteamPortfolio Alert', alert.message)
        }
      }

      await sleep(1200)
    } catch (err) {
      log.warn(`Failed to refresh price for "${name}"`, err)
    }
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('prices:updated', allFired)
  }

  log.info(`Price update done. ${allFired.length} alerts fired.`)
  return allFired
}

async function refreshItemPrice(marketHashName: string, sessionCookie?: string, cp: CurrencyParams = CURRENCY_PARAMS.USD, appId = 730): Promise<void> {
  const db = getDb()
  const now = Math.floor(Date.now() / 1000)

  const current = await fetchCurrentPrice(marketHashName, cp, appId, sessionCookie)
  const price = current.median_price ?? current.lowest_price
  if (price === null) return

  let cached = getCachedPriceHistory(marketHashName)
  if (cached.length === 0) {
    cached = await fetchPriceHistory(marketHashName, sessionCookie, cp, appId)
  }

  const existing = db
    .prepare('SELECT * FROM price_snapshots WHERE market_hash_name = ?')
    .get(marketHashName) as { acquisition_price: number | null; acquisition_date: number | null; all_time_high: number } | undefined

  // Derive true ATH from full price history (covers historical data, not just runtime max)
  const athRow = db.prepare('SELECT MAX(price_usd) as ath FROM price_history WHERE market_hash_name = ?')
    .get(marketHashName) as { ath: number | null } | undefined
  const newAth = Math.max(athRow?.ath ?? 0, existing?.all_time_high ?? 0, price)

  // Compute smart peak — highest price after the initial scarcity window
  const smartRangeDays = parseInt(
    (db.prepare("SELECT value FROM settings WHERE key = 'smart_range_days'").get() as { value: string } | undefined)?.value ?? '0',
    10
  )
  let smartPeak: number | null = null
  if (smartRangeDays > 0 && cached.length > 0) {
    const firstTs = cached[0].timestamp // getCachedPriceHistory orders ASC
    const cutoffTs = firstTs + smartRangeDays * 86400
    const afterRange = cached.filter((p) => p.timestamp >= cutoffTs)
    const peakFromHistory = afterRange.reduce((max, p) => Math.max(max, p.price_usd), 0)
    smartPeak = Math.max(peakFromHistory, price) || null
  }

  // Only update price data — never touch acquisition_date/price here.
  // acquisition_date is set exclusively by the history import to avoid
  // stamping every new item with today's date.
  db.prepare(`
    INSERT INTO price_snapshots(market_hash_name, acquisition_price, acquisition_date, all_time_high, current_price, last_fetched, smart_peak)
    VALUES (?, NULL, NULL, ?, ?, ?, ?)
    ON CONFLICT(market_hash_name) DO UPDATE SET
      all_time_high = MAX(COALESCE(all_time_high, 0), excluded.all_time_high),
      current_price = excluded.current_price,
      last_fetched = excluded.last_fetched,
      smart_peak = excluded.smart_peak
  `).run(marketHashName, newAth, price, now, smartPeak)

  // Backfill acquisition_price for items that now have a date but no price
  if (cached.length > 0 && existing?.acquisition_date && !existing?.acquisition_price) {
    const histPrice = findPriceAtDate(cached, existing.acquisition_date)
    if (histPrice) {
      db.prepare(`UPDATE price_snapshots
        SET acquisition_price = ?
        WHERE market_hash_name = ? AND acquisition_price IS NULL AND acquisition_date IS NOT NULL
          AND NOT COALESCE(acquisition_date_locked, 0)`)
        .run(histPrice, marketHashName)
    }
  }

  db.prepare(
    `INSERT OR REPLACE INTO price_history(market_hash_name, timestamp, price_usd, volume)
     VALUES (?, ?, ?, ?)`
  ).run(marketHashName, now, price, current.volume ?? 0)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
