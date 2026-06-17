import { useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useStore } from './store'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Inventory from './pages/Inventory'
import ItemDetail from './pages/ItemDetail'
import Settings from './pages/Settings'
import { ToastContainer } from './components/alerts/ToastContainer'

export default function App(): JSX.Element {
  const { loadAccounts, loadSettings, loadRecentAlerts, handlePricesUpdated } = useStore()

  useEffect(() => {
    loadSettings()
    loadAccounts()
    loadRecentAlerts()

    const unsub = window.sp.on.pricesUpdated(handlePricesUpdated)
    return unsub
  }, [])

  return (
    <HashRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/item/:marketHashName" element={<ItemDetail />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
      <ToastContainer />
    </HashRouter>
  )
}
