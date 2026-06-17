import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '@/store'
import styles from './StickerStrip.module.css'

type PriceState = { status: 'idle' | 'loading' | 'done'; price: number | null }
type TooltipPos = { x: number; y: number } | null

function StickerIcon({ sticker, large }: { sticker: StickerInfo; large?: boolean }): JSX.Element {
  const { currencySymbol } = useStore()
  const [priceState, setPriceState] = useState<PriceState>({ status: 'idle', price: null })
  const [tooltipPos, setTooltipPos] = useState<TooltipPos>(null)
  const iconRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function onMouseEnter(): void {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect()
      setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top })
    }
    if (priceState.status === 'idle') {
      setPriceState({ status: 'loading', price: null })
      window.sp.prices.current(`Sticker | ${sticker.name}`)
        .then((r) => setPriceState({ status: 'done', price: r.lowest_price }))
        .catch(() => setPriceState({ status: 'done', price: null }))
    }
  }

  function onMouseLeave(): void {
    timerRef.current = setTimeout(() => setTooltipPos(null), 150)
  }

  const priceText = priceState.status === 'loading'
    ? '…'
    : priceState.price !== null
      ? `${currencySymbol}${priceState.price.toFixed(2)}`
      : null

  return (
    <div
      ref={iconRef}
      className={large ? styles.iconLarge : styles.icon}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={(e) => e.stopPropagation()}
    >
      {sticker.icon_url
        ? <img src={sticker.icon_url} alt={sticker.name} className={large ? styles.imgLarge : styles.img} />
        : <span className={styles.placeholder}>S</span>
      }
      {tooltipPos && createPortal(
        <div
          className={styles.tooltip}
          style={{ left: tooltipPos.x, bottom: window.innerHeight - tooltipPos.y + 6 }}
        >
          <p className={styles.tooltipName}>{sticker.name}</p>
          {priceText && <p className={styles.tooltipPrice}>{priceText}</p>}
        </div>,
        document.body
      )}
    </div>
  )
}

export default function StickerStrip({ stickersJson, large }: { stickersJson: string; large?: boolean }): JSX.Element | null {
  if (!stickersJson) return null
  let stickers: StickerInfo[] = []
  try { stickers = JSON.parse(stickersJson) } catch { return null }
  if (stickers.length === 0) return null

  return (
    <div className={large ? styles.stripLarge : styles.strip}>
      {stickers.slice(0, 5).map((s, i) => (
        <StickerIcon key={i} sticker={s} large={large} />
      ))}
    </div>
  )
}
