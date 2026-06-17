import { create } from 'zustand'

type Toast = {
  id: string
  title: string
  body: string
  type: 'info' | 'success' | 'warning' | 'alert'
  ts: number
  persist?: boolean  // if true, never auto-dismiss
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', CAD: 'CA$', EUR: '€', GBP: '£', AUD: 'A$'
}

export function currencySymbolFor(settings: AppSettings): string {
  return CURRENCY_SYMBOLS[settings['currency'] ?? 'USD'] ?? '$'
}

type State = {
  accounts: Account[]
  activeAccountId: number | null
  inventory: InventoryRow[]
  recentAlerts: AlertHistoryEntry[]
  toasts: Toast[]
  settings: AppSettings
  currencySymbol: string
  isLoadingInventory: boolean
  isSyncing: boolean
  selectedAppId: number
  isImportingHistory: boolean

  loadAccounts: () => Promise<void>
  setActiveAccount: (id: number) => void
  loadInventory: (accountId: number) => Promise<void>
  syncInventory: (accountId: number, appId?: number) => Promise<void>
  setSelectedAppId: (appId: number) => void
  loadSettings: () => Promise<void>
  setSetting: (key: string, value: string) => Promise<void>
  loadRecentAlerts: () => Promise<void>
  addToast: (title: string, body: string, type?: Toast['type'], id?: string, persist?: boolean) => void
  updateToast: (id: string, body: string) => void
  removeToast: (id: string) => void
  handlePricesUpdated: (alerts: FiredAlert[]) => void
  importHistory: () => Promise<void>
}

export const useStore = create<State>((set, get) => ({
  accounts: [],
  activeAccountId: null,
  inventory: [],
  recentAlerts: [],
  toasts: [],
  settings: {},
  currencySymbol: '$',
  isLoadingInventory: false,
  isSyncing: false,
  selectedAppId: 730,
  isImportingHistory: false,

  loadAccounts: async () => {
    const accounts = await window.sp.accounts.list()
    set({ accounts })
    if (accounts.length > 0 && !get().activeAccountId) {
      set({ activeAccountId: accounts[0].id })
      await get().loadInventory(accounts[0].id)
    }
  },

  setActiveAccount: (id) => {
    set({ activeAccountId: id, inventory: [] })
    get().loadInventory(id)
  },

  loadInventory: async (accountId) => {
    set({ isLoadingInventory: true })
    try {
      const inventory = await window.sp.inventory.list(accountId)
      set({ inventory })
    } finally {
      set({ isLoadingInventory: false })
    }
  },

  syncInventory: async (accountId, appId = 730) => {
    set({ isSyncing: true })
    try {
      const result = await window.sp.inventory.sync(accountId, appId)
      if (result.synced === 0) {
        get().addToast(
          'No items found',
          'Steam returned an empty inventory for this game.\nMake sure your Steam Inventory is set to Public in your privacy settings.',
          'warning'
        )
      } else {
        get().addToast('Sync complete', `${result.synced} items synced from Steam`, 'success')
      }
      await get().loadInventory(accountId)
    } catch (err) {
      get().addToast('Sync failed', String(err).replace(/^Error:\s*/, ''), 'warning')
    } finally {
      set({ isSyncing: false })
    }
  },

  loadSettings: async () => {
    const settings = await window.sp.settings.getAll()
    set({ settings, currencySymbol: currencySymbolFor(settings) })
    const theme = settings['theme'] ?? 'steam-dark'
    document.documentElement.setAttribute('data-theme', theme)
  },

  setSetting: async (key, value) => {
    await window.sp.settings.set(key, value)
    set((s) => {
      const settings = { ...s.settings, [key]: value }
      return { settings, currencySymbol: currencySymbolFor(settings) }
    })
    if (key === 'theme') {
      document.documentElement.setAttribute('data-theme', value)
    }
  },

  setSelectedAppId: (appId) => set({ selectedAppId: appId }),

  loadRecentAlerts: async () => {
    const recentAlerts = await window.sp.alerts.recent(20)
    set({ recentAlerts })
  },

  addToast: (title, body, type = 'info', id?, persist?) => {
    const toastId = id ?? `${Date.now()}-${Math.random()}`
    const toast: Toast = { id: toastId, title, body, type, ts: Date.now(), persist }
    set((s) => ({
      // If same id already exists, replace it; otherwise prepend
      toasts: [toast, ...s.toasts.filter((t) => t.id !== toastId)].slice(0, 8)
    }))
    if (!persist && (type === 'info' || type === 'success')) {
      setTimeout(() => get().removeToast(toastId), 6000)
    }
  },

  updateToast: (id, body) => {
    set((s) => ({ toasts: s.toasts.map((t) => t.id === id ? { ...t, body } : t) }))
  },

  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },

  handlePricesUpdated: (alerts) => {
    if (alerts.length > 0) {
      for (const a of alerts) {
        get().addToast('Price Alert', a.message, 'alert')
      }
      const id = get().activeAccountId
      if (id !== null) get().loadInventory(id)
      get().loadRecentAlerts()
    }
  },

  importHistory: async () => {
    if (get().isImportingHistory) return
    set({ isImportingHistory: true })
    const TOAST_ID = 'import-history'
    get().addToast('Importing…', 'Fetching inventory history…', 'info', TOAST_ID, true)

    const unsub = window.sp.on.importProgress((page, total, phase) => {
      const label = phase === 'inventory'
        ? `Inventory history: page ${page}…`
        : `Market history: page ${page}${total > 0 ? ` of ${total}` : '…'}`
      get().updateToast(TOAST_ID, label)
    })

    try {
      const result = await window.sp.market.importHistory()
      get().removeToast(TOAST_ID)
      get().addToast(
        'Import complete',
        `Inventory events: ${result.inventory_updated} items dated. Market: ${result.market_fetched} entries, ${result.market_updated} items updated.`,
        'success'
      )
      const accountId = get().activeAccountId
      if (accountId !== null) await get().loadInventory(accountId)
    } catch (err) {
      get().removeToast(TOAST_ID)
      get().addToast('Import failed', String(err).replace(/^Error:\s*/, ''), 'warning')
    } finally {
      unsub()
      set({ isImportingHistory: false })
    }
  }
}))

export type { Toast }
