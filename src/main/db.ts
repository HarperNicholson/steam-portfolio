import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { app } from 'electron'
import path from 'path'
import log from 'electron-log'

let db: DatabaseSync

export function getDb(): DatabaseSync {
  if (!db) {
    const dbPath = path.join(app.getPath('userData'), 'portfolio.db')
    log.info('Opening database at', dbPath)
    db = new DatabaseSync(dbPath)
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA foreign_keys = ON')
    migrate(db)
  }
  return db
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      steam_id    TEXT UNIQUE NOT NULL,
      display_name TEXT,
      avatar_url  TEXT,
      added_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS portfolio_items (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id        INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      asset_id          TEXT NOT NULL,
      class_id          TEXT NOT NULL,
      instance_id       TEXT NOT NULL,
      market_hash_name  TEXT NOT NULL,
      name              TEXT NOT NULL,
      type              TEXT,
      rarity            TEXT,
      rarity_color      TEXT,
      exterior          TEXT,
      icon_url          TEXT NOT NULL,
      tradable          INTEGER DEFAULT 1,
      added_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(account_id, asset_id)
    );

    CREATE INDEX IF NOT EXISTS idx_portfolio_items_account
      ON portfolio_items(account_id);
    CREATE INDEX IF NOT EXISTS idx_portfolio_items_hash_name
      ON portfolio_items(market_hash_name);

    CREATE TABLE IF NOT EXISTS price_history (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      market_hash_name  TEXT NOT NULL,
      timestamp         INTEGER NOT NULL,
      price_usd         REAL NOT NULL,
      volume            INTEGER DEFAULT 0,
      UNIQUE(market_hash_name, timestamp)
    );

    CREATE INDEX IF NOT EXISTS idx_price_history_lookup
      ON price_history(market_hash_name, timestamp DESC);

    CREATE TABLE IF NOT EXISTS price_snapshots (
      market_hash_name    TEXT PRIMARY KEY,
      acquisition_price   REAL,
      acquisition_date    INTEGER,
      all_time_high       REAL DEFAULT 0,
      current_price       REAL DEFAULT 0,
      last_fetched        INTEGER
    );

    CREATE TABLE IF NOT EXISTS alert_configs (
      market_hash_name      TEXT PRIMARY KEY,
      gain_multipliers      TEXT NOT NULL DEFAULT '[2,3,4]',
      ath_drop_threshold    REAL NOT NULL DEFAULT 0.1,
      enabled               INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS alert_history (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      market_hash_name  TEXT NOT NULL,
      alert_type        TEXT NOT NULL,
      triggered_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      price_at_trigger  REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    INSERT OR IGNORE INTO settings(key, value) VALUES
      ('theme', 'steam-dark'),
      ('currency', 'USD'),
      ('refresh_interval_hours', '6'),
      ('notifications_enabled', '1'),
      ('session_cookie', '');
  `)

  // Additive column migrations — safe to re-run on existing databases
  try { db.exec("ALTER TABLE portfolio_items ADD COLUMN stickers TEXT DEFAULT ''") } catch { /* already exists */ }
  try { db.exec('ALTER TABLE portfolio_items ADD COLUMN game_appid INTEGER DEFAULT 730') } catch { /* already exists */ }
  try { db.exec('ALTER TABLE price_snapshots ADD COLUMN acquisition_date_locked INTEGER DEFAULT 0') } catch { /* already exists */ }
  try { db.exec('ALTER TABLE portfolio_items ADD COLUMN marketable INTEGER DEFAULT 1') } catch { /* already exists */ }
  try { db.exec('ALTER TABLE portfolio_items ADD COLUMN hidden INTEGER DEFAULT 0') } catch { /* already exists */ }

  // Data fixes — safe to re-run, no-op when data is already correct
  db.exec("UPDATE price_snapshots SET all_time_high = COALESCE(current_price, 0) WHERE all_time_high IS NULL")
  db.exec(`UPDATE price_snapshots
    SET acquisition_date = NULL
    WHERE acquisition_date IS NOT NULL
      AND last_fetched IS NOT NULL
      AND (last_fetched - acquisition_date) BETWEEN -60 AND 2592000
      AND NOT COALESCE(acquisition_date_locked, 0)`)
}

export function transaction(db: DatabaseSync, fn: () => void): void {
  db.exec('BEGIN')
  try {
    fn()
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export type Account = {
  id: number
  steam_id: string
  display_name: string | null
  avatar_url: string | null
  added_at: number
}

export type PortfolioItem = {
  id: number
  account_id: number
  asset_id: string
  class_id: string
  instance_id: string
  market_hash_name: string
  name: string
  type: string | null
  rarity: string | null
  rarity_color: string | null
  exterior: string | null
  icon_url: string
  tradable: number
  added_at: number
}

export type PriceSnapshot = {
  market_hash_name: string
  acquisition_price: number | null
  acquisition_date: number | null
  all_time_high: number
  current_price: number
  last_fetched: number | null
}

export type AlertConfig = {
  market_hash_name: string
  gain_multipliers: number[]
  ath_drop_threshold: number
  enabled: boolean
}

export type AlertHistoryRow = {
  id: number
  market_hash_name: string
  alert_type: string
  triggered_at: number
  price_at_trigger: number
}

export type { StatementSync }
