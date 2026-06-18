import log from 'electron-log'
import { Notification } from 'electron'
import { execFile } from 'child_process'
import { getDb, AlertConfig } from '../db'

export type FiredAlert = {
  market_hash_name: string
  alert_type: string
  price: number
  message: string
}

export function checkAlerts(
  marketHashName: string,
  currentPrice: number,
  acquisitionPrice: number | null,
  allTimeHigh: number,
  smartPeak?: number | null
): FiredAlert[] {
  const db = getDb()
  const configRow = db
    .prepare('SELECT * FROM alert_configs WHERE market_hash_name = ?')
    .get(marketHashName) as (Omit<AlertConfig, 'gain_multipliers' | 'enabled'> & { gain_multipliers: string; enabled: number }) | undefined

  if (!configRow || !configRow.enabled) return []

  const config: AlertConfig = {
    ...configRow,
    gain_multipliers: JSON.parse(configRow.gain_multipliers) as number[],
    enabled: configRow.enabled === 1
  }

  const fired: FiredAlert[] = []

  if (acquisitionPrice && acquisitionPrice > 0) {
    for (const multiplier of config.gain_multipliers) {
      const alertType = `gain_${multiplier}x`
      const targetPrice = acquisitionPrice * multiplier
      if (currentPrice >= targetPrice && !hasTriggeredRecently(marketHashName, alertType)) {
        fired.push({
          market_hash_name: marketHashName,
          alert_type: alertType,
          price: currentPrice,
          message: `${marketHashName} hit ${multiplier}x from acquisition ($${currentPrice.toFixed(2)})`
        })
        recordAlert(marketHashName, alertType, currentPrice)
      }
    }
  }

  const peakForDrop = (smartPeak ?? 0) > 0 ? smartPeak! : allTimeHigh
  const peakLabel = (smartPeak ?? 0) > 0 ? 'Smart Peak' : 'ATH'
  if (peakForDrop > 0 && config.ath_drop_threshold > 0) {
    const dropPercent = (peakForDrop - currentPrice) / peakForDrop
    if (dropPercent >= config.ath_drop_threshold) {
      const alertType = 'ath_drop'
      if (!hasTriggeredRecently(marketHashName, alertType, 24 * 60 * 60)) {
        fired.push({
          market_hash_name: marketHashName,
          alert_type: alertType,
          price: currentPrice,
          message: `${marketHashName} dropped ${(dropPercent * 100).toFixed(1)}% from ${peakLabel} ($${currentPrice.toFixed(2)})`
        })
        recordAlert(marketHashName, alertType, currentPrice)
      }
    }
  }

  return fired
}

function hasTriggeredRecently(
  marketHashName: string,
  alertType: string,
  windowSeconds = 7 * 24 * 60 * 60
): boolean {
  const db = getDb()
  const cutoff = Math.floor(Date.now() / 1000) - windowSeconds
  const row = db
    .prepare(
      `SELECT id FROM alert_history WHERE market_hash_name = ? AND alert_type = ? AND triggered_at > ?`
    )
    .get(marketHashName, alertType, cutoff)
  return !!row
}

function recordAlert(marketHashName: string, alertType: string, price: number): void {
  getDb()
    .prepare(
      `INSERT INTO alert_history(market_hash_name, alert_type, price_at_trigger) VALUES (?, ?, ?)`
    )
    .run(marketHashName, alertType, price)
}

export function sendSystemNotification(title: string, body: string): void {
  log.info(`sendSystemNotification: platform=${process.platform}, Notification.isSupported()=${Notification.isSupported()}`)
  try {
    // On Linux (SteamOS/KDE), notify-send via D-Bus is more reliable than Electron's Notification
    if (process.platform === 'linux') {
      execFile('notify-send', ['--app-name=SteamPortfolio', '-t', '5000', '--', title, body], (err) => {
        if (err) {
          log.warn('notify-send failed:', err.message)
          // Fall back to Electron's Notification if notify-send isn't available
          if (Notification.isSupported()) {
            try { new Notification({ title, body }).show() } catch (e) { log.warn('Electron Notification also failed:', e) }
          }
        } else {
          log.info('notify-send dispatched successfully')
        }
      })
      return
    }
    if (Notification.isSupported()) {
      new Notification({ title, body }).show()
    }
  } catch (err) {
    log.warn('System notification failed', err)
  }
}

export function upsertAlertConfig(
  marketHashName: string,
  gainMultipliers: number[],
  athDropThreshold: number,
  enabled: boolean
): void {
  getDb()
    .prepare(
      `INSERT INTO alert_configs(market_hash_name, gain_multipliers, ath_drop_threshold, enabled)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(market_hash_name) DO UPDATE SET
         gain_multipliers = excluded.gain_multipliers,
         ath_drop_threshold = excluded.ath_drop_threshold,
         enabled = excluded.enabled`
    )
    .run(marketHashName, JSON.stringify(gainMultipliers), athDropThreshold, enabled ? 1 : 0)
}

export function getAlertConfig(marketHashName: string): AlertConfig {
  const db = getDb()
  const row = db
    .prepare('SELECT * FROM alert_configs WHERE market_hash_name = ?')
    .get(marketHashName) as (Omit<AlertConfig, 'gain_multipliers' | 'enabled'> & { gain_multipliers: string; enabled: number }) | undefined

  if (!row) {
    // Use global defaults from settings
    const settingsRows = db
      .prepare("SELECT key, value FROM settings WHERE key IN ('default_gain_multipliers', 'default_ath_drop_threshold', 'default_alerts_enabled')")
      .all() as { key: string; value: string }[]
    const s = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]))
    return {
      market_hash_name: marketHashName,
      gain_multipliers: JSON.parse(s['default_gain_multipliers'] ?? '[2,3,4]') as number[],
      ath_drop_threshold: parseFloat(s['default_ath_drop_threshold'] ?? '0.1'),
      enabled: s['default_alerts_enabled'] === '1'
    }
  }
  return {
    ...row,
    gain_multipliers: JSON.parse(row.gain_multipliers) as number[],
    enabled: row.enabled === 1
  }
}

export function getRecentAlerts(limit = 20): AlertHistoryEntry[] {
  return getDb()
    .prepare(
      `SELECT market_hash_name, alert_type, triggered_at, price_at_trigger
       FROM alert_history ORDER BY triggered_at DESC LIMIT ?`
    )
    .all(limit) as AlertHistoryEntry[]
}

export type AlertHistoryEntry = {
  market_hash_name: string
  alert_type: string
  triggered_at: number
  price_at_trigger: number
}
