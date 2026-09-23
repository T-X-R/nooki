import { Children, createElement, isValidElement, useEffect, useState, type ReactNode } from 'react'
import { CheckIcon, CopyIcon } from '@radix-ui/react-icons'

function textFrom(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textFrom).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return textFrom(node.props.children)
  return Children.toArray(node).map(textFrom).join('')
}

export function codeBlockText(children: ReactNode): string {
  return textFrom(children).replace(/\n$/, '')
}

export function CopyableCodeBlock({ children, zh }: { children?: ReactNode; zh: boolean }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (status === 'idle') return
    const reset = window.setTimeout(() => setStatus('idle'), 1_800)
    return () => window.clearTimeout(reset)
  }, [status])
  const label = status === 'copied' ? (zh ? '已复制' : 'Copied') : status === 'failed' ? (zh ? '复制失败' : 'Copy failed') : (zh ? '复制内容' : 'Copy content')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codeBlockText(children))
      setStatus('copied')
    } catch {
      setStatus('failed')
    }
  }
  return createElement('div', { className: 'conversation-code-block' },
    createElement('button', {
      type: 'button',
      className: `icon-button conversation-code-copy ${status === 'copied' ? 'is-copied' : ''}`,
      'aria-label': label,
      title: label,
      onClick: () => void copy(),
    }, createElement(status === 'copied' ? CheckIcon : CopyIcon, { 'aria-hidden': true })),
    createElement('span', { className: 'visually-hidden', role: 'status', 'aria-live': 'polite' }, status === 'idle' ? '' : label),
    createElement('pre', null, children),
  )
}
