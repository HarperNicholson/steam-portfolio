import { ReactNode } from 'react'
import Sidebar from './Sidebar'
import styles from './Layout.module.css'

export default function Layout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className={styles.root}>
      <Sidebar />
      <main className={styles.main}>{children}</main>
    </div>
  )
}
