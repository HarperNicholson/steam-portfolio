import log from 'electron-log'

export type InventoryHistoryEntry = {
  market_hash_name: string
  acquired_at: number   // unix seconds
}

type InventoryHistoryCursor = {
  time: number
  time_frac: number
  s: string
}

// Descriptions come nested: { [appId]: { [classid_instanceid]: desc } }
type ItemDesc = { market_hash_name?: string; name?: string }
type DescriptionMap = Record<string, Record<string, ItemDesc>>

// Parse a date string out of whatever HTML text Steam puts in the date cell.
// Handles: "Jun 12, 2024", "12 Jun, 2024", "Jun 12" (no year), "12 Jun" (no year)
function parseDateHtml(html: string): number | null {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

  const mMonthFirst = text.match(/([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})/)
  if (mMonthFirst) {
    const d = new Date(mMonthFirst[1].replace(',', ''))
    if (!isNaN(d.getTime())) return Math.floor(d.getTime() / 1000)
  }
  const mDayFirst = text.match(/(\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{4})/)
  if (mDayFirst) {
    const d = new Date(mDayFirst[1].replace(',', ''))
    if (!isNaN(d.getTime())) return Math.floor(d.getTime() / 1000)
  }

  // Without year
  const mNoYear = text.match(/([A-Za-z]{3,9}\.?\s+\d{1,2}|\d{1,2}\s+[A-Za-z]{3,9})/)
  if (mNoYear) {
    const year = new Date().getFullYear()
    const d = new Date(`${mNoYear[1]}, ${year}`)
    if (!isNaN(d.getTime())) {
      if (d.getTime() > Date.now()) d.setFullYear(year - 1)
      return Math.floor(d.getTime() / 1000)
    }
  }

  return null
}

function parseRows(html: string, appId: number, descriptions: DescriptionMap): InventoryHistoryEntry[] {
  const results: InventoryHistoryEntry[] = []

  // Descriptions are nested: descriptions[appId][classid_instanceid]
  const appDescs: Record<string, ItemDesc> = descriptions[String(appId)] ?? {}

  const rows = html.split('<div class="tradehistoryrow"')

  for (let ri = 1; ri < rows.length; ri++) {
    const row = rows[ri]

    // ── Date ─────────────────────────────────────────────────────────────────
    const dateTagIdx = row.indexOf('tradehistory_date')
    const dateSectionEnd = dateTagIdx !== -1 ? row.indexOf('</div>', dateTagIdx) : -1
    let acquired_at: number | null = null
    if (dateTagIdx !== -1 && dateSectionEnd !== -1) {
      acquired_at = parseDateHtml(row.substring(dateTagIdx, dateSectionEnd))
    }
    if (!acquired_at) acquired_at = parseDateHtml(row.substring(0, 400))
    if (!acquired_at) continue

    // ── Received items ────────────────────────────────────────────────────────
    // Steam uses tradehistory_items_plusminus containing "+" or "-" to mark direction.
    // Split on each plusminus occurrence; the block following a "+" contains received items.
    const parts = row.split('class="tradehistory_items_plusminus"')
    for (let pi = 1; pi < parts.length; pi++) {
      const part = parts[pi]

      // The content of the plusminus div is right after the closing ">"
      const signMatch = part.match(/^[^>]*>([+-])/)
      if (!signMatch || signMatch[1] !== '+') continue

      // Extract data-classid / data-instanceid from items in this "+" block
      const classidRe = /data-classid="(\d+)"[^>]*data-instanceid="(\d+)"/g
      let cidMatch: RegExpExecArray | null
      while ((cidMatch = classidRe.exec(part)) !== null) {
        const classid = cidMatch[1]
        const instanceid = cidMatch[2]
        const desc = appDescs[`${classid}_${instanceid}`] ?? appDescs[classid]
        const name = desc?.market_hash_name ?? desc?.name
        if (name) results.push({ market_hash_name: name, acquired_at })
      }
    }
  }

  return results
}

export async function fetchInventoryHistory(
  steamId: string,
  sessionCookie: string,
  appId = 730,
  onProgress?: (page: number) => void
): Promise<InventoryHistoryEntry[]> {
  const cookieHeader = sessionCookie.includes('=') ? sessionCookie : `steamLoginSecure=${sessionCookie}`
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'application/json',
    Referer: `https://steamcommunity.com/profiles/${steamId}/inventoryhistory/`,
    Cookie: cookieHeader,
  }

  const results: InventoryHistoryEntry[] = []
  let cursor: InventoryHistoryCursor | null = null

  for (let page = 0; page < 200; page++) {
    let url = `https://steamcommunity.com/profiles/${steamId}/inventoryhistory/?l=english&ajax=1&app[]=${appId}`
    if (cursor) {
      url += `&cursor[time]=${cursor.time}&cursor[time_frac]=${cursor.time_frac}&cursor[s]=${encodeURIComponent(cursor.s)}`
    }

    log.info(`Fetching inventory history page ${page + 1} for ${steamId} (appId=${appId})`)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    let res: Response
    try {
      res = await fetch(url, { headers, signal: controller.signal })
    } catch (err: unknown) {
      clearTimeout(timeout)
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('abort') || msg.includes('AbortError')) {
        log.warn(`Inventory history page ${page + 1} timed out`)
        break
      }
      throw err
    }
    clearTimeout(timeout)
    if (res.status === 403 || res.status === 401) {
      // Only throw auth errors if we haven't collected anything yet
      if (results.length === 0) throw new Error('Steam rejected the session cookie. Make sure steamLoginSecure is set and valid.')
      log.warn(`Inventory history auth error on page ${page + 1}, returning ${results.length} collected entries`)
      break
    }
    if (res.status === 429) {
      // Rate limit — return what we have so far rather than discarding it
      log.warn(`Inventory history rate limited on page ${page + 1}, returning ${results.length} collected entries`)
      break
    }
    if (!res.ok) {
      log.warn(`Inventory history HTTP ${res.status} for ${steamId} appId=${appId}`)
      break
    }

    let data: Record<string, unknown>
    try {
      data = (await res.json()) as Record<string, unknown>
    } catch {
      log.warn(`Inventory history page ${page + 1}: non-JSON response, stopping`)
      break
    }

    if (!data['success']) break

    const html = (data['html'] as string) ?? ''
    if (!html.trim()) break

    const descriptions = (data['descriptions'] as DescriptionMap | null) ?? {}
    const entries = parseRows(html, appId, descriptions)
    log.info(`Inventory history page ${page + 1}: ${entries.length} received items`)
    results.push(...entries)

    onProgress?.(page + 1)

    const nextCursor = data['cursor'] as InventoryHistoryCursor | undefined
    if (!nextCursor?.time) break

    cursor = nextCursor
    await new Promise((r) => setTimeout(r, 2500))
  }

  log.info(`Inventory history done: ${results.length} items for ${steamId} appId=${appId}`)
  return results
}
