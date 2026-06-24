import nodemailer from 'nodemailer'
import log from 'electron-log'
import { getDb } from './db'

type EmailConfig = {
  to: string
  host: string
  port: number
  user: string
  pass: string
  secure: boolean
}

function getEmailConfig(): EmailConfig | null {
  const db = getDb()
  const rows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'email_%'").all() as { key: string; value: string }[]
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]))

  if (s['email_enabled'] !== '1') return null
  if (!s['email_to'] || !s['email_smtp_host']) return null

  return {
    to: s['email_to'],
    host: s['email_smtp_host'],
    port: parseInt(s['email_smtp_port'] ?? '587', 10),
    user: s['email_smtp_user'] ?? '',
    pass: s['email_smtp_pass'] ?? '',
    secure: s['email_smtp_secure'] === '1'
  }
}

function createTransport(config: EmailConfig): nodemailer.Transporter {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.pass } : undefined
  })
}

export async function sendEmailNotification(subject: string, body: string): Promise<void> {
  const config = getEmailConfig()
  if (!config) return

  try {
    const transporter = createTransport(config)
    await transporter.sendMail({
      from: `SteamPortfolio <${config.user || 'noreply@steamportfolio.local'}>`,
      to: config.to,
      subject,
      text: body
    })
    log.info(`Email sent: ${subject}`)
  } catch (err) {
    log.warn('Email notification failed:', err)
  }
}

export async function testEmail(): Promise<void> {
  const config = getEmailConfig()
  if (!config) throw new Error('Email notifications are not configured or not enabled.')

  const transporter = createTransport(config)
  await transporter.sendMail({
    from: `SteamPortfolio <${config.user || 'noreply@steamportfolio.local'}>`,
    to: config.to,
    subject: 'SteamPortfolio: Test Email',
    text: 'Email notifications from SteamPortfolio are working!'
  })
}
