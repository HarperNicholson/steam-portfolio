import log from 'electron-log'
import { getDb, transaction } from '../db'
import type { InventoryHistoryEntry } from './inventory_history'

export type CurrencyParams = { country: string; steamCurrency: number }

export const CURRENCY_PARAMS: Record<string, CurrencyParams> = {
  USD: { country: 'US', steamCurrency: 1 },
  CAD: { country: 'CA', steamCurrency: 20 },
  EUR: { country: 'DE', steamCurrency: 3 },
  GBP: { country: 'GB', steamCurrency: 2 },
  AUD: { country: 'AU', steamCurrency: 21 },
}

export type PricePoint = {
  timestamp: number
  price_usd: number
  volume: number
}

export type CurrentPrice = {
  lowest_price: number | null
  median_price: number | null
  volume: number | null
}

const MONTH_MAP: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
}

function parseSteamDate(dateStr: string): number {
  // Format: "Jun 14 2024 01: +0" or "Jun 14 2024 01"
  const parts = dateStr.trim().split(' ')
  const month = MONTH_MAP[parts[0]] ?? 0
  const day = parseInt(parts[1], 10)
  const year = parseInt(parts[2], 10)
  const hour = parseInt((parts[3] ?? '0').replace(':', ''), 10) || 0
  return Date.UTC(year, month, day, hour) / 1000
}

function parsePriceStr(raw: string | number): number {
  if (typeof raw === 'number') return raw
  return parseFloat(raw.replace(/[^0-9.]/g, '')) || 0
}

export async function fetchPriceHistory(
  marketHashName: string,
  sessionCookie?: string,
  cp: CurrencyParams = CURRENCY_PARAMS.USD,
  appId = 730
): Promise<PricePoint[]> {
  const encoded = encodeURIComponent(marketHashName)
  const url = `https://steamcommunity.com/market/pricehistory/?country=${cp.country}&currency=${cp.steamCurrency}&appid=${appId}&market_hash_name=${encoded}`
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'application/json',
    Referer: 'https://steamcommunity.com/market/'
  }
  if (sessionCookie) {
    headers['Cookie'] = sessionCookie.includes('=') ? sessionCookie : `steamLoginSecure=${sessionCookie}`
  }

  const res = await fetch(url, { headers })
  if (res.status === 400 || res.status === 403) {
    log.warn(`Price history unavailable for "${marketHashName}" (${res.status})`)
    return []
  }
  if (res.status === 429) {
    throw new Error('Steam rate limit hit fetching price history')
  }
  if (!res.ok) {
    log.warn(`Price history request failed for "${marketHashName}" (HTTP ${res.status})`)
    return []
  }

  const data = (await res.json()) as {
    success: boolean
    prices?: Array<[string, number | string, string | number]>
  }

  if (!data.success || !data.prices) return []

  const points: PricePoint[] = data.prices.map(([dateStr, price, vol]) => ({
    timestamp: parseSteamDate(dateStr),
    price_usd: parsePriceStr(price),
    volume: typeof vol === 'string' ? parseInt(vol, 10) : (vol as number)
  }))

  storePriceHistory(marketHashName, points)
  return points
}

function storePriceHistory(marketHashName: string, points: PricePoint[]): void {
  const db = getDb()
  const insert = db.prepare(
    `INSERT OR REPLACE INTO price_history(market_hash_name, timestamp, price_usd, volume) VALUES (?, ?, ?, ?)`
  )
  transaction(db, () => {
    for (const p of points) {
      insert.run(marketHashName, p.timestamp, p.price_usd, p.volume)
    }
  })
}

export function getCachedPriceHistory(marketHashName: string): PricePoint[] {
  const db = getDb()
  return db
    .prepare(
      `SELECT timestamp, price_usd, volume FROM price_history
       WHERE market_hash_name = ? ORDER BY timestamp ASC`
    )
    .all(marketHashName) as PricePoint[]
}

export async function fetchCurrentPrice(
  marketHashName: string,
  cp: CurrencyParams = CURRENCY_PARAMS.USD,
  appId = 730
): Promise<CurrentPrice> {
  const encoded = encodeURIComponent(marketHashName)
  const url = `https://steamcommunity.com/market/priceoverview/?country=${cp.country}&currency=${cp.steamCurrency}&appid=${appId}&market_hash_name=${encoded}`
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: 'https://steamcommunity.com/'
      }
    })
    if (!res.ok) return { lowest_price: null, median_price: null, volume: null }
    const data = (await res.json()) as {
      success: boolean
      lowest_price?: string
      median_price?: string
      volume?: string
    }
    if (!data.success) return { lowest_price: null, median_price: null, volume: null }
    return {
      lowest_price: data.lowest_price ? parsePriceStr(data.lowest_price) : null,
      median_price: data.median_price ? parsePriceStr(data.median_price) : null,
      volume: data.volume ? parseInt(data.volume.replace(/,/g, ''), 10) : null
    }
  } catch {
    return { lowest_price: null, median_price: null, volume: null }
  }
}

function parseHistoryHtml(html: string): MarketHistoryEntry[] {
  const results: MarketHistoryEntry[] = []
  // Each row starts with this marker
  const rows = html.split('<div class="market_listing_row market_recent_listing_row"')

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]

    // Only buy events — gainorloss contains "+" for buys, "-" for sells
    if (!/<div class="market_listing_left_cell market_listing_gainorloss">\s*\+/.test(row)) continue

    // Item name — market_listing_item_name span
    const nameMatch = row.match(/class="market_listing_item_name"[^>]*>\s*([^<]+?)\s*<\/span>/)
    if (!nameMatch) continue
    const hashName = decodeHtml(nameMatch[1].trim())

    // First market_listing_listed_date = "ACTED ON" column = when the buy happened
    const dateMatch = row.match(/class="market_listing_listed_date can_combine">\s*([^<\n]+?)\s*<\/div>/)
    if (!dateMatch) continue
    const acquired_at = parseSteamHistoryDate(dateMatch[1].trim())
    if (!acquired_at) continue

    // price_usd is 0 here — applyMarketHistory will NULL acquisition_price so the
    // scheduler recalculates it in USD from price_history at the correct date
    results.push({ market_hash_name: hashName, acquired_at, price_usd: 0 })
  }

  return results
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function parseSteamHistoryDate(dateStr: string): number | null {
  // With year: "9 Jun, 2024" or "9 Jun 2024"
  const withYear = dateStr.match(/(\d+)\s+(\w+)[,\s]+(\d{4})/)
  if (withYear) {
    const d = new Date(`${withYear[2]} ${withYear[1]}, ${withYear[3]}`)
    return isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 1000)
  }
  // Without year: "9 Jun" — assume current year; if that's in the future, use previous year
  const noYear = dateStr.match(/(\d+)\s+(\w+)/)
  if (noYear) {
    const year = new Date().getFullYear()
    const d = new Date(`${noYear[2]} ${noYear[1]}, ${year}`)
    if (isNaN(d.getTime())) return null
    if (d.getTime() > Date.now()) d.setFullYear(year - 1)
    return Math.floor(d.getTime() / 1000)
  }
  return null
}

export type MarketHistoryEntry = {
  market_hash_name: string
  acquired_at: number  // unix seconds
  price_usd: number
}

// Fetches Steam Market purchase history (appid 730).
// Steam returns entries in reverse-chronological order; we paginate until no more.
// Only covers market buys — trades, drops, and case openings are not included.
export async function fetchMarketHistory(
  sessionCookie: string,
  onProgress?: (page: number, total: number) => void
): Promise<MarketHistoryEntry[]> {
  const cookieHeader = sessionCookie.includes('=') ? sessionCookie : `steamLoginSecure=${sessionCookie}`
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'application/json',
    Referer: 'https://steamcommunity.com/market/',
    Cookie: cookieHeader
  }

  const results: MarketHistoryEntry[] = []
  let start = 0
  const pageSize = 100

  for (let page = 0; page < 50; page++) {
    // No appid filter — fetch all history and filter by appid client-side
    const url = `https://steamcommunity.com/market/myhistory/render/?query=&start=${start}&count=${pageSize}`
    log.info(`Fetching market history page ${page + 1} (start=${start})`)
    const res = await fetch(url, { headers })
    if (res.status === 403 || res.status === 401) {
      throw new Error('Steam rejected the session cookie. Make sure steamLoginSecure is set and valid.')
    }
    if (res.status === 429) throw new Error('Steam rate limit — try again later.')
    if (!res.ok) throw new Error(`Market history request failed (HTTP ${res.status})`)

    const text = await res.text()

    let data: Record<string, unknown>
    try {
      data = JSON.parse(text) as Record<string, unknown>
    } catch (e) {
      log.error('Market history JSON parse failed:', String(e))
      break
    }

    if (!data['success']) { log.warn('Market history success=false, stopping'); break }

    const html = (data['results_html'] as string) ?? ''
    const parsed = parseHistoryHtml(html)
    log.info(`Market history page ${page + 1}: ${parsed.length} market buys`)
    results.push(...parsed)
    const totalPages = Math.ceil((data['total_count'] as number ?? pageSize) / pageSize)
    onProgress?.(page + 1, totalPages)

    // results_html is empty when we've exhausted history
    if (!html.trim()) break
    // stop if we got a short page
    const rowCount = (html.match(/market_recent_listing_row/g) ?? []).length
    if (rowCount < pageSize) break
    start += pageSize
    await new Promise((r) => setTimeout(r, 3000))
  }

  log.info(`Market history fetched: ${results.length} market purchase entries`)
  return results
}

// Applies market history entries to price_snapshots.
// Only sets acquisition_date/price if it's earlier than what's already stored
// (so trade-lock data from inventory sync is not overwritten if it's more precise).
export function applyMarketHistory(entries: MarketHistoryEntry[]): number {
  const db = getDb()
  // Store only the date; NULL out acquisition_price so the scheduler recalculates
  // it in USD from price_history at the correct date (HTML prices are in local currency).
  const upsert = db.prepare(`
    INSERT INTO price_snapshots(market_hash_name, acquisition_date, acquisition_price)
    VALUES (?, ?, NULL)
    ON CONFLICT(market_hash_name) DO UPDATE SET
      acquisition_date  = excluded.acquisition_date,
      acquisition_price = NULL
    WHERE NOT COALESCE(acquisition_date_locked, 0)
  `)

  // Group by market_hash_name — keep the oldest purchase per item
  const earliest = new Map<string, MarketHistoryEntry>()
  for (const e of entries) {
    const cur = earliest.get(e.market_hash_name)
    if (!cur || e.acquired_at < cur.acquired_at) earliest.set(e.market_hash_name, e)
  }

  let updated = 0
  transaction(db, () => {
    for (const e of earliest.values()) {
      const info = upsert.run(e.market_hash_name, e.acquired_at) as unknown as { changes: number }
      if (info?.changes) updated++
    }
  })
  log.info(`Market history applied: ${updated} items updated`)
  return updated
}

// Applies inventory history entries to price_snapshots.
// Only sets acquisition_date — leaves acquisition_price untouched so manually-set
// or market-history prices are preserved.
export function applyInventoryHistory(entries: InventoryHistoryEntry[]): number {
  const db = getDb()
  const upsert = db.prepare(`
    INSERT INTO price_snapshots(market_hash_name, acquisition_date, acquisition_price)
    VALUES (?, ?, NULL)
    ON CONFLICT(market_hash_name) DO UPDATE SET
      acquisition_date = excluded.acquisition_date
    WHERE NOT COALESCE(acquisition_date_locked, 0)
  `)

  // Keep the earliest acquisition per item
  const earliest = new Map<string, InventoryHistoryEntry>()
  for (const e of entries) {
    const cur = earliest.get(e.market_hash_name)
    if (!cur || e.acquired_at < cur.acquired_at) earliest.set(e.market_hash_name, e)
  }

  let updated = 0
  transaction(db, () => {
    for (const e of earliest.values()) {
      const info = upsert.run(e.market_hash_name, e.acquired_at) as unknown as { changes: number }
      if (info?.changes) updated++
    }
  })
  log.info(`Inventory history applied: ${updated} items updated`)
  return updated
}

export function findPriceAtDate(points: PricePoint[], targetTs: number): number | null {
  if (points.length === 0) return null
  let closest = points[0]
  let minDiff = Math.abs(points[0].timestamp - targetTs)
  for (const p of points) {
    const diff = Math.abs(p.timestamp - targetTs)
    if (diff < minDiff) {
      minDiff = diff
      closest = p
    }
  }
  return closest.price_usd
}
