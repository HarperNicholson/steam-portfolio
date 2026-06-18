import { ipcMain, BrowserWindow, shell, app } from 'electron'
import log from 'electron-log'
import { getDb, transaction } from './db'
import { fetchSteamInventory, resolveSteamId, fetchSteamProfile, detectCurrencyFromLocation } from './steam/inventory'
import { fetchPriceHistory, getCachedPriceHistory, fetchCurrentPrice, fetchMarketHistory, applyMarketHistory, applyInventoryHistory, CURRENCY_PARAMS } from './steam/market'
import { fetchInventoryHistory } from './steam/inventory_history'
import { upsertAlertConfig, getAlertConfig, getRecentAlerts, sendSystemNotification } from './portfolio/alerts'
import { runPriceUpdate } from './scheduler'

export function registerIpcHandlers(mainWindow: BrowserWindow, updateTray: () => void): void {
  // ── Accounts ─────────────────────────────────────────────────────────────
  ipcMain.handle('accounts:add', async (_e, input: string) => {
    const steamId = await resolveSteamId(input)
    const db = getDb()
    const existing = db.prepare('SELECT id FROM accounts WHERE steam_id = ?').get(steamId)
    if (existing) throw new Error('Account already added')

    const profile = await fetchSteamProfile(steamId)
    db.prepare(`
      INSERT INTO accounts(steam_id, display_name, avatar_url)
      VALUES (?, ?, ?)
    `).run(steamId, profile?.display_name ?? null, profile?.avatar_url ?? null)

    // Auto-detect currency from profile location when first account is added and currency is still default
    const currentCurrency = (db.prepare("SELECT value FROM settings WHERE key = 'currency'").get() as { value: string } | undefined)?.value
    if (currentCurrency === 'USD' && profile?.location) {
      const detected = detectCurrencyFromLocation(profile.location)
      if (detected) {
        db.prepare("INSERT INTO settings(key,value) VALUES('currency',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(detected)
        log.info(`Auto-detected currency ${detected} from location: ${profile.location}`)
      }
    }

    const account = db.prepare('SELECT * FROM accounts WHERE steam_id = ?').get(steamId)
    return account
  })

  ipcMain.handle('accounts:list', () => {
    return getDb().prepare('SELECT * FROM accounts ORDER BY added_at DESC').all()
  })

  ipcMain.handle('accounts:remove', (_e, accountId: number) => {
    getDb().prepare('DELETE FROM accounts WHERE id = ?').run(accountId)
    return { ok: true }
  })

  // ── Inventory ─────────────────────────────────────────────────────────────
  ipcMain.handle('inventory:sync', async (_e, accountId: number, appId: number = 730) => {
    const db = getDb()
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as { steam_id: string } | undefined
    if (!account) throw new Error('Account not found')

    const setting = db.prepare("SELECT value FROM settings WHERE key = 'session_cookie'").get() as { value: string } | undefined
    const sessionCookie = setting?.value || undefined

    const items = await fetchSteamInventory(account.steam_id, sessionCookie, appId)

    const insert = db.prepare(`
      INSERT INTO portfolio_items
        (account_id, asset_id, class_id, instance_id, market_hash_name, name, type, rarity, rarity_color, exterior, icon_url, tradable, marketable, stickers, game_appid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, asset_id) DO UPDATE SET
        tradable = excluded.tradable,
        marketable = excluded.marketable,
        stickers = excluded.stickers,
        game_appid = excluded.game_appid
    `)
    transaction(db, () => {
      for (const item of items) {
        insert.run(
          accountId, item.asset_id, item.class_id, item.instance_id,
          item.market_hash_name, item.name, item.type ?? null, item.rarity ?? null,
          item.rarity_color ?? null, item.exterior ?? null, item.icon_url, item.tradable,
          item.marketable,
          item.stickers.length > 0 ? JSON.stringify(item.stickers) : '',
          appId
        )
      }
    })

    log.info(`Synced ${items.length} items for account ${accountId} (appId=${appId})`)
    return { synced: items.length }
  })

  ipcMain.handle('inventory:list', (_e, accountId: number) => {
    const db = getDb()
    const rows = db.prepare(`
      SELECT market_hash_name, name, type, rarity, rarity_color, exterior, icon_url,
             quantity, tradable, marketable, hidden, stickers, game_appid, asset_id,
             current_price, acquisition_price, acquisition_date, all_time_high, last_fetched
      FROM (
        -- Non-stickered items grouped by market_hash_name + game
        SELECT
          pi.market_hash_name, pi.name, pi.type, pi.rarity, pi.rarity_color, pi.exterior, pi.icon_url,
          COUNT(*) as quantity, MIN(pi.tradable) as tradable,
          MIN(pi.marketable) as marketable, MAX(pi.hidden) as hidden, '' as stickers,
          pi.game_appid, NULL as asset_id,
          ps.current_price, ps.acquisition_price, ps.acquisition_date, ps.all_time_high, ps.last_fetched
        FROM portfolio_items pi
        LEFT JOIN price_snapshots ps ON ps.market_hash_name = pi.market_hash_name
        WHERE pi.account_id = ? AND (pi.stickers = '' OR pi.stickers IS NULL)
        GROUP BY pi.market_hash_name, pi.game_appid
        UNION ALL
        -- Stickered weapons as individual items
        SELECT
          pi.market_hash_name, pi.name, pi.type, pi.rarity, pi.rarity_color, pi.exterior, pi.icon_url,
          1 as quantity, pi.tradable, pi.marketable, pi.hidden, pi.stickers,
          pi.game_appid, pi.asset_id,
          ps.current_price, ps.acquisition_price, ps.acquisition_date, ps.all_time_high, ps.last_fetched
        FROM portfolio_items pi
        LEFT JOIN price_snapshots ps ON ps.market_hash_name = pi.market_hash_name
        WHERE pi.account_id = ? AND pi.stickers != '' AND pi.stickers IS NOT NULL
      )
      ORDER BY COALESCE(current_price, 0) * quantity DESC
    `).all(accountId, accountId)
    return rows
  })

  ipcMain.handle('inventory:hide', (_e, accountId: number, marketHashName: string) => {
    getDb().prepare('UPDATE portfolio_items SET hidden = 1 WHERE account_id = ? AND market_hash_name = ?').run(accountId, marketHashName)
    return { ok: true }
  })

  ipcMain.handle('inventory:unhide', (_e, accountId: number, marketHashName: string) => {
    getDb().prepare('UPDATE portfolio_items SET hidden = 0 WHERE account_id = ? AND market_hash_name = ?').run(accountId, marketHashName)
    return { ok: true }
  })

  // ── Prices ────────────────────────────────────────────────────────────────
  ipcMain.handle('prices:history', async (_e, marketHashName: string) => {
    const db = getDb()
    let cached = getCachedPriceHistory(marketHashName)
    if (cached.length === 0) {
      const cookieSetting = db.prepare("SELECT value FROM settings WHERE key = 'session_cookie'").get() as { value: string } | undefined
      const currencyKey = (db.prepare("SELECT value FROM settings WHERE key = 'currency'").get() as { value: string } | undefined)?.value ?? 'USD'
      const cp = CURRENCY_PARAMS[currencyKey] ?? CURRENCY_PARAMS.USD
      cached = await fetchPriceHistory(marketHashName, cookieSetting?.value || undefined, cp)
    }
    return cached
  })

  ipcMain.handle('prices:current', async (_e, marketHashName: string) => {
    const db = getDb()
    const currencyKey = (db.prepare("SELECT value FROM settings WHERE key = 'currency'").get() as { value: string } | undefined)?.value ?? 'USD'
    const cp = CURRENCY_PARAMS[currencyKey] ?? CURRENCY_PARAMS.USD
    const cookieSetting = db.prepare("SELECT value FROM settings WHERE key = 'session_cookie'").get() as { value: string } | undefined
    return fetchCurrentPrice(marketHashName, cp, 730, cookieSetting?.value || undefined)
  })

  ipcMain.handle('prices:refresh-all', async () => {
    const fired = await runPriceUpdate(mainWindow)
    return { alerts_fired: fired.length, alerts: fired }
  })

  ipcMain.handle('prices:snapshot', (_e, marketHashName: string) => {
    return getDb()
      .prepare('SELECT * FROM price_snapshots WHERE market_hash_name = ?')
      .get(marketHashName)
  })

  ipcMain.handle('prices:set-acquisition', (_e, marketHashName: string, acquisitionDate: number | null, acquisitionPrice: number | null) => {
    getDb().prepare(`
      INSERT INTO price_snapshots(market_hash_name, acquisition_date, acquisition_price, acquisition_date_locked)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(market_hash_name) DO UPDATE SET
        acquisition_date       = excluded.acquisition_date,
        acquisition_price      = excluded.acquisition_price,
        acquisition_date_locked = 1
    `).run(marketHashName, acquisitionDate, acquisitionPrice)
    return { ok: true }
  })

  ipcMain.handle('prices:reset-acquisition', (_e, marketHashName: string) => {
    getDb().prepare(`
      UPDATE price_snapshots SET
        acquisition_date        = NULL,
        acquisition_price       = NULL,
        acquisition_date_locked = 0
      WHERE market_hash_name = ?
    `).run(marketHashName)
    return { ok: true }
  })

  ipcMain.handle('market:import-history', async () => {
    const db = getDb()
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'session_cookie'").get() as { value: string } | undefined
    if (!setting?.value) throw new Error('No session cookie set — go to Settings and paste your steamLoginSecure cookie.')
    const sessionCookie = setting.value

    function send(page: number, total: number, phase: string): void {
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send('market:import-progress', { page, total, phase })
    }

    // ── Phase 1: Inventory history (trades, drops, unboxings, market purchases) ──
    const accounts = db.prepare('SELECT id, steam_id FROM accounts').all() as { id: number; steam_id: string }[]
    const appIdRows = db.prepare('SELECT DISTINCT COALESCE(game_appid, 730) as appid FROM portfolio_items').all() as { appid: number }[]
    const appIds = appIdRows.map((r) => r.appid)

    let inventoryUpdated = 0
    let invPage = 0
    for (const account of accounts) {
      for (const appId of appIds) {
        try {
          const entries = await fetchInventoryHistory(account.steam_id, sessionCookie, appId, (page) => {
            invPage++
            send(invPage, -1, 'inventory')
          })
          inventoryUpdated += applyInventoryHistory(entries)
        } catch (err) {
          log.warn(`Inventory history failed for ${account.steam_id} appId=${appId}:`, err)
        }
      }
    }

    // ── Phase 2: Steam Market history (purchase prices for market buys) ──────
    const marketEntries = await fetchMarketHistory(sessionCookie, (page, total) => {
      send(page, total, 'market')
    })
    const marketUpdated = applyMarketHistory(marketEntries)

    return {
      inventory_updated: inventoryUpdated,
      market_fetched: marketEntries.length,
      market_updated: marketUpdated,
    }
  })

  // ── Alerts ────────────────────────────────────────────────────────────────
  ipcMain.handle('alerts:get', (_e, marketHashName: string) => {
    return getAlertConfig(marketHashName)
  })

  ipcMain.handle('alerts:set', (_e, marketHashName: string, gainMultipliers: number[], athDropThreshold: number, enabled: boolean) => {
    upsertAlertConfig(marketHashName, gainMultipliers, athDropThreshold, enabled)
    return { ok: true }
  })

  ipcMain.handle('alerts:recent', (_e, limit: number) => {
    return getRecentAlerts(limit)
  })

  // ── Settings ──────────────────────────────────────────────────────────────
  ipcMain.handle('settings:get-all', () => {
    const rows = getDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
    return Object.fromEntries(rows.map((r) => [r.key, r.value]))
  })

  ipcMain.handle('settings:set', (_e, key: string, value: string) => {
    const db = getDb()
    const prev = (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value
    db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)

    if (key === 'currency' && value !== prev) {
      // Prices are currency-specific — clear cached data so they re-fetch in the new currency
      db.exec('DELETE FROM price_history')
      db.prepare('UPDATE price_snapshots SET current_price = NULL, all_time_high = 0, last_fetched = NULL').run()
      log.info(`Currency changed from ${prev} to ${value} — price cache cleared`)
    }

    return { ok: true }
  })

  ipcMain.handle('notifications:test', () => {
    sendSystemNotification('SteamPortfolio', 'System notifications are working!')
    return { ok: true }
  })

  ipcMain.handle('shell:open-external', (_e, url: string) => {
    if (!url.startsWith('https://')) return
    shell.openExternal(url)
  })

  // ── App ───────────────────────────────────────────────────────────────────
  ipcMain.handle('app:version', () => app.getVersion())

  ipcMain.handle('app:get-autostart', () => app.getLoginItemSettings().openAtLogin)

  ipcMain.handle('app:set-autostart', (_e, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled })
    getDb().prepare("INSERT INTO settings(key,value) VALUES('autostart',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(enabled ? '1' : '0')
    return { ok: true }
  })

  ipcMain.handle('app:set-tray', (_e, enabled: boolean) => {
    getDb().prepare("INSERT INTO settings(key,value) VALUES('minimize_to_tray',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(enabled ? '1' : '0')
    updateTray()
    return { ok: true }
  })
}
