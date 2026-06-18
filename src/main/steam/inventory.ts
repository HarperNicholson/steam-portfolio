import log from 'electron-log'

export type SteamAsset = {
  appid: number
  contextid: string
  assetid: string
  classid: string
  instanceid: string
  amount: string
}

export type SteamTag = {
  category: string
  internal_name: string
  localized_category_name: string
  localized_tag_name: string
  color?: string
}

export type SteamItemDesc = {
  type: string
  value: string
}

export type SteamDescription = {
  appid: number
  classid: string
  instanceid: string
  name: string
  market_name: string
  market_hash_name: string
  icon_url: string
  type: string
  tradable: number
  marketable: number
  tags?: SteamTag[]
  descriptions?: SteamItemDesc[]
  owner_descriptions?: SteamItemDesc[]
}

export type StickerInfo = {
  name: string       // e.g. "FURIA | 2020 RMR"
  icon_url: string   // cdn URL from Steam inventory description
}

export type ProcessedItem = {
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
  marketable: number
  amount: number
  stickers: StickerInfo[]
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function parseStickers(desc: SteamDescription): StickerInfo[] {
  const allDescs = [...(desc.descriptions ?? []), ...(desc.owner_descriptions ?? [])]
  const stickers: StickerInfo[] = []
  for (const d of allDescs) {
    if (!d.value.includes('sticker_info')) continue
    // Iterate every <img> tag in the block — each sticker has its own img
    const imgRe = /<img([^>]+)>/gi
    let imgMatch: RegExpExecArray | null
    while ((imgMatch = imgRe.exec(d.value)) !== null) {
      const attrs = imgMatch[1]
      const titleM = attrs.match(/title="Sticker:\s*([^"]+)"/i)
      const srcM = attrs.match(/src="([^"]+)"/i)
      if (titleM) {
        stickers.push({ name: decodeHtmlEntities(titleM[1].trim()), icon_url: srcM?.[1] ?? '' })
      }
    }
  }
  return stickers
}

// "Tradable After Jun 21, 2026 (10:00:00) (UTC)" or similar
const TRADABLE_AFTER_RE = /Tradable After (\w+ \d+, \d{4})/i

function parseTradableAfter(desc: SteamDescription): number | null {
  const all = [...(desc.owner_descriptions ?? []), ...(desc.descriptions ?? [])]
  for (const d of all) {
    const m = (d.value ?? '').match(TRADABLE_AFTER_RE)
    if (m) {
      const ts = Date.parse(m[1])
      if (!isNaN(ts)) return Math.floor(ts / 1000) - 7 * 24 * 3600
    }
  }
  return null
}

const WEAR_MAP: Record<string, string> = {
  WearCategory0: 'Factory New',
  WearCategory1: 'Minimal Wear',
  WearCategory2: 'Field-Tested',
  WearCategory3: 'Well-Worn',
  WearCategory4: 'Battle-Scarred'
}

const ICON_BASE = 'https://community.akamai.steamstatic.com/economy/image/'

export async function fetchSteamInventory(
  steamId: string,
  sessionCookie?: string,
  appId = 730
): Promise<ProcessedItem[]> {
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    Referer: 'https://steamcommunity.com/'
  }
  if (sessionCookie) {
    const cookieHeader = sessionCookie.includes('=')
      ? sessionCookie
      : `steamLoginSecure=${sessionCookie}`
    headers['Cookie'] = cookieHeader
  }

  const allAssets: SteamAsset[] = []
  const allDescriptions: SteamDescription[] = []
  let startAssetId: string | undefined

  // Steam caps count at 2000; paginate for large inventories
  for (let page = 0; page < 10; page++) {
    let url = `https://steamcommunity.com/inventory/${steamId}/${appId}/2?l=english&count=2000`
    if (startAssetId) url += `&start_assetid=${startAssetId}`

    log.info(`Fetching CS2 inventory for ${steamId}${page > 0 ? ` (page ${page + 1})` : ''}`)
    const res = await fetch(url, { headers })

    if (res.status === 403) {
      throw new Error('Inventory is private.\nGo to Steam → Edit Profile → Privacy Settings → set "Game details" and "Inventory" to Public.')
    }
    if (res.status === 400) {
      const body = await res.text().catch(() => '')
      log.warn(`Inventory 400 for ${steamId}:`, body.slice(0, 200))
      throw new Error(
        `Steam returned an error for this inventory (HTTP 400).\n` +
          `This may mean the account has no CS2 inventory context yet, or Steam is temporarily unavailable.\n` +
          (body && body !== 'null' ? `Detail: ${body.slice(0, 120)}` : '')
      )
    }
    if (res.status === 429) {
      throw new Error('Steam rate limit hit. Please wait a few minutes and try again.')
    }
    if (!res.ok) {
      throw new Error(`Steam inventory request failed (HTTP ${res.status}).\nThis can happen if the Steam ID is wrong or Steam is temporarily unavailable.`)
    }

    const data = (await res.json()) as {
      assets?: SteamAsset[]
      descriptions?: SteamDescription[]
      success?: number
      more_items?: number
      last_assetid?: string
      Error?: string
    }

    if (data.success === 0) {
      throw new Error(data.Error ?? 'Steam returned an error for this inventory')
    }

    if (!data.assets || !data.descriptions) break

    allAssets.push(...data.assets)
    allDescriptions.push(...data.descriptions)

    if (!data.more_items || !data.last_assetid) break
    startAssetId = data.last_assetid
    await new Promise((r) => setTimeout(r, 1000))
  }

  if (allAssets.length === 0) return []

  const descMap = new Map<string, SteamDescription>()
  for (const d of allDescriptions) {
    descMap.set(`${d.classid}_${d.instanceid}`, d)
  }

  const items: ProcessedItem[] = []
  for (const asset of allAssets) {
    const desc = descMap.get(`${asset.classid}_${asset.instanceid}`)
    if (!desc) continue
    // Include non-marketable items (e.g. 7-day trade cooldown after unboxing) so they appear in portfolio

    const rarityTag = desc.tags?.find((t) => t.category === 'Rarity')
    const exteriorTag = desc.tags?.find((t) => t.category === 'Exterior')

    items.push({
      asset_id: asset.assetid,
      class_id: asset.classid,
      instance_id: asset.instanceid,
      market_hash_name: desc.market_hash_name,
      name: desc.market_name,
      type: desc.type || null,
      rarity: rarityTag?.localized_tag_name ?? null,
      rarity_color: rarityTag?.color ? `#${rarityTag.color}` : null,
      exterior: exteriorTag ? (WEAR_MAP[exteriorTag.internal_name] ?? exteriorTag.localized_tag_name) : null,
      icon_url: `${ICON_BASE}${desc.icon_url}`,
      tradable: desc.tradable,
      marketable: desc.marketable,
      amount: parseInt(asset.amount, 10) || 1,
      stickers: parseStickers(desc)
    })
  }

  log.info(`Fetched ${items.length} marketable items for ${steamId}`)
  return items
}

export async function resolveSteamId(input: string): Promise<string> {
  const trimmed = input.trim()

  if (/^\d{17}$/.test(trimmed)) return trimmed

  // Strip full URLs: handles both /profiles/STEAMID64 and /id/vanityname
  const stripped = trimmed
    .replace(/^https?:\/\/(www\.)?steamcommunity\.com\/(id|profiles)\//, '')
    .replace(/[/?#].*$/, '')
    .trim()

  if (/^\d{17}$/.test(stripped)) return stripped

  // Resolve vanity name via the public XML profile endpoint — no API key needed
  const xmlUrl = `https://steamcommunity.com/id/${encodeURIComponent(stripped)}/?xml=1`
  const res = await fetch(xmlUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    }
  })

  if (!res.ok) {
    throw new Error(
      `Could not fetch Steam profile for "${stripped}" (HTTP ${res.status}).\nCheck that the profile URL is correct and the profile is public.`
    )
  }

  const text = await res.text()
  const idMatch = text.match(/<steamID64>(\d{17})<\/steamID64>/)
  if (idMatch) return idMatch[1]

  if (text.includes('<error>')) {
    const errMatch = text.match(/<error>(.+?)<\/error>/)
    throw new Error(`Steam: ${errMatch?.[1] ?? 'profile not found'}.\nMake sure the vanity URL is correct.`)
  }

  throw new Error(
    `Could not extract Steam ID from profile "${stripped}".\nTry pasting your 17-digit Steam ID directly (found in your Steam profile URL).`
  )
}

export async function fetchSteamProfile(
  steamId: string
): Promise<{ display_name: string; avatar_url: string; location: string | null } | null> {
  try {
    const url = `https://steamcommunity.com/profiles/${steamId}/?xml=1`
    const res = await fetch(url)
    if (!res.ok) return null
    const text = await res.text()
    const nameMatch = text.match(/<steamID><!\[CDATA\[(.+?)\]\]><\/steamID>/)
    const avatarMatch = text.match(/<avatarFull><!\[CDATA\[(.+?)\]\]><\/avatarFull>/)
    const locationMatch = text.match(/<location><!\[CDATA\[(.+?)\]\]><\/location>/)
    return {
      display_name: nameMatch?.[1] ?? steamId,
      avatar_url: avatarMatch?.[1] ?? '',
      location: locationMatch?.[1] ?? null
    }
  } catch {
    return null
  }
}

const LOCATION_CURRENCIES: [RegExp, string][] = [
  [/canada|ontario|british columbia|alberta|quebec|manitoba|nova scotia|saskatchewan|newfoundland/i, 'CAD'],
  [/united kingdom|england|scotland|wales|northern ireland/i, 'GBP'],
  [/australia/i, 'AUD'],
  [/germany|france|italy|spain|netherlands|belgium|austria|portugal|finland|ireland|greece|denmark|sweden/i, 'EUR'],
]

export function detectCurrencyFromLocation(location: string): string | null {
  for (const [re, currency] of LOCATION_CURRENCIES) {
    if (re.test(location)) return currency
  }
  return null
}
