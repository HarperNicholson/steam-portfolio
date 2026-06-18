/// <reference types="vite/client" />

type StickerInfo = { name: string; icon_url: string }

declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

type Account = {
  id: number
  steam_id: string
  display_name: string | null
  avatar_url: string | null
  added_at: number
}

type InventoryRow = {
  market_hash_name: string
  name: string
  type: string | null
  rarity: string | null
  rarity_color: string | null
  exterior: string | null
  icon_url: string
  quantity: number
  tradable: number
  stickers: string
  game_appid: number
  asset_id: string | null
  current_price: number | null
  acquisition_price: number | null
  acquisition_date: number | null
  all_time_high: number | null
  last_fetched: number | null
}

type PricePoint = { timestamp: number; price_usd: number; volume: number }

type AlertConfig = {
  market_hash_name: string
  gain_multipliers: number[]
  ath_drop_threshold: number
  enabled: boolean
}

type FiredAlert = {
  market_hash_name: string
  alert_type: string
  price: number
  message: string
}

type AlertHistoryEntry = {
  market_hash_name: string
  alert_type: string
  triggered_at: number
  price_at_trigger: number
}

type PriceSnapshot = {
  current_price: number
  acquisition_price: number | null
  acquisition_date: number | null
  acquisition_date_locked: number
  all_time_high: number
} | null

type CurrentPrice = {
  lowest_price: number | null
  median_price: number | null
}

type AppSettings = Record<string, string>

type SteamPortfolioApi = {
  accounts: {
    add(input: string): Promise<Account>
    list(): Promise<Account[]>
    remove(accountId: number): Promise<{ ok: boolean }>
  }
  inventory: {
    sync(accountId: number, appId?: number): Promise<{ synced: number }>
    list(accountId: number): Promise<InventoryRow[]>
  }
  prices: {
    history(marketHashName: string): Promise<PricePoint[]>
    current(marketHashName: string): Promise<CurrentPrice>
    refreshAll(): Promise<{ alerts_fired: number; alerts: FiredAlert[] }>
    snapshot(marketHashName: string): Promise<PriceSnapshot>
    setAcquisition(marketHashName: string, date: number | null, price: number | null): Promise<{ ok: boolean }>
    resetAcquisition(marketHashName: string): Promise<{ ok: boolean }>
  }
  market: {
    importHistory(): Promise<{ inventory_updated: number; market_fetched: number; market_updated: number }>
  }
  alerts: {
    get(marketHashName: string): Promise<AlertConfig>
    set(
      marketHashName: string,
      gainMultipliers: number[],
      athDropThreshold: number,
      enabled: boolean
    ): Promise<{ ok: boolean }>
    recent(limit?: number): Promise<AlertHistoryEntry[]>
  }
  settings: {
    getAll(): Promise<AppSettings>
    set(key: string, value: string): Promise<{ ok: boolean }>
  }
  notifications: {
    test(): Promise<{ ok: boolean }>
  }
  shell: {
    openExternal(url: string): Promise<void>
  }
  on: {
    pricesUpdated(cb: (alerts: FiredAlert[]) => void): () => void
    importProgress(cb: (page: number, total: number, phase: string) => void): () => void
  }
}

declare interface Window {
  sp: SteamPortfolioApi
}
