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
  const [emailTo, setEmailTo] = useState(settings['email_to'] ?? '')
  const [emailHost, setEmailHost] = useState(settings['email_smtp_host'] ?? '')
  const [emailPort, setEmailPort] = useState(settings['email_smtp_port'] ?? '587')
  const [emailUser, setEmailUser] = useState(settings['email_smtp_user'] ?? '')
  const [emailPass, setEmailPass] = useState(settings['email_smtp_pass'] ?? '')

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

  async function saveEmailSettings(): Promise<void> {
    await setSetting('email_to', emailTo.trim())
    await setSetting('email_smtp_host', emailHost.trim())
    await setSetting('email_smtp_port', emailPort.trim())
    await setSetting('email_smtp_user', emailUser.trim())
    await setSetting('email_smtp_pass', emailPass)
    addToast('Saved', 'Email settings updated', 'success')
  }

  async function testEmailNotification(): Promise<void> {
    try {
      await window.sp.email.test()
      addToast('Email sent', `Check ${emailTo} for the test message`, 'info')
    } catch (err) {
      addToast('Email failed', String(err), 'warning')
    }
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

      <Section title="Email Notifications">
        <div className={styles.row}>
          <label className={styles.label}>
            <input
              type="checkbox"
              checked={settings['email_enabled'] === '1'}
              onChange={(e) => setSetting('email_enabled', e.target.checked ? '1' : '0')}
            />
            Send email when an alert fires
          </label>
        </div>
        {settings['email_enabled'] === '1' && (
          <>
            <div className={styles.row}>
              <label className={styles.label} style={{ minWidth: 130 }}>Notify address</label>
              <input
                type="email"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                placeholder="you@example.com"
                className={styles.cookieInput}
              />
            </div>
            <div className={styles.row}>
              <label className={styles.label} style={{ minWidth: 130 }}>SMTP host</label>
              <input
                type="text"
                value={emailHost}
                onChange={(e) => setEmailHost(e.target.value)}
                placeholder="smtp.gmail.com"
                className={styles.cookieInput}
              />
            </div>
            <div className={styles.row}>
              <label className={styles.label} style={{ minWidth: 130 }}>SMTP port</label>
              <input
                type="number"
                value={emailPort}
                onChange={(e) => setEmailPort(e.target.value)}
                className={styles.cookieInput}
                style={{ maxWidth: 90 }}
              />
              <label className={styles.label}>
                <input
                  type="checkbox"
                  checked={settings['email_smtp_secure'] === '1'}
                  onChange={(e) => setSetting('email_smtp_secure', e.target.checked ? '1' : '0')}
                />
                SSL/TLS (port 465)
              </label>
            </div>
            <div className={styles.row}>
              <label className={styles.label} style={{ minWidth: 130 }}>SMTP username</label>
              <input
                type="text"
                value={emailUser}
                onChange={(e) => setEmailUser(e.target.value)}
                placeholder="you@gmail.com"
                className={styles.cookieInput}
              />
            </div>
            <div className={styles.row}>
              <label className={styles.label} style={{ minWidth: 130 }}>SMTP password</label>
              <input
                type="password"
                value={emailPass}
                onChange={(e) => setEmailPass(e.target.value)}
                placeholder="App password or SMTP password"
                className={styles.cookieInput}
              />
            </div>
            <div className={styles.cookieRow}>
              <button className="btn btn-primary" onClick={saveEmailSettings}>Save</button>
              <button className="btn btn-secondary" onClick={testEmailNotification}>Send test email</button>
            </div>
            <p className={styles.hint}>
              For Gmail: create an <strong>App Password</strong> at myaccount.google.com → Security → App Passwords,
              then use <code>smtp.gmail.com</code> port <code>587</code> with your Gmail address and the app password.
            </p>
            <p className={styles.cookieSecurity}>
              ⓘ Credentials stored locally in SQLite. Never transmitted anywhere except your SMTP server.
            </p>
          </>
        )}
      </Section>

      <Section title="Default Alert Settings">
        <p className={styles.hint}>
          These defaults apply to items that haven't had alerts manually configured. Change them and the next price
          refresh will use the updated values for any unconfigured items.
        </p>
        <div className={styles.row}>
          <label className={styles.label}>
            <input
              type="checkbox"
              checked={settings['default_alerts_enabled'] === '1'}
              onChange={(e) => setSetting('default_alerts_enabled', e.target.checked ? '1' : '0')}
            />
            Enable alerts for new items by default
          </label>
        </div>
        <div className={styles.row}>
          <span className={styles.label} style={{ cursor: 'default' }}>Default gain thresholds:</span>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {[2, 3, 4, 5, 10].map((m) => {
              const current = JSON.parse(settings['default_gain_multipliers'] ?? '[2,3,4]') as number[]
              return (
                <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={current.includes(m)}
                    onChange={(e) => {
                      const s = new Set(current)
                      e.target.checked ? s.add(m) : s.delete(m)
                      setSetting('default_gain_multipliers', JSON.stringify(Array.from(s).sort((a, b) => a - b)))
                    }}
                  />
                  {m}×
                </label>
              )
            })}
          </div>
        </div>
        <div className={styles.row}>
          <label className={styles.label} style={{ cursor: 'default', minWidth: 200 }}>
            Default ATH drop threshold: {Math.round(parseFloat(settings['default_ath_drop_threshold'] ?? '0.1') * 100)}%
          </label>
          <input
            type="range"
            min="5"
            max="50"
            step="5"
            value={Math.round(parseFloat(settings['default_ath_drop_threshold'] ?? '0.1') * 100)}
            onChange={(e) => setSetting('default_ath_drop_threshold', String(parseInt(e.target.value) / 100))}
            style={{ width: 120 }}
          />
        </div>
      </Section>

      <Section title="Smart Range">
        <p className={styles.hint}>
          New items often spike in price due to scarcity when first released. Smart Range skips the first{' '}
          <strong>N days</strong> of price history when computing the peak price, giving a more realistic
          baseline for drop alerts. Set to 0 to disable (uses standard All-Time High).
        </p>
        <div className={styles.row}>
          <label className={styles.label}>Skip initial days</label>
          <input
            type="number"
            min="0"
            max="365"
            step="1"
            value={settings['smart_range_days'] ?? '0'}
            onChange={(e) => setSetting('smart_range_days', e.target.value)}
            className={styles.select}
            style={{ minWidth: 72, width: 72 }}
          />
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {parseInt(settings['smart_range_days'] ?? '0') > 0
              ? `Drop alerts use Smart Peak (skips first ${settings['smart_range_days']} days)`
              : 'Disabled — using standard ATH'}
          </span>
        </div>
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
          SteamPortfolio v0.1.41 · MIT License
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
