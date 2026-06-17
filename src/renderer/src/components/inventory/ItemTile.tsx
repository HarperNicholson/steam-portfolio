import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import StickerStrip from './StickerStrip'
import styles from './ItemTile.module.css'

const EXTERIOR_ABBREV: Record<string, string> = {
  'Factory New': 'FN',
  'Minimal Wear': 'MW',
  'Field-Tested': 'FT',
  'Well-Worn': 'WW',
  'Battle-Scarred': 'BS'
}

function formatPrice(p: number | null, sym: string): string {
  if (p === null) return '—'
  return `${sym}${p.toFixed(2)}`
}

function gainClass(current: number | null, acq: number | null): string {
  if (!current || !acq) return ''
  return current >= acq ? styles.positive : styles.negative
}

function gainPct(current: number | null, acq: number | null): string {
  if (!current || !acq || acq === 0) return ''
  const pct = ((current - acq) / acq) * 100
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

export default function ItemTile({ item }: { item: InventoryRow }): JSX.Element {
  const navigate = useNavigate()
  const { currencySymbol } = useStore()
  const abbrev = item.exterior ? (EXTERIOR_ABBREV[item.exterior] ?? item.exterior) : null

  return (
    <div
      className={styles.tile}
      style={{ '--rarity-color': item.rarity_color ?? 'var(--text-muted)' } as React.CSSProperties}
      onClick={() => navigate(`/item/${encodeURIComponent(item.market_hash_name)}`)}
    >
      <div className={styles.imageWrap}>
        <img
          src={item.icon_url}
          alt={item.name}
          className={styles.image}
          loading="lazy"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0.3' }}
        />
        {item.quantity > 1 && (
          <span className={styles.quantity}>×{item.quantity}</span>
        )}
        {item.tradable === 0 && (
          <span className={styles.tradeLock} title="Trade cooldown active">🔒</span>
        )}
        {abbrev && <span className={styles.exterior}>{abbrev}</span>}
        <StickerStrip stickersJson={item.stickers} />
      </div>

      <div className={styles.info}>
        <p className={styles.name} title={item.name}>{item.name}</p>
        {item.rarity && (
          <p className={styles.rarity} style={{ color: item.rarity_color ?? undefined }}>
            {item.rarity}
          </p>
        )}
        <div className={styles.priceRow}>
          <span className={styles.price}>{formatPrice(item.current_price, currencySymbol)}</span>
          {item.acquisition_price && item.current_price && (
            <span className={`${styles.gain} ${gainClass(item.current_price, item.acquisition_price)}`}>
              {gainPct(item.current_price, item.acquisition_price)}
            </span>
          )}
        </div>
        {item.quantity > 1 && item.current_price && (
          <p className={styles.totalValue}>
            Total: {formatPrice(item.current_price * item.quantity, currencySymbol)}
          </p>
        )}
      </div>
    </div>
  )
}
