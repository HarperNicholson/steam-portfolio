import { useStore } from '@/store'
import styles from './ToastContainer.module.css'

const TYPE_ICON: Record<string, string> = {
  info: 'ℹ',
  success: '✓',
  warning: '⚠',
  alert: '◉'
}

export function ToastContainer(): JSX.Element {
  const { toasts, removeToast } = useStore()

  return (
    <div className={styles.container}>
      {toasts.map((toast) => (
        <div key={toast.id} className={`${styles.toast} ${styles[toast.type]}`}>
          <span className={styles.icon}>{TYPE_ICON[toast.type]}</span>
          <div className={styles.content}>
            <p className={styles.title}>{toast.title}</p>
            <p className={styles.body}>{toast.body}</p>
          </div>
          <div className={styles.actions}>
            <button
              className={styles.actionBtn}
              title="Copy"
              onClick={() => navigator.clipboard.writeText(`${toast.title}\n${toast.body}`)}
            >
              ⎘
            </button>
            <button
              className={styles.actionBtn}
              title="Dismiss"
              onClick={() => removeToast(toast.id)}
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
