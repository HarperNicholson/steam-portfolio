import { contextBridge, ipcRenderer } from 'electron'
import { GAMES } from '../shared/games'

export { GAMES }

export type Account = {
  id: number
  steam_id: string
  display_name: string | null
  avatar_url: string | null
  added_at: number
}

export type StickerInfo = { name: string; icon_url: string }

export type InventoryRow = {
  market_hash_name: string
  name: string
  type: string | null
  rarity: string | null
  rarity_color: string | null
  exterior: string | null
  icon_url: string
  quantity: number
  tradable: number
  stickers: string  // JSON string of StickerInfo[] — empty string means no stickers
  game_appid: number
  asset_id: string | null  // set only for stickered items (individual rows)
  current_price: number | null
  acquisition_price: number | null
  acquisition_date: number | null
  all_time_high: number | null
  last_fetched: number | null
}

export type PricePoint = { timestamp: number; price_usd: number; volume: number }

export type AlertConfig = {
  market_hash_name: string
  gain_multipliers: number[]
  ath_drop_threshold: number
  enabled: boolean
}

export type FiredAlert = {
  market_hash_name: string
  alert_type: string
  price: number
  message: string
}

export type AlertHistoryEntry = {
  market_hash_name: string
  alert_type: string
  triggered_at: number
  price_at_trigger: number
}

export type AppSettings = Record<string, string>

const api = {
  accounts: {
    add: (input: string): Promise<Account> => ipcRenderer.invoke('accounts:add', input),
    list: (): Promise<Account[]> => ipcRenderer.invoke('accounts:list'),
    remove: (accountId: number): Promise<{ ok: boolean }> => ipcRenderer.invoke('accounts:remove', accountId)
  },
  inventory: {
    sync: (accountId: number, appId?: number): Promise<{ synced: number }> => ipcRenderer.invoke('inventory:sync', accountId, appId ?? 730),
    list: (accountId: number): Promise<InventoryRow[]> => ipcRenderer.invoke('inventory:list', accountId)
  },
  prices: {
    history: (marketHashName: string): Promise<PricePoint[]> => ipcRenderer.invoke('prices:history', marketHashName),
    current: (marketHashName: string): Promise<{ lowest_price: number | null; median_price: number | null }> =>
      ipcRenderer.invoke('prices:current', marketHashName),
    refreshAll: (): Promise<{ alerts_fired: number; alerts: FiredAlert[] }> =>
      ipcRenderer.invoke('prices:refresh-all'),
    snapshot: (marketHashName: string): Promise<{
      current_price: number
      acquisition_price: number | null
      acquisition_date: number | null
      all_time_high: number
    } | null> => ipcRenderer.invoke('prices:snapshot', marketHashName),
    setAcquisition: (marketHashName: string, acquisitionDate: number | null, acquisitionPrice: number | null): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('prices:set-acquisition', marketHashName, acquisitionDate, acquisitionPrice),
    resetAcquisition: (marketHashName: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('prices:reset-acquisition', marketHashName)
  },
  market: {
    importHistory: (): Promise<{ inventory_updated: number; market_fetched: number; market_updated: number }> =>
      ipcRenderer.invoke('market:import-history')
  },
  alerts: {
    get: (marketHashName: string): Promise<AlertConfig> => ipcRenderer.invoke('alerts:get', marketHashName),
    set: (
      marketHashName: string,
      gainMultipliers: number[],
      athDropThreshold: number,
      enabled: boolean
    ): Promise<{ ok: boolean }> => ipcRenderer.invoke('alerts:set', marketHashName, gainMultipliers, athDropThreshold, enabled),
    recent: (limit?: number): Promise<AlertHistoryEntry[]> => ipcRenderer.invoke('alerts:recent', limit ?? 20)
  },
  settings: {
    getAll: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get-all'),
    set: (key: string, value: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('settings:set', key, value)
  },
  notifications: {
    test: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('notifications:test')
  },
  shell: {
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:open-external', url)
  },
  on: {
    pricesUpdated: (cb: (alerts: FiredAlert[]) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, alerts: FiredAlert[]): void => cb(alerts)
      ipcRenderer.on('prices:updated', handler)
      return () => ipcRenderer.off('prices:updated', handler)
    },
    importProgress: (cb: (page: number, total: number, phase: string) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: { page: number; total: number; phase: string }): void =>
        cb(data.page, data.total, data.phase)
      ipcRenderer.on('market:import-progress', handler)
      return () => ipcRenderer.off('market:import-progress', handler)
    }
  }
}

contextBridge.exposeInMainWorld('sp', api)

declare global {
  interface Window {
    sp: typeof api
  }
}
