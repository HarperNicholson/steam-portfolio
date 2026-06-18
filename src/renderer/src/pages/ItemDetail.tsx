import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import PriceChart from '@/components/charts/PriceChart'
import StickerStrip from '@/components/inventory/StickerStrip'
import { useStore } from '@/store'
import styles from './ItemDetail.module.css'

type PricePoint = { timestamp: number; price_usd: number; volume: number }
type Snapshot = { current_price: number; acquisition_price: number | null; acquisition_date: number | null; acquisition_date_locked: number; all_time_high: number; smart_peak: number | null } | null
type AlertConfig = { gain_multipliers: number[]; ath_drop_threshold: number; enabled: boolean }

function formatPrice(p: number | null | undefined, sym: string): string {
  if (!p) return '—'
  return `${sym}${p.toFixed(2)}`
}

function formatDate(ts: number | null | undefined): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function gainPct(current: number | null, acq: number | null): string {
  if (!current || !acq || acq === 0) return '—'
  const pct = ((current - acq) / acq) * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
}

export default function ItemDetail(): JSX.Element {
  const { marketHashName: encoded } = useParams<{ marketHashName: string }>()
  const marketHashName = decodeURIComponent(encoded ?? '')
  const navigate = useNavigate()
  const { inventory, addToast, currencySymbol, settings, activeAccountId, loadInventory } = useStore()

  const [history, setHistory] = useState<PricePoint[]>([])
  const [snapshot, setSnapshot] = useState<Snapshot>(null)
  const [alertConfig, setAlertConfig] = useState<AlertConfig>({ gain_multipliers: [2, 3, 4], ath_drop_threshold: 0.1, enabled: false })
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [savingAlert, setSavingAlert] = useState(false)
  const [editAcqDate, setEditAcqDate] = useState('')
  const [editAcqPrice, setEditAcqPrice] = useState('')
  const [savingAcq, setSavingAcq] = useState(false)
  const [togglingHide, setTogglingHide] = useState(false)

  const inventoryItem = inventory.find((i) => i.market_hash_name === marketHashName)

  useEffect(() => {
    if (!marketHashName) return
    setLoadingHistory(true)
    Promise.all([
      window.sp.prices.history(marketHashName),
      window.sp.prices.snapshot(marketHashName),
      window.sp.alerts.get(marketHashName)
    ]).then(([h, s, a]) => {
      setHistory(h)
      setSnapshot(s)
      setAlertConfig({ gain_multipliers: a.gain_multipliers, ath_drop_threshold: a.ath_drop_threshold, enabled: a.enabled })
      if (s?.acquisition_date) {
        const d = new Date(s.acquisition_date * 1000)
        setEditAcqDate(d.toISOString().slice(0, 10))
      }
      if (s?.acquisition_price) {
        setEditAcqPrice(s.acquisition_price.toFixed(2))
      }
    }).catch((err) => {
      addToast('Error', String(err), 'warning')
    }).finally(() => setLoadingHistory(false))
  }, [marketHashName])

  async function saveAcquisition(): Promise<void> {
    setSavingAcq(true)
    try {
      const dateTs = editAcqDate ? Math.floor(new Date(editAcqDate).getTime() / 1000) : null
      const price = editAcqPrice ? parseFloat(editAcqPrice) : null
      await window.sp.prices.setAcquisition(marketHashName, dateTs, price)
      const s = await window.sp.prices.snapshot(marketHashName)
      setSnapshot(s)
      addToast('Acquisition saved', 'Manually locked — auto-import will not overwrite.', 'success')
    } catch (err) {
      addToast('Save failed', String(err), 'warning')
    } finally {
      setSavingAcq(false)
    }
  }

  async function resetAcquisition(): Promise<void> {
    setSavingAcq(true)
    try {
      await window.sp.prices.resetAcquisition(marketHashName)
      const s = await window.sp.prices.snapshot(marketHashName)
      setSnapshot(s)
      setEditAcqDate('')
      setEditAcqPrice('')
      addToast('Reset', 'Acquisition data cleared. Next import will fill it in.', 'info')
    } catch (err) {
      addToast('Reset failed', String(err), 'warning')
    } finally {
      setSavingAcq(false)
    }
  }

  async function toggleHidden(): Promise<void> {
    if (!activeAccountId) return
    setTogglingHide(true)
    try {
      const isHidden = !!inventoryItem?.hidden
      if (isHidden) {
        await window.sp.inventory.unhide(activeAccountId, marketHashName)
        addToast('Unhidden', `${marketHashName} is back in your results`, 'success')
      } else {
        await window.sp.inventory.hide(activeAccountId, marketHashName)
        addToast('Hidden', `${marketHashName} removed from results`, 'info')
        navigate(-1)
      }
      await loadInventory(activeAccountId)
    } catch (err) {
      addToast('Error', String(err), 'warning')
    } finally {
      setTogglingHide(false)
    }
  }

  async function saveAlertConfig(): Promise<void> {
    setSavingAlert(true)
    try {
      await window.sp.alerts.set(
        marketHashName,
        alertConfig.gain_multipliers,
        alertConfig.ath_drop_threshold,
        alertConfig.enabled
      )
      addToast('Alerts saved', `Alerts configured for ${marketHashName}`, 'success')
    } catch (err) {
      addToast('Save failed', String(err), 'warning')
    } finally {
      setSavingAlert(false)
    }
  }

  const currentPrice = snapshot?.current_price ?? inventoryItem?.current_price ?? null
  const acqPrice = snapshot?.acquisition_price ?? inventoryItem?.acquisition_price ?? null
  const acqDate = snapshot?.acquisition_date ?? inventoryItem?.acquisition_date ?? null
  const ath = snapshot?.all_time_high ?? inventoryItem?.all_time_high ?? null
  const smartPeak = snapshot?.smart_peak ?? null
  const peakForAlert = (smartPeak ?? 0) > 0 ? smartPeak! : ath
  const peakLabel = (smartPeak ?? 0) > 0 ? 'Smart Peak' : 'ATH'
  const qty = inventoryItem?.quantity ?? 1

  return (
    <div className={styles.page}>
      <button className={`btn btn-ghost ${styles.back}`} onClick={() => navigate(-1)}>
        ← Back
      </button>

      <div className={styles.hero}>
        <div className={styles.imageWrap}>
          {inventoryItem?.icon_url && (
            <img src={inventoryItem.icon_url} alt={marketHashName} className={styles.image} />
          )}
          {inventoryItem?.stickers && (
            <StickerStrip stickersJson={inventoryItem.stickers} large />
          )}
        </div>
        <div className={styles.heroInfo}>
          <div className={styles.nameLine}>
            {inventoryItem?.rarity_color && (
              <span className={styles.rarityDot} style={{ background: inventoryItem.rarity_color }} />
            )}
            <h1 className={styles.name}>{marketHashName}</h1>
          </div>
          {inventoryItem?.exterior && (
            <p className={styles.exterior}>{inventoryItem.exterior}</p>
          )}
          {inventoryItem?.rarity && (
            <p className={styles.rarity} style={{ color: inventoryItem.rarity_color ?? undefined }}>
              {inventoryItem.rarity}
            </p>
          )}
          {qty > 1 && <p className={styles.quantity}>×{qty} in inventory</p>}

          <div className={styles.priceStats}>
            <div className={styles.priceStat}>
              <span className={styles.priceLabel}>Current Price</span>
              <span className={styles.priceValue}>{formatPrice(currentPrice, currencySymbol)}</span>
            </div>
            <div className={styles.priceStat}>
              <span className={styles.priceLabel}>Acquired</span>
              <span className={styles.priceValue}>{formatPrice(acqPrice, currencySymbol)}</span>
              <span className={styles.priceDate}>{formatDate(acqDate)}</span>
            </div>
            <div className={styles.priceStat}>
              <span className={styles.priceLabel}>Gain / Loss</span>
              <span className={`${styles.priceValue} ${currentPrice && acqPrice && currentPrice >= acqPrice ? 'positive' : currentPrice && acqPrice ? 'negative' : ''}`}>
                {gainPct(currentPrice, acqPrice)}
              </span>
            </div>
            <div className={styles.priceStat}>
              <span className={styles.priceLabel}>All-Time High</span>
              <span className={styles.priceValue}>{formatPrice(ath, currencySymbol)}</span>
            </div>
            {(smartPeak ?? 0) > 0 && (
              <div className={styles.priceStat}>
                <span className={styles.priceLabel}>Smart Peak</span>
                <span className={styles.priceValue}>{formatPrice(smartPeak, currencySymbol)}</span>
              </div>
            )}
            {qty > 1 && currentPrice && (
              <div className={styles.priceStat}>
                <span className={styles.priceLabel}>Total Value</span>
                <span className={styles.priceValue}>{formatPrice(currentPrice * qty, currencySymbol)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Price History</h2>
        {loadingHistory ? (
          <div className="skeleton" style={{ height: 240, borderRadius: 4 }} />
        ) : (
          <PriceChart
            data={history}
            acquisitionPrice={acqPrice}
            acquisitionDate={acqDate}
            allTimeHigh={ath}
            currencySymbol={currencySymbol}
          />
        )}
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>
          Acquisition
          {snapshot?.acquisition_date_locked === 1 && (
            <span className={styles.lockBadge} title="Manually locked — auto-import will not overwrite">
              🔒 Manually locked
            </span>
          )}
        </h2>
        <div className={styles.acqPanel}>
          {snapshot?.acquisition_date_locked === 1 && (
            <p className={styles.lockNote}>
              Auto-import is locked for this item and will not overwrite these values.
              <button className={`btn btn-ghost ${styles.resetBtn}`} onClick={resetAcquisition} disabled={savingAcq}>
                Unlock &amp; Reset
              </button>
            </p>
          )}
          <div className={styles.acqRow}>
            <label className={styles.acqLabel}>Date acquired</label>
            <input
              type="date"
              value={editAcqDate}
              onChange={(e) => setEditAcqDate(e.target.value)}
              className={`${styles.acqInput}${snapshot?.acquisition_date_locked === 1 ? ` ${styles.acqInputLocked}` : ''}`}
            />
          </div>
          <div className={styles.acqRow}>
            <label className={styles.acqLabel}>Price paid ({settings['currency'] ?? 'USD'})</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={editAcqPrice}
              onChange={(e) => setEditAcqPrice(e.target.value)}
              placeholder="0.00"
              className={`${styles.acqInput}${snapshot?.acquisition_date_locked === 1 ? ` ${styles.acqInputLocked}` : ''}`}
            />
          </div>
          <button
            className={`btn btn-primary ${styles.saveBtn}`}
            onClick={saveAcquisition}
            disabled={savingAcq}
          >
            {savingAcq ? 'Saving…' : snapshot?.acquisition_date_locked === 1 ? 'Update (stays locked)' : 'Save & Lock'}
          </button>
        </div>
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Price Alerts</h2>
        <div className={styles.alertPanel}>
          <label className={styles.alertToggle}>
            <input
              type="checkbox"
              checked={alertConfig.enabled}
              onChange={(e) => setAlertConfig((c) => ({ ...c, enabled: e.target.checked }))}
            />
            Enable alerts for this item
          </label>

          <div className={styles.alertRow}>
            <span className={styles.alertLabel}>Alert at gain multipliers (×):</span>
            <div className={styles.multiplierGroup}>
              {[2, 3, 4, 5, 10].map((m) => (
                <label key={m} className={styles.multiplierCheck}>
                  <input
                    type="checkbox"
                    checked={alertConfig.gain_multipliers.includes(m)}
                    onChange={(e) => {
                      const set = new Set(alertConfig.gain_multipliers)
                      e.target.checked ? set.add(m) : set.delete(m)
                      setAlertConfig((c) => ({ ...c, gain_multipliers: Array.from(set).sort((a, b) => a - b) }))
                    }}
                  />
                  {m}×
                </label>
              ))}
            </div>
          </div>

          <div className={styles.alertRow}>
            <span className={styles.alertLabel}>Alert on {peakLabel} drop ≥:</span>
            <div className={styles.dropGroup}>
              <input
                type="range"
                min="5"
                max="50"
                step="5"
                value={Math.round(alertConfig.ath_drop_threshold * 100)}
                onChange={(e) => setAlertConfig((c) => ({ ...c, ath_drop_threshold: parseInt(e.target.value) / 100 }))}
                className={styles.dropRange}
              />
              <span className={styles.dropValue}>{Math.round(alertConfig.ath_drop_threshold * 100)}%</span>
            </div>
          </div>

          {acqPrice && (
            <div className={styles.alertPreview}>
              <p className={styles.alertPreviewTitle}>Alert thresholds:</p>
              {alertConfig.gain_multipliers.map((m) => (
                <p key={m} className={styles.alertPreviewRow}>
                  <span className="positive">●</span> {m}× gain → triggers at {formatPrice(acqPrice * m, currencySymbol)}
                </p>
              ))}
              {(peakForAlert ?? 0) > 0 && (
                <p className={styles.alertPreviewRow}>
                  <span className="negative">●</span> {peakLabel} drop → triggers at {formatPrice(peakForAlert! * (1 - alertConfig.ath_drop_threshold), currencySymbol)} ({Math.round(alertConfig.ath_drop_threshold * 100)}% below {peakLabel} of {formatPrice(peakForAlert, currencySymbol)})
                </p>
              )}
            </div>
          )}

          <button
            className={`btn btn-primary ${styles.saveBtn}`}
            onClick={saveAlertConfig}
            disabled={savingAlert}
          >
            {savingAlert ? 'Saving…' : 'Save Alert Config'}
          </button>
        </div>
      </div>
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Visibility</h2>
        <p className={styles.hint}>
          {inventoryItem?.hidden
            ? 'This item is hidden from your inventory and excluded from portfolio totals.'
            : 'Hide this item to exclude it from your inventory view and portfolio totals.'}
        </p>
        <button
          className={`btn ${inventoryItem?.hidden ? 'btn-secondary' : 'btn-danger'}`}
          onClick={toggleHidden}
          disabled={togglingHide}
        >
          {togglingHide ? '…' : inventoryItem?.hidden ? 'Unhide item' : 'Hide from results'}
        </button>
      </div>
    </div>
  )
}
