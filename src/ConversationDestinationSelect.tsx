import { useEffect, useId, useRef, useState } from 'react'
import { CheckIcon, ChevronDownIcon } from '@radix-ui/react-icons'

type Option = { id: string; name: string }

export function ConversationDestinationSelect({ label, value, options, disabled, autoFocus, onChange }: {
  label: string; value: string; options: Option[]; disabled: boolean; autoFocus?: boolean; onChange(value: string): void
}) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const search = useRef({ text: '', time: 0 })
  const selected = Math.max(0, options.findIndex((option) => option.id === value))
  const focus = (index: number) => menu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')[index]?.focus()
  const close = (restoreFocus = false) => { menu.current?.hidePopover(); if (restoreFocus) trigger.current?.focus() }
  const position = () => {
    search.current = { text: '', time: 0 }
    const rect = trigger.current!.getBoundingClientRect()
    const element = menu.current!
    const below = window.innerHeight - rect.bottom - 12
    const above = rect.top - 12
    const upward = below < 180 && above > below
    Object.assign(element.style, {
      left: `${rect.left}px`, width: `${rect.width}px`,
      top: upward ? 'auto' : `${rect.bottom + 6}px`,
      bottom: upward ? `${window.innerHeight - rect.top + 6}px` : 'auto',
      maxHeight: `${Math.max(60, Math.min(240, (upward ? above : below) - 6))}px`,
    })
  }
  const show = (index = selected) => {
    if (disabled) return
    position(); menu.current!.showPopover(); focus(index)
  }
  useEffect(() => {
    if (!open) return
    const dismiss = (event: Event) => { if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) close() }
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => { window.removeEventListener('resize', dismiss); window.removeEventListener('scroll', dismiss, true) }
  }, [open])
  return <div className="library-field" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) close() }}><span id={`${id}-label`}>{label}</span>
    <button ref={trigger} type="button" className="conversation-destination-trigger" aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="listbox" aria-expanded={open} aria-controls={id} disabled={disabled} autoFocus={autoFocus} popoverTarget={id} onClick={position} onKeyDown={(event) => {
      if (event.key === 'Tab') close()
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); show(event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : selected) }
    }}><span id={`${id}-value`}>{options[selected]?.name}</span><ChevronDownIcon aria-hidden="true" /></button>
    <div ref={menu} id={id} className="conversation-destination-menu" role="listbox" aria-labelledby={`${id}-label`} popover="auto" onToggle={(event) => { const expanded = event.newState === 'open'; setOpen(expanded); if (expanded && document.activeElement === trigger.current) focus(selected) }} onKeyDown={(event) => {
      const index = Array.from(menu.current!.querySelectorAll('[role="option"]')).indexOf(document.activeElement!)
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); focus(event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length)
      } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true) }
      else if (event.key === 'Tab') { close(true) }
      else if (event.key.length === 1 && event.key !== ' ' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const now = Date.now(); search.current = { text: (now - search.current.time < 700 ? search.current.text : '') + event.key.toLocaleLowerCase(), time: now }
        const match = options.findIndex((option) => option.name.toLocaleLowerCase().startsWith(search.current.text))
        if (match >= 0) { event.preventDefault(); focus(match) }
      }
    }}>
      {options.map((option) => <button type="button" role="option" key={option.id} aria-selected={option.id === value} tabIndex={-1} onClick={() => { onChange(option.id); close(true) }}><span>{option.name}</span>{option.id === value && <CheckIcon aria-hidden="true" />}</button>)}
    </div>
  </div>
}
