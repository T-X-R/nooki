import type { DocumentReference } from '../packages/capability-contract/src/index.ts'

export type ConversationAttachment = { id: string; name: string; content: string }
export type ConversationArtifact = { id: string; name: string; content: string; before: string | null; source: DocumentReference | null }

export function decodeAttachment(name: string, bytes: ArrayBuffer): ConversationAttachment {
  if (!/\.(md|txt)$/i.test(name) || /[/\\\0]/.test(name) || new TextEncoder().encode(name).length > 240) throw new Error('请选择 Markdown（.md）或文本（.txt）文件 / Choose a Markdown or text file')
  if (bytes.byteLength > 2_000_000) throw new Error('单个附件不能超过 2 MB / Each attachment must be at most 2 MB')
  let content: string
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new Error('附件需要使用 UTF-8 编码 / Attachments must use UTF-8 encoding') }
  if (content.includes('\0')) throw new Error('附件包含非文本内容 / Attachment contains binary content')
  return { id: crypto.randomUUID(), name, content }
}

export function validateAttachments(attachments: ConversationAttachment[], documentCount: number) {
  if (attachments.length + documentCount > 50) throw new Error('每次最多添加 50 份资料和附件 / Add at most 50 documents and attachments')
  if (attachments.reduce((size, item) => size + new TextEncoder().encode(item.content).length, 0) > 8_000_000) throw new Error('附件总大小不能超过 8 MB / Attachments must total at most 8 MB')
}

export function artifactTitle(name: string) { return name.replace(/\.(md|txt)$/i, '').slice(0, 120) || 'Document' }
