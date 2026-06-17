import { useState } from 'react'
import { useStore } from '@/store'
import styles from './Settings.module.css'

const THEMES = [
  { id: 'steam-dark', label: 'Steam Dark' },
  { id: 'steam-light', label: 'Steam Light' },
  { id: 'oled-black', label: 'OLED Black' }
]

const INTERVALS = [
  { value: '1', label: 'Every hour' },
  { value: '3', label: 'Every 3 hours' },
  { value: '6', label: 'Every 6 hours' },
  { value: '12', label: 'Every 12 hours' },
  { value: '24', label: 'Once a day' }
]

const CURRENCIES = [
  { value: 'USD', label: 'USD — US Dollar ($)' },
  { value: 'CAD', label: 'CAD — Canadian Dollar (CA$)' },
  { value: 'EUR', label: 'EUR — Euro (€)' },
  { value: 'GBP', label: 'GBP — British Pound (£)' },
  { value: 'AUD', label: 'AUD — Australian Dollar (A$)' },
]

export default function Settings(): JSX.Element {
  const { settings, setSetting, accounts, addToast, isImportingHistory, importHistory } = useStore()
  const [sessionCookie, setSessionCookie] = useState(settings['session_cookie'] ?? '')
  const [removing, setRemoving] = useState<number | null>(null)

  async function handleRemoveAccount(id: number): Promise<void> {
    setRemoving(id)
    try {
      await window.sp.accounts.remove(id)
      await useStore.getState().loadAccounts()
      addToast('Account removed', 'Steam account removed from portfolio', 'info')
    } catch (err) {
      addToast('Error', String(err), 'warning')
    } finally {
      setRemoving(null)
    }
  }

  async function saveSessionCookie(): Promise<void> {
    await setSetting('session_cookie', sessionCookie.trim())
    addToast('Saved', 'Steam session cookie updated', 'success')
  }

  async function testNotification(): Promise<void> {
    try {
      await window.sp.notifications.test()
      addToast('Notification sent', 'Check your system notification area (top-right of screen)', 'info')
    } catch (err) {
      addToast('Notification failed', String(err), 'warning')
    }
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Settings</h1>

      <Section title="Appearance">
        <div className={styles.themeGrid}>
          {THEMES.map((t) => (
            <button
              key={t.id}
              className={`${styles.themeBtn} ${settings['theme'] === t.id ? styles.themeBtnActive : ''}`}
              onClick={() => setSetting('theme', t.id)}
            >
              <span className={styles.themeSwatch} data-theme-swatch={t.id} />
              {t.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Currency">
        <div className={styles.row}>
          <label className={styles.label}>Display currency</label>
          <select
            value={settings['currency'] ?? 'USD'}
            onChange={(e) => {
              setSetting('currency', e.target.value)
              addToast('Currency changed', `Prices will now show in ${e.target.value}. Cached prices cleared — refresh to update.`, 'info')
            }}
            className={styles.select}
          >
            {CURRENCIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <p className={styles.hint}>
          Changing currency clears all cached prices. Use "Refresh Prices" on the Dashboard to re-fetch in the new currency.
        </p>
      </Section>

      <Section title="Price Refresh">
        <div className={styles.row}>
          <label className={styles.label}>Auto-refresh interval</label>
          <select
            value={settings['refresh_interval_hours'] ?? '6'}
            onChange={(e) => setSetting('refresh_interval_hours', e.target.value)}
            className={styles.select}
          >
            {INTERVALS.map((i) => (
              <option key={i.value} value={i.value}>{i.label}</option>
            ))}
          </select>
        </div>
        <p className={styles.hint}>
          Prices refresh in the background at this interval. Steam rate-limits requests, so shorter intervals may
          result in incomplete updates for large inventories.
        </p>
      </Section>

      <Section title="Steam Session Cookie (optional)">
        <p className={styles.hint}>
          Only needed for <strong>private inventories</strong> and unlocks full price history charts.
          For public inventories, syncing works without a cookie.
        </p>
        <p className={styles.hint}>
          To get it: log in to <strong>steamcommunity.com</strong> in your browser → F12 →
          Application → Cookies → steamcommunity.com → copy the value of <code>steamLoginSecure</code>.
        </p>
        <div className={styles.cookieRow}>
          <input
            type="password"
            value={sessionCookie}
            onChange={(e) => setSessionCookie(e.target.value)}
            placeholder="Paste the steamLoginSecure cookie value here"
            className={styles.cookieInput}
          />
          <button className="btn btn-primary" onClick={saveSessionCookie}>Save</button>
          {sessionCookie && (
            <button
              className="btn btn-ghost"
              onClick={() => { setSessionCookie(''); setSetting('session_cookie', '') }}
            >
              Clear
            </button>
          )}
        </div>
        <p className={styles.cookieSecurity}>
          ⓘ Stored locally in SQLite. Never transmitted anywhere except Steam's own servers.
        </p>
      </Section>

      <Section title="Acquisition History">
        <p className={styles.hint}>
          Scrapes your Steam inventory history to set accurate acquisition dates for <strong>all</strong> items —
          market purchases, trades, drops, and case openings. Then enriches market-purchased items
          with the price paid.
        </p>
        <p className={styles.hint}>
          This runs in two phases: inventory history first (all games in your portfolio), then
          Steam Market history for prices. Large inventories may take several minutes due to
          Steam rate limits.
        </p>
        <button
          className="btn btn-secondary"
          onClick={importHistory}
          disabled={isImportingHistory || !settings['session_cookie']}
        >
          {isImportingHistory ? 'Importing…' : 'Import Full Acquisition History'}
        </button>
        {!settings['session_cookie'] && (
          <p className={styles.hint} style={{ marginTop: 6 }}>
            Requires a session cookie (set above).
          </p>
        )}
      </Section>

      <Section title="Notifications">
        <div className={styles.row}>
          <label className={styles.label}>
            <input
              type="checkbox"
              checked={settings['notifications_enabled'] === '1'}
              onChange={(e) => setSetting('notifications_enabled', e.target.checked ? '1' : '0')}
            />
            Enable system notifications for price alerts
          </label>
        </div>
        <button className="btn btn-secondary" onClick={testNotification} style={{ marginTop: 8 }}>
          Send test notification
        </button>
      </Section>

      <Section title="Accounts">
        {accounts.length === 0 ? (
          <p className={styles.hint}>No accounts added yet.</p>
        ) : (
          <div className={styles.accountList}>
            {accounts.map((a) => (
              <div key={a.id} className={styles.accountRow}>
                {a.avatar_url && <img src={a.avatar_url} alt="" className={styles.avatar} />}
                <div className={styles.accountInfo}>
                  <p className={styles.accountName}>{a.display_name ?? a.steam_id}</p>
                  <p className={styles.accountId}>{a.steam_id}</p>
                </div>
                <button
                  className="btn btn-danger"
                  onClick={() => handleRemoveAccount(a.id)}
                  disabled={removing === a.id}
                  style={{ fontSize: 12, padding: '5px 10px' }}
                >
                  {removing === a.id ? '…' : 'Remove'}
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="About">
        <p className={styles.hint}>
          SteamPortfolio v0.1.0 · MIT License
        </p>
        <p className={styles.hint}>
          Price data sourced from the Steam Community Market. Not affiliated with Valve.
        </p>
        <div className={styles.supportRow}>
          <button
            className={styles.githubBtn}
            onClick={() => window.sp.shell.openExternal('https://github.com/HarperNicholson/steam-portfolio')}
          >
            View source on GitHub
          </button>
          <button
            className={styles.supportBtn}
            onClick={() => window.sp.shell.openExternal('https://harpernicholson.ca')}
          >
            ♥ Support me
          </button>
        </div>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {children}
    </div>
  )
}
