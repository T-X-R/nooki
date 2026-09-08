import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { CapabilityEnvironment } from '../../capability-contract/src'
import './style.css'

export function CapabilityPage({ environment, className = '', children }: { environment: CapabilityEnvironment; className?: string; children: ReactNode }) {
  return <main className={`wb-cap-page ${className}`} lang={environment.locale} data-theme={environment.theme}>{children}</main>
}
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return <header className="wb-cap-header"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions}</header>
}
export function Panel({ children }: { children: ReactNode }) {
  return <section className="wb-cap-panel">{children}</section>
}
export function Button({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={`wb-cap-button ${className}`} {...props} />
}
export function StateMessage({ error = false, children }: { error?: boolean; children: ReactNode }) {
  return <p className="wb-cap-state" role={error ? 'alert' : 'status'}>{children}</p>
}
