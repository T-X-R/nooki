import type { DocumentReference } from '../../../packages/capability-contract/src/index.ts'
import { parseReferenceHref } from '../../../packages/capability-contract/src/references.ts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { TableKit } from '@tiptap/extension-table'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Image from '@tiptap/extension-image'
import { FontBoldIcon, FontItalicIcon, StrikethroughIcon, CodeIcon, PlusIcon, ResetIcon, ReloadIcon } from '@radix-ui/react-icons'
import { LibraryMenu } from './LibraryMenu.tsx'
import './library-rich-text.css'

const extensions = [StarterKit.configure({ link: { openOnClick: false } }), Markdown, TableKit, TaskList, TaskItem.configure({ nested: true }), Image]

export function LibraryRichText({ initial, language, onChange, onSave, onReady, onDocument }: { initial: string; language: 'zh' | 'en'; onChange(content: string): void; onSave(): void; onReady(editor: Editor | null): void; onDocument(reference: DocumentReference): void }) {
  const zh = language === 'zh'
  const wrapper = useRef<HTMLDivElement>(null)
  const [slash, setSlash] = useState<{ from: number; left: number; top: number } | null>(null)
  const [active, setActive] = useState(0)
  const slashRef = useRef(slash); slashRef.current = slash
  const activeRef = useRef(active); activeRef.current = active
  const actionsRef = useRef<{ run(): void }[]>([])
  const initialContent = useRef(initial)
  const saveRef = useRef(onSave); saveRef.current = onSave
  const documentRef = useRef(onDocument); documentRef.current = onDocument
  const editorProps = useMemo(() => ({
      attributes: { class: 'tiptap', role: 'textbox', 'aria-label': zh ? '文档正文' : 'Document content', 'aria-multiline': 'true', 'data-placeholder': zh ? '写下想法，输入 / 插入内容…' : 'Start writing, or type / for blocks…' },
      handleClick: (_view: unknown, _position: number, event: MouseEvent) => {
        const anchor = (event.target as HTMLElement).closest('a')
        const reference = parseReferenceHref(anchor?.getAttribute('href') ?? '')
        if (reference && (event.metaKey || event.ctrlKey)) { event.preventDefault(); documentRef.current(reference); return true }
        return false
      },
      handleKeyDown: (_view: unknown, event: KeyboardEvent) => {
        if (event.isComposing) return false
        if (slashRef.current && ['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) {
          event.preventDefault()
          if (event.key === 'Escape') setSlash(null)
          else if (event.key === 'Enter') actionsRef.current[activeRef.current]?.run()
          else setActive(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + actionsRef.current.length) % actionsRef.current.length)
          return true
        }
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); saveRef.current(); return true }
        return false
      },
  }), [zh])
  const editor = useEditor({
    extensions, content: initialContent.current, contentType: 'markdown', editorProps,
    onUpdate: ({ editor }) => {
      onChange(editor.isEmpty ? '' : editor.getMarkdown())
      const { $from } = editor.state.selection
      if ($from.parent.type.name === 'paragraph' && $from.parent.textContent === '/' && $from.parentOffset === 1) {
        const rect = wrapper.current?.getBoundingClientRect(), caret = editor.view.coordsAtPos($from.pos)
        if (rect) { setSlash({ from: $from.pos - 1, left: Math.max(0, Math.min(caret.left - rect.left, rect.width - 220)), top: caret.bottom - rect.top + 6 }); setActive(0) }
      } else setSlash(null)
    },
    onSelectionUpdate: () => setSlash(null),
  })
  useEffect(() => { onReady(editor); return () => onReady(null) }, [editor])
  const marks = useEditorState({ editor, selector: ({ editor }) => ({ bold: !!editor?.isActive('bold'), italic: !!editor?.isActive('italic'), strike: !!editor?.isActive('strike'), code: !!editor?.isActive('code') }) })
  const block = (run: (editor: Editor) => void) => {
    if (!editor) return
    if (slashRef.current) editor.chain().focus().deleteRange({ from: slashRef.current.from, to: slashRef.current.from + 1 }).run()
    setSlash(null); run(editor)
  }
  const blocks = [
    { label: zh ? '文本' : 'Text', icon: 'T', run: () => block(e => e.chain().focus().setParagraph().run()) },
    ...([1, 2, 3] as const).map(level => ({ label: zh ? `标题 ${level}` : `Heading ${level}`, icon: `H${level}`, run: () => block(e => e.chain().focus().toggleHeading({ level }).run()) })),
    { label: zh ? '无序列表' : 'Bullet list', icon: '•', run: () => block(e => e.chain().focus().toggleBulletList().run()) },
    { label: zh ? '有序列表' : 'Numbered list', icon: '1.', run: () => block(e => e.chain().focus().toggleOrderedList().run()) },
    { label: zh ? '待办清单' : 'Task list', icon: '☑', run: () => block(e => e.chain().focus().toggleTaskList().run()) },
    { label: zh ? '引用' : 'Quote', icon: '❞', run: () => block(e => e.chain().focus().toggleBlockquote().run()) },
    { label: zh ? '代码块' : 'Code block', icon: '</>', run: () => block(e => e.chain().focus().toggleCodeBlock().run()) },
    { label: zh ? '表格' : 'Table', icon: '▦', run: () => block(e => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()) },
    { label: zh ? '分隔线' : 'Divider', icon: '—', run: () => block(e => e.chain().focus().setHorizontalRule().run()) },
  ]
  actionsRef.current = blocks
  return <div className="library-rich-text" ref={wrapper}>
    <div className="library-format-tools" role="toolbar" aria-label={zh ? '文档工具' : 'Document tools'}>
      <LibraryMenu label={zh ? '插入内容' : 'Insert block'} icon={<PlusIcon />}>{blocks.map(item => <button role="menuitem" key={item.label} onClick={item.run}><span className="library-block-icon" aria-hidden="true">{item.icon}</span>{item.label}</button>)}</LibraryMenu>
      <span className="library-tool-divider" />
      {[
        { label: zh ? '粗体' : 'Bold', icon: <FontBoldIcon />, pressed: marks?.bold, run: () => editor?.chain().focus().toggleBold().run() },
        { label: zh ? '斜体' : 'Italic', icon: <FontItalicIcon />, pressed: marks?.italic, run: () => editor?.chain().focus().toggleItalic().run() },
        { label: zh ? '删除线' : 'Strikethrough', icon: <StrikethroughIcon />, pressed: marks?.strike, run: () => editor?.chain().focus().toggleStrike().run() },
        { label: zh ? '行内代码' : 'Inline code', icon: <CodeIcon />, pressed: marks?.code, run: () => editor?.chain().focus().toggleCode().run() },
        { label: zh ? '撤销' : 'Undo', icon: <ResetIcon />, run: () => editor?.chain().focus().undo().run() },
        { label: zh ? '重做' : 'Redo', icon: <ReloadIcon />, run: () => editor?.chain().focus().redo().run() },
      ].map(tool => <button type="button" className="icon-button" key={tool.label} title={tool.label} aria-label={tool.label} aria-pressed={tool.pressed} onMouseDown={event => event.preventDefault()} onClick={tool.run}>{tool.icon}</button>)}
    </div>
    <EditorContent editor={editor} />
    {slash && <div className="library-block-menu" role="menu" aria-label={zh ? '快捷插入' : 'Quick insert'} style={{ left: slash.left, top: slash.top }} onMouseDown={event => event.preventDefault()}>{blocks.map((item, index) => <button type="button" role="menuitem" key={item.label} className={index === active ? 'is-active' : ''} onMouseEnter={() => setActive(index)} onClick={item.run}><span aria-hidden="true">{item.icon}</span>{item.label}</button>)}</div>}
  </div>
}
