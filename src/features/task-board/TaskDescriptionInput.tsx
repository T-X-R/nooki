import { Cross2Icon, FileTextIcon } from '@radix-ui/react-icons'
import { useEffect, useId, useRef, useState } from 'react'
import { listLibraryDocuments, type LibraryDocumentMetadata } from '../../platform/document-library.ts'
import type { BoardSource } from './task-board-store.ts'

export function TaskDescriptionInput({ zh, value, sources, onChange, onSources }: {
  zh: boolean
  value: string
  sources: BoardSource[]
  onChange(value: string): void
  onSources(sources: BoardSource[]): void
}) {
  const editor = useRef<HTMLTextAreaElement>(null)
  const menuId = useId()
  const [mention, setMention] = useState<{ start: number; end: number; query: string } | null>(null)
  const [documents, setDocuments] = useState<LibraryDocumentMetadata[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const picking = mention !== null
  useEffect(() => {
    if (!picking) return
    let current = true
    setLoading(true)
    setError('')
    void listLibraryDocuments().then(items => { if (current) setDocuments(items) })
      .catch(reason => { if (current) setError(String(reason)) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [picking])

  const matches = documents.filter(doc => !sources.some(source => source.id === doc.id)
    && doc.title.toLocaleLowerCase().includes(mention?.query.toLocaleLowerCase() ?? ''))
  const active = Math.min(highlighted, matches.length - 1)
  const canChoose = !loading && !error && sources.length < 50 && active >= 0
  function track(element: HTMLTextAreaElement) {
    const end = element.selectionStart
    const start = element.value.lastIndexOf('@', end - 1)
    const query = element.value.slice(start + 1, end)
    const found = start >= 0 && start < end && element.selectionEnd === end && !/[\s@]/u.test(query)
      && (start === 0 || !/[\w.%+-]/u.test(element.value[start - 1]))
    setMention(found ? { start, end, query } : null)
    setHighlighted(0)
  }
  function choose(doc: LibraryDocumentMetadata) {
    if (!mention || sources.length >= 50) return
    onSources([...sources, { id: doc.id, title: doc.title }])
    onChange(value.slice(0, mention.start) + value.slice(mention.end))
    const caret = mention.start
    setMention(null)
    requestAnimationFrame(() => { editor.current?.focus({ preventScroll: true }); editor.current?.setSelectionRange(caret, caret) })
  }
  return <div className="task-board-description-editor">
    <label className="task-board-description-label">
      <span>{zh ? '任务要求或备注' : 'Task requirements or notes'}</span>
      <textarea ref={editor} value={value} maxLength={20_000} rows={7}
        placeholder={zh ? '写下背景和期待的结果，输入 @ 引用资料…' : 'Add context and the result you need. Type @ to reference Library files…'}
        aria-autocomplete="list" aria-controls={picking ? menuId : undefined}
        aria-activedescendant={picking && canChoose ? `${menuId}-${active}` : undefined}
        onChange={event => { onChange(event.target.value); track(event.target) }}
        onClick={event => track(event.currentTarget)} onBlur={() => setMention(null)}
        onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) track(event.currentTarget) }}
        onKeyDown={event => {
          if (!picking || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMention(null); return }
          if (!canChoose) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setHighlighted((active + (event.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length)
          } else if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); choose(matches[active]) }
        }} />
    </label>
    {picking && <div className="task-board-reference-menu" onMouseDown={event => event.preventDefault()}>
      <div className="task-board-reference-menu-heading"><span>@</span><span className="task-board-reference-query">{mention.query || (zh ? '引用资料库文件' : 'Reference a Library file')}</span><small>{zh ? '↑↓ 选择 · Enter 确认' : '↑↓ select · Enter confirm'}</small></div>
      <div role="listbox" id={menuId} aria-label={zh ? '资料库文件' : 'Library files'}>
        {loading ? <p role="status">{zh ? '正在读取资料…' : 'Loading files…'}</p>
          : error ? <p role="alert">{error}</p>
          : sources.length >= 50 ? <p>{zh ? '最多引用 50 份资料' : 'Up to 50 references'}</p>
          : !matches.length ? <p>{zh ? '没有找到匹配的文件' : 'No matching files'}</p>
          : matches.map((doc, index) => <button key={doc.id} id={`${menuId}-${index}`} type="button" role="option" tabIndex={-1} aria-selected={index === active}
            ref={element => { if (index === active) element?.scrollIntoView({ block: 'nearest' }) }}
            onMouseEnter={() => setHighlighted(index)} onClick={() => choose(doc)}>
            <FileTextIcon /><span><strong>{doc.title}</strong><small>{doc.collectionName}</small></span>
          </button>)}
      </div>
    </div>}
    {!!sources.length && <div className="task-board-references" aria-label={zh ? '已引用文件' : 'Referenced files'}>{sources.map(source => <span key={source.id}><FileTextIcon /><span>{source.title}</span><button type="button" aria-label={`${zh ? '移除引用' : 'Remove reference'} ${source.title}`} onClick={() => onSources(sources.filter(item => item.id !== source.id))}><Cross2Icon /></button></span>)}</div>}
  </div>
}
