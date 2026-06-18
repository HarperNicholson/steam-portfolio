import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useStore } from '@/store'
import { GAMES } from '../../../shared/games'
import styles from './Sidebar.module.css'
import appIcon from '../assets/icon.png'

const NAV = [
  { to: '/', label: 'Dashboard', icon: '◈' },
  { to: '/inventory', label: 'Inventory', icon: '⊞' },
  { to: '/settings', label: 'Settings', icon: '⚙' }
]

export default function Sidebar(): JSX.Element {
  const { accounts, activeAccountId, setActiveAccount, syncInventory, isSyncing, addToast, selectedAppId } = useStore()
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [input, setInput] = useState('')
  const [adding, setAdding] = useState(false)

  const syncGameName = GAMES[selectedAppId]?.short ?? `App ${selectedAppId}`

  async function handleAddAccount(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!input.trim()) return
    setAdding(true)
    try {
      const account = await window.sp.accounts.add(input.trim())
      await useStore.getState().loadAccounts()
      await useStore.getState().syncInventory(account.id)
      setInput('')
      setShowAddAccount(false)
    } catch (err) {
      addToast('Failed to add account', String(err), 'warning')
    } finally {
      setAdding(false)
    }
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <img src={appIcon} className={styles.logo} alt="" />
        <span className={styles.brandName}>SteamPortfolio</span>
      </div>

      <div className={styles.accountSection}>
        {accounts.length > 0 ? (
          <div className={styles.accountList}>
            {accounts.map((a) => (
              <button
                key={a.id}
                className={`${styles.accountItem} ${a.id === activeAccountId ? styles.accountActive : ''}`}
                onClick={() => setActiveAccount(a.id)}
              >
                {a.avatar_url && (
                  <img src={a.avatar_url} alt="" className={styles.avatar} />
                )}
                <span className={styles.accountName} title={a.steam_id}>
                  {a.display_name ?? a.steam_id}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className={styles.noAccounts}>No accounts yet</p>
        )}

        {showAddAccount ? (
          <form onSubmit={handleAddAccount} className={styles.addForm}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Steam ID or profile URL"
              autoFocus
              className={styles.addInput}
            />
            <div className={styles.addFormButtons}>
              <button type="submit" className="btn btn-primary" disabled={adding}>
                {adding ? '…' : 'Add'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setShowAddAccount(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button className={styles.addAccountBtn} onClick={() => setShowAddAccount(true)}>
            + Add Account
          </button>
        )}
      </div>

      <nav className={styles.nav}>
        {NAV.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navActive : ''}`}
          >
            <span className={styles.navIcon}>{icon}</span>
            {label}
          </NavLink>
        ))}
      </nav>

      <div className={styles.footer}>
        {activeAccountId !== null && (
          <button
            className={`btn btn-secondary ${styles.syncBtn}`}
            onClick={() => syncInventory(activeAccountId, selectedAppId)}
            disabled={isSyncing}
          >
            {isSyncing ? `⟳ Syncing…` : `⟳ Sync ${syncGameName}`}
          </button>
        )}
      </div>
    </aside>
  )
}
