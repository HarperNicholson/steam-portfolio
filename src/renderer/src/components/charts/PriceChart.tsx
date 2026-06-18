import { useMemo, useState } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine
} from 'recharts'
import styles from './PriceChart.module.css'

type PricePoint = { timestamp: number; price_usd: number; volume: number }

type Props = {
  data: PricePoint[]
  acquisitionPrice: number | null
  acquisitionDate: number | null
  allTimeHigh: number | null
  currencySymbol?: string
}

const RANGES = [
  { label: '1W', days: 7 },
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '1Y', days: 365 },
  { label: 'All', days: 0 },
]

function formatDate(ts: number, rangeLabel: string): string {
  const opts: Intl.DateTimeFormatOptions =
    rangeLabel === '1W' || rangeLabel === '1M' || rangeLabel === '3M'
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', year: '2-digit' }
  return new Date(ts * 1000).toLocaleDateString(undefined, opts)
}

export default function PriceChart({ data, acquisitionPrice, acquisitionDate, allTimeHigh, currencySymbol = '$' }: Props): JSX.Element {
  const [range, setRange] = useState('All')
  const formatPrice = (v: number): string => `${currencySymbol}${v.toFixed(2)}`

  const filtered = useMemo(() => {
    const r = RANGES.find((r) => r.label === range)!
    if (r.days === 0 || data.length === 0) return data
    const cutoff = Math.floor(Date.now() / 1000) - r.days * 86400
    const sliced = data.filter((p) => p.timestamp >= cutoff)
    return sliced.length > 0 ? sliced : data
  }, [data, range])

  const chartData = useMemo(() => {
    if (filtered.length === 0) return []
    const step = Math.max(1, Math.floor(filtered.length / 300))
    return filtered
      .filter((_, i) => i % step === 0 || i === filtered.length - 1)
      .map((p) => ({ ts: p.timestamp, price: p.price_usd, date: formatDate(p.timestamp, range) }))
  }, [filtered, range])

  const minPrice = useMemo(() => Math.min(...chartData.map((d) => d.price)) * 0.95, [chartData])
  const maxPrice = useMemo(() => Math.max(...chartData.map((d) => d.price)) * 1.05, [chartData])

  const acquisitionInView = useMemo(() => {
    if (!acquisitionDate || filtered.length === 0) return true
    return acquisitionDate >= filtered[0].timestamp
  }, [acquisitionDate, filtered])

  if (data.length === 0) {
    return (
      <div className={styles.empty}>
        <p>No price history available.</p>
        <p className="muted">Price history requires a Steam session cookie or will accumulate over time.</p>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.rangeBar}>
        {RANGES.map((r) => (
          <button
            key={r.label}
            className={`${styles.rangeBtn} ${range === r.label ? styles.rangeBtnActive : ''}`}
            onClick={() => setRange(r.label)}
          >
            {r.label}
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="var(--accent)" stopOpacity={0.25} />
              <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            minTickGap={60}
          />
          <YAxis
            domain={[minPrice, maxPrice]}
            tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatPrice}
            width={60}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              color: 'var(--text-primary)',
              fontSize: '12px'
            }}
            formatter={(v: number) => [formatPrice(v), 'Price']}
            labelStyle={{ color: 'var(--text-secondary)', marginBottom: 4 }}
          />
          {acquisitionPrice && acquisitionInView && (
            <ReferenceLine
              y={acquisitionPrice}
              stroke="var(--yellow)"
              strokeDasharray="4 3"
              strokeWidth={1.5}
              label={{ value: 'Acquired', fill: 'var(--yellow)', fontSize: 10, position: 'insideTopLeft' }}
            />
          )}
          {allTimeHigh && allTimeHigh > 0 && (
            <ReferenceLine
              y={allTimeHigh}
              stroke="var(--green)"
              strokeDasharray="4 3"
              strokeWidth={1.5}
              label={{ value: 'ATH', fill: 'var(--green)', fontSize: 10, position: 'insideTopRight' }}
            />
          )}
          <Area
            type="monotone"
            dataKey="price"
            stroke="var(--accent)"
            strokeWidth={2}
            fill="url(#priceGrad)"
            dot={false}
            activeDot={{ r: 4, fill: 'var(--accent)' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
