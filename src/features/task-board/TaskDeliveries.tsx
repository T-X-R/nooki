import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AttachedDelivery } from './task-board-store.ts'

export function RetainedText({ content, zh }: { content: string; zh: boolean }) {
  return <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    // Retained text must not fetch live remote resources or follow links into changed originals.
    img: ({ alt }) => <span>{alt} [{zh ? '图片未包含在此正文中' : 'Image not included in retained text'}]</span>,
    a: ({ href, children }) => <span>{children}{href && ` (${href})`}</span>,
    input: ({ checked }) => <span>{checked ? '☑' : '☐'}</span>,
  }}>{content.trim() ? content : (zh ? '此文档没有正文。' : 'This document has no text.')}</Markdown>
}

function RetainedDocument({ document, zh }: { document: AttachedDelivery['documents'][number]; zh: boolean }) {
  const [open, setOpen] = useState(false)
  return <details className="task-delivery-document" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{document.reference.title}<small>{document.documentDate} · {zh ? '保存的正文' : 'Retained text'}</small></summary>
    {open && <div className="task-delivery-content" role="region" aria-label={`${zh ? '保存的正文' : 'Retained text'} ${document.reference.title}`}>
      <RetainedText content={document.content} zh={zh} />
    </div>}
  </details>
}

export function TaskDeliveries({ deliveries, zh }: { deliveries: AttachedDelivery[]; zh: boolean }) {
  if (!deliveries.length) return null
  return <section className="task-deliveries" aria-label={zh ? '附加成果' : 'Attached deliveries'}>
    <h3>{zh ? '附加成果' : 'Attached deliveries'}</h3>
    <p className="task-deliveries-note">{zh ? '正文已随任务保存。查看成果不会执行任务或将其标记为已验收。' : 'Text is retained with this task. Viewing does not execute the task or accept its results.'}</p>
    {deliveries.map(delivery => <article key={delivery.id}>
      <h4>{delivery.title}</h4>
      <p className="task-delivery-meta">{delivery.provenance.capabilityId} · {delivery.provenance.capabilityVersion} · <time dateTime={delivery.createdAt}>{new Date(delivery.createdAt).toLocaleString(zh ? 'zh-CN' : 'en-US')}</time></p>
      {delivery.documents.map(document => <RetainedDocument key={document.reference.documentId} document={document} zh={zh} />)}
    </article>)}
  </section>
}
