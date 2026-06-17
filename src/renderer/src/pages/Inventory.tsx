import { useState, useMemo } from 'react'
import { useStore } from '@/store'
import { GAMES } from '../../../shared/games'
import ItemTile from '@/components/inventory/ItemTile'
import styles from './Inventory.module.css'

type SortKey = 'value' | 'gain_pct' | 'name' | 'quantity'
type TypeFilter = 'all' | 'weapon' | 'case' | 'sticker' | 'knife' | 'other'

const TYPE_FILTER_LABELS: Record<TypeFilter, string> = {
  all: 'All',
  weapon: 'Weapons',
  knife: 'Knives',
  case: 'Cases & Capsules',
  sticker: 'Stickers',
  other: 'Other'
}

function categorize(type: string | null): TypeFilter {
  const t = (type ?? '').toLowerCase()
  if (t.includes('container') || t.includes('capsule') || t.includes('package')) return 'case'
  if (t.includes('sticker')) return 'sticker'
  if (t.includes('knife')) return 'knife'
  if (t.includes('glove') || t.includes('graffiti') || t.includes('patch') ||
      t.includes('music kit') || t.includes('agent') || t.includes('pin') || t.includes('charm')) return 'other'
  if (t.includes('rifle') || t.includes('pistol') || t.includes('smg') ||
      t.includes('shotgun') || t.includes('machine gun') || t.includes('grade')) return 'weapon'
  return 'other'
}

const ADD_SENTINEL = '__add__'

export default function Inventory(): JSX.Element {
  const { inventory, isLoadingInventory, activeAccountId, selectedAppId, setSelectedAppId, syncInventory, isSyncing } = useStore()
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('value')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [showAddGame, setShowAddGame] = useState(false)
  const [customAppId, setCustomAppId] = useState('')
  const [showNonMarketable, setShowNonMarketable] = useState(false)
  const [showHidden, setShowHidden] = useState(false)

  // All game_appids present in the inventory
  const presentGames = useMemo(() => {
    const ids = new Set(inventory.map((i) => i.game_appid))
    return [...ids].sort((a, b) => a - b)
  }, [inventory])

  function gameName(appId: number): string {
    return GAMES[appId]?.name ?? `App ${appId}`
  }

  function handleGameChange(e: React.ChangeEvent<HTMLSelectElement>): void {
    const val = e.target.value
    if (val === ADD_SENTINEL) {
      e.target.value = String(selectedAppId) // reset select visually
      setShowAddGame(true)
    } else {
      setSelectedAppId(Number(val))
      setShowAddGame(false)
    }
  }

  function handleAddGame(appId: number): void {
    if (!activeAccountId) return
    setSelectedAppId(appId)
    setShowAddGame(false)
    setCustomAppId('')
    syncInventory(activeAccountId, appId)
  }

  const hiddenCount = useMemo(() => inventory.filter(i => i.hidden).length, [inventory])
  const nonMarketableCount = useMemo(() => inventory.filter(i => !i.hidden && !i.marketable).length, [inventory])

  const filtered = useMemo(() => {
    let items = inventory

    if (!showHidden) items = items.filter((i) => !i.hidden)
    if (!showNonMarketable) items = items.filter((i) => i.marketable !== 0)

    // Filter by selected game (unless it's not in presentGames, show all)
    if (presentGames.includes(selectedAppId)) {
      items = items.filter((i) => i.game_appid === selectedAppId)
    }

    if (typeFilter !== 'all') {
      items = items.filter((i) => categorize(i.type) === typeFilter)
    }

    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter((i) => i.name.toLowerCase().includes(q))
    }

    return [...items].sort((a, b) => {
      switch (sort) {
        case 'value':
          return ((b.current_price ?? 0) * b.quantity) - ((a.current_price ?? 0) * a.quantity)
        case 'gain_pct': {
          const ga = a.acquisition_price ? ((a.current_price ?? 0) - a.acquisition_price) / a.acquisition_price : -Infinity
          const gb = b.acquisition_price ? ((b.current_price ?? 0) - b.acquisition_price) / b.acquisition_price : -Infinity
          return gb - ga
        }
        case 'name':
          return a.name.localeCompare(b.name)
        case 'quantity':
          return b.quantity - a.quantity
        default:
          return 0
      }
    })
  }, [inventory, selectedAppId, presentGames, typeFilter, search, sort])

  if (!activeAccountId) {
    return (
      <div className={styles.empty}>
        <p>Add a Steam account to view inventory.</p>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        {/* Game/inventory selector */}
        <div className={styles.gameRow}>
          <select
            className={styles.gameSelect}
            value={String(selectedAppId)}
            onChange={handleGameChange}
          >
            {presentGames.length === 0 && (
              <option value={String(selectedAppId)}>{gameName(selectedAppId)}</option>
            )}
            {presentGames.map((appId) => (
              <option key={appId} value={String(appId)}>
                {gameName(appId)}
              </option>
            ))}
            <option disabled>──────────</option>
            <option value={ADD_SENTINEL}>+ Sync another game…</option>
          </select>
        </div>

        {/* Add-game inline panel */}
        {showAddGame && (
          <div className={styles.addGamePanel}>
            <span className={styles.addGameLabel}>Sync game:</span>
            {Object.entries(GAMES).map(([appId, game]) => (
              <button
                key={appId}
                className={`btn btn-secondary ${styles.addGameBtn}`}
                onClick={() => handleAddGame(Number(appId))}
                disabled={isSyncing}
              >
                {game.short}
              </button>
            ))}
            <input
              className={styles.addGameInput}
              placeholder="App ID…"
              value={customAppId}
              onChange={(e) => setCustomAppId(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customAppId) handleAddGame(Number(customAppId))
              }}
            />
            {customAppId && (
              <button
                className="btn btn-primary"
                onClick={() => handleAddGame(Number(customAppId))}
                disabled={isSyncing}
              >
                Sync
              </button>
            )}
            <button className="btn btn-ghost" onClick={() => setShowAddGame(false)}>Cancel</button>
          </div>
        )}

        <input
          className={styles.search}
          placeholder="Search items…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className={styles.filters}>
          {(Object.keys(TYPE_FILTER_LABELS) as TypeFilter[]).map((f) => (
            <button
              key={f}
              className={`${styles.filterBtn} ${typeFilter === f ? styles.filterActive : ''}`}
              onClick={() => setTypeFilter(f)}
            >
              {TYPE_FILTER_LABELS[f]}
            </button>
          ))}
        </div>

        <div className={styles.visibilityRow}>
          {nonMarketableCount > 0 && (
            <button
              className={`${styles.filterBtn} ${showNonMarketable ? styles.filterActive : ''}`}
              onClick={() => setShowNonMarketable((v) => !v)}
            >
              {showNonMarketable ? 'Hiding' : 'Show'} non-marketable ({nonMarketableCount})
            </button>
          )}
          {hiddenCount > 0 && (
            <button
              className={`${styles.filterBtn} ${showHidden ? styles.filterActive : ''}`}
              onClick={() => setShowHidden((v) => !v)}
            >
              {showHidden ? 'Hiding' : 'Show'} hidden ({hiddenCount})
            </button>
          )}
        </div>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className={styles.sortSelect}
        >
          <option value="value">Sort: Value</option>
          <option value="gain_pct">Sort: Gain %</option>
          <option value="name">Sort: Name</option>
          <option value="quantity">Sort: Quantity</option>
        </select>
      </div>

      <p className={styles.count}>
        {filtered.length} {filtered.length === 1 ? 'item' : 'items'}
        {search && ` matching "${search}"`}
      </p>

      {isLoadingInventory ? (
        <div className={styles.grid}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className={`skeleton ${styles.skelTile}`} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>
          <p>
            {search
              ? `No items matching "${search}"`
              : presentGames.includes(selectedAppId)
                ? 'No items found'
                : `No ${gameName(selectedAppId)} inventory synced yet. Click "Sync ${GAMES[selectedAppId]?.short ?? selectedAppId}" in the sidebar.`}
          </p>
        </div>
      ) : (
        <div className={styles.grid}>
          {filtered.map((item) => (
            <ItemTile key={item.asset_id ?? item.market_hash_name} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}
