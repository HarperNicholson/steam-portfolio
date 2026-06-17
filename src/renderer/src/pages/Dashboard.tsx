import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import styles from './Dashboard.module.css'

function formatPrice(p: number | null, sym: string): string {
  if (p === null || p === 0) return '—'
  return `${sym}${p.toFixed(2)}`
}

function gainPct(current: number | null, acq: number | null): number | null {
  if (!current || !acq || acq === 0) return null
  return ((current - acq) / acq) * 100
}

export default function Dashboard(): JSX.Element {
  const { inventory, recentAlerts, accounts, activeAccountId, isSyncing, currencySymbol } = useStore()
  const navigate = useNavigate()

  const activeAccount = accounts.find((a) => a.id === activeAccountId)

  const stats = useMemo(() => {
    let totalValue = 0
    let totalCost = 0
    let itemsWithPrice = 0

    for (const item of inventory) {
      const qty = item.quantity
      if (item.current_price) {
        totalValue += item.current_price * qty
        itemsWithPrice++
      }
      if (item.acquisition_price) {
        totalCost += item.acquisition_price * qty
      }
    }

    const totalGain = totalCost > 0 ? totalValue - totalCost : null
    const totalGainPct = totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : null

    return { totalValue, totalCost, totalGain, totalGainPct, itemsWithPrice, itemCount: inventory.length }
  }, [inventory])

  const topGainers = useMemo(() => {
    return [...inventory]
      .filter((i) => i.current_price && i.acquisition_price)
      .sort((a, b) => {
        const pa = gainPct(a.current_price, a.acquisition_price) ?? 0
        const pb = gainPct(b.current_price, b.acquisition_price) ?? 0
        return pb - pa
      })
      .slice(0, 5)
  }, [inventory])

  const topByValue = useMemo(() => {
    return [...inventory]
      .filter((i) => i.current_price)
      .sort((a, b) => (b.current_price ?? 0) * b.quantity - (a.current_price ?? 0) * a.quantity)
      .slice(0, 5)
  }, [inventory])

  if (!activeAccountId) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyIcon}>♦</p>
        <h2>Add a Steam Account to get started</h2>
        <p className="muted">Use the sidebar to add your Steam ID or profile URL.</p>
      </div>
    )
  }

  if (inventory.length === 0 && !isSyncing) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyIcon}>⊞</p>
        <h2>No inventory data yet</h2>
        <p className="muted">Click "Sync Inventory" in the sidebar to fetch your CS2 items.</p>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>
            {activeAccount?.display_name ?? activeAccount?.steam_id ?? 'Portfolio'}
          </h1>
          <p className={styles.subtitle}>{stats.itemCount} unique items · {stats.itemsWithPrice} priced</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => window.sp.prices.refreshAll().catch(console.error)}
        >
          ↻ Refresh Prices
        </button>
      </div>

      <div className={styles.statsGrid}>
        <StatCard label="Total Portfolio Value" value={`${currencySymbol}${stats.totalValue.toFixed(2)}`} />
        <StatCard label="Acquisition Cost" value={`${currencySymbol}${stats.totalCost.toFixed(2)}`} />
        {stats.totalGain !== null && (
          <StatCard
            label="Unrealised Gain / Loss"
            value={`${stats.totalGain >= 0 ? '+' : ''}${currencySymbol}${stats.totalGain.toFixed(2)}`}
            sub={`${stats.totalGainPct?.toFixed(1) ?? '?'}%`}
            positive={stats.totalGain >= 0}
          />
        )}
        <StatCard label="Items Tracked" value={String(stats.itemCount)} />
      </div>

      <div className={styles.columns}>
        <div className={styles.column}>
          <h2 className={styles.sectionTitle}>Top Gainers</h2>
          <div className={styles.list}>
            {topGainers.length === 0 ? (
              <p className="muted" style={{ padding: '12px 0' }}>No price data yet</p>
            ) : topGainers.map((item) => {
              const pct = gainPct(item.current_price, item.acquisition_price)
              return (
                <div
                  key={item.market_hash_name}
                  className={styles.listRow}
                  onClick={() => navigate(`/item/${encodeURIComponent(item.market_hash_name)}`)}
                >
                  <img src={item.icon_url} alt="" className={styles.listImg} />
                  <div className={styles.listInfo}>
                    <p className={styles.listName}>{item.name}</p>
                    <p className={styles.listSub}>{formatPrice(item.acquisition_price, currencySymbol)} → {formatPrice(item.current_price, currencySymbol)}</p>
                  </div>
                  {pct !== null && (
                    <span className={`${styles.listGain} ${pct >= 0 ? 'positive' : 'negative'}`}>
                      {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div className={styles.column}>
          <h2 className={styles.sectionTitle}>Top by Value</h2>
          <div className={styles.list}>
            {topByValue.map((item) => (
              <div
                key={item.market_hash_name}
                className={styles.listRow}
                onClick={() => navigate(`/item/${encodeURIComponent(item.market_hash_name)}`)}
              >
                <img src={item.icon_url} alt="" className={styles.listImg} />
                <div className={styles.listInfo}>
                  <p className={styles.listName}>{item.name}</p>
                  <p className={styles.listSub}>
                    {item.quantity > 1 ? `×${item.quantity} · ` : ''}
                    {formatPrice(item.current_price, currencySymbol)} each
                  </p>
                </div>
                <span className={styles.listValue}>
                  {formatPrice((item.current_price ?? 0) * item.quantity, currencySymbol)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {recentAlerts.length > 0 && (
          <div className={styles.column}>
            <h2 className={styles.sectionTitle}>Recent Alerts</h2>
            <div className={styles.list}>
              {recentAlerts.slice(0, 8).map((a, i) => (
                <div key={i} className={styles.listRow}>
                  <span className={styles.alertIcon}>◉</span>
                  <div className={styles.listInfo}>
                    <p className={styles.listName}>{a.market_hash_name}</p>
                    <p className={styles.listSub}>{a.alert_type} · {new Date(a.triggered_at * 1000).toLocaleDateString()}</p>
                  </div>
                  <span className={styles.listValue}>{formatPrice(a.price_at_trigger, currencySymbol)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, positive }: {
  label: string; value: string; sub?: string; positive?: boolean
}): JSX.Element {
  return (
    <div className={styles.statCard}>
      <p className={styles.statLabel}>{label}</p>
      <p className={`${styles.statValue} ${positive === true ? 'positive' : positive === false ? 'negative' : ''}`}>
        {value}
        {sub && <span className={styles.statSub}> {sub}</span>}
      </p>
    </div>
  )
}
