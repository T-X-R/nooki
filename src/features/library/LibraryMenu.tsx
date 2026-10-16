import { useId, useRef, type ReactNode } from 'react'

export function LibraryMenu({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const focusItem = (index: number) => menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')[index]?.focus()
  const position = () => {
    const rect = trigger.current!.getBoundingClientRect()
    Object.assign(menu.current!.style, { left: `${Math.max(8, Math.min(rect.left, window.innerWidth - 224))}px`, top: `${Math.min(rect.bottom + 6, window.innerHeight - 245)}px` })
  }
  return <span className="library-menu-anchor">
    <button ref={trigger} type="button" className="icon-button" aria-label={label} title={label} aria-haspopup="menu" popoverTarget={id} onClick={position} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); position(); menu.current!.showPopover(); focusItem(0) } }}>{icon}</button>
    <div ref={menu} id={id} className="library-action-menu" role="menu" aria-label={label} popover="auto" onToggle={event => { if (event.newState === 'open') focusItem(0) }} onClick={event => { if ((event.target as HTMLElement).closest('button')) { menu.current!.hidePopover(); trigger.current?.focus() } }} onKeyDown={event => {
      const buttons = [...menu.current!.querySelectorAll('button:not(:disabled)')]
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); focusItem(event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length) }
      if (event.key === 'Escape' || event.key === 'Tab') { menu.current!.hidePopover(); trigger.current?.focus(); if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation() } }
    }}>{children}</div>
  </span>
}
