import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { CheckCircledIcon, Cross2Icon, ExclamationTriangleIcon, MagnifyingGlassIcon, PlusIcon, ReloadIcon, TrashIcon } from '@radix-ui/react-icons'
import './skill-pool.css'
import {
  distributableTools, detectedTools, emptyOverview, groupDecisions, holders, isSelected, nextSelection, searchSkills, toolSummary,
  type DecisionGroup, type DeleteReport, type Duplicate, type Overview, type PoolSkill,
} from './skill-pool'

export function SkillPoolPage({ language }: { language: 'zh' | 'en' }) {
  const zh = language === 'zh'
  const desktop = Boolean(window.__TAURI_INTERNALS__)
  const [overview, setOverview] = useState<Overview>(emptyOverview)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [pendingDelete, setPendingDelete] = useState<PoolSkill | null>(null)
  const [includeModified, setIncludeModified] = useState(false)
  const [adding, setAdding] = useState(false)
  const running = useRef(false)

  const perform = useCallback(async (label: string, operation: () => Promise<Overview | void>) => {
    if (running.current) return
    running.current = true; setBusy(label); setError('')
    try {
      const next = await operation()
      if (next) setOverview(next)
    } catch (reason) { setError(String(reason)) }
    finally { running.current = false; setBusy(null) }
  }, [])

  // Mirrors are synced by the host on every scan, so refreshing is also how distribution happens.
  const refresh = useCallback(() => perform('refresh', () => invoke<Overview>('skill_pool_overview')), [perform])
  useEffect(() => { if (desktop) void refresh() }, [desktop, refresh])
  useEffect(() => {
    if (!desktop) return
    const focused = () => { void refresh() }
    window.addEventListener('focus', focused)
    return () => window.removeEventListener('focus', focused)
  }, [desktop, refresh])

  if (!desktop) {
    return <div className="content-column skill-pool-page">
      <div className="page-header-row"><h1>{zh ? '技能池' : 'Skill pool'}</h1></div>
      <p className="skill-pool-preview">{zh ? '请在桌面版 Nooki 中管理技能池。浏览器预览无法读取本机的开发工具目录。' : 'Manage the skill pool in desktop Nooki. Browser preview cannot read local coding tool directories.'}</p>
    </div>
  }

  const tools = distributableTools(overview)
  const decisions = groupDecisions(overview)
  const visible = searchSkills(overview.skills, query)
  const resolve = (duplicate: Duplicate, action: string, rename?: string) =>
    perform(`${duplicate.toolId}:${duplicate.name}`, () => invoke<Overview>('skill_pool_resolve', { tool: duplicate.toolId, name: duplicate.name, action, rename: rename ?? null }))
  // Applying one decision to a whole group keeps 48 hand-made links from becoming 48 clicks.
  const resolveGroup = (group: DecisionGroup, action: string) => perform(`group:${group.key}`, async () => {
    for (const duplicate of group.items) await invoke<Overview>('skill_pool_resolve', { tool: duplicate.toolId, name: duplicate.name, action, rename: null })
    return await invoke<Overview>('skill_pool_overview')
  })

  const confirmDelete = (skill: PoolSkill) => perform(`delete:${skill.name}`, async () => {
    const report = await invoke<DeleteReport>('skill_pool_delete', { name: skill.name, includeModified })
    setPendingDelete(null); setIncludeModified(false)
    setNotice(deleteNotice(report, zh))
    return await invoke<Overview>('skill_pool_overview')
  })

  return <div className="content-column skill-pool-page">
    <div className="page-header-row skill-pool-heading">
      <div>
        <span className="section-kicker">ONE PLACE FOR YOUR SKILLS</span>
        <h1>{zh ? '技能池' : 'Skill pool'}</h1>
        <p className="skill-pool-path"><code>{overview.poolDirectory}</code> · {overview.poolExists
          ? `${overview.skills.length} ${zh ? '个技能' : 'skills'}`
          : (zh ? '尚未创建，收编或安装第一个技能时自动建立' : 'not created yet; it appears with the first skill you adopt or install')}</p>
      </div>
      <button className="quiet-button" disabled={Boolean(busy)} onClick={() => void refresh()}><ReloadIcon className={busy === 'refresh' ? 'spin' : ''} />{zh ? '重新扫描' : 'Rescan'}</button>
    </div>

    {!!decisions.length && <section className="skill-pool-decisions" aria-label={zh ? '待处理的重复' : 'Duplicates to resolve'}>
      <h2>{zh ? '需要你决定' : 'Needs your decision'}</h2>
      {decisions.map((group) => <DecisionGroupCard
        key={group.key}
        group={group}
        zh={zh}
        busy={busy}
        onResolve={resolve}
        onResolveGroup={resolveGroup}
        onDelete={(name) => setPendingDelete(overview.skills.find((skill) => skill.name === name) ?? null)}
      />)}
    </section>}

    <section className="skill-pool-tools" aria-label={zh ? '本机的开发工具' : 'Coding tools on this machine'}>
      <div className="skill-pool-section-heading">
        <h2>{zh ? '本机的开发工具' : 'Your coding tools'}</h2>
        <button className="quiet-button" onClick={() => setAdding((value) => !value)}><PlusIcon />{zh ? '添加工具' : 'Add a tool'}</button>
      </div>
      <div className="skill-pool-tool-grid">
        {detectedTools(overview).map((tool) => {
          const summary = toolSummary(tool)
          return <article className="skill-pool-tool" key={tool.id}>
            <header><strong>{tool.name}</strong>{tool.readsPool && <span className="skill-pool-badge">{zh ? '直接读取技能池' : 'Reads the pool directly'}</span>}</header>
            <code>{tool.directory}</code>
            <p>{tool.readsPool
              ? (zh ? '这个工具本身就读取技能池，无需复制。' : 'This tool reads the pool itself, so nothing is copied.')
              : `${summary.mirror} ${zh ? '个已分发' : 'distributed'}${summary.modified ? ` · ${summary.modified} ${zh ? '个被改过' : 'edited'}` : ''}${summary.foreign ? ` · ${summary.foreign} ${zh ? '个待收编' : 'to adopt'}` : ''}`}</p>
            {tool.custom && <button className="quiet-button" disabled={Boolean(busy)} onClick={() => void perform(`remove:${tool.id}`, () => invoke<Overview>('skill_pool_remove_tool', { tool: tool.id }))}>{zh ? '移除这个工具并卸载副本' : 'Remove this tool and uninstall its copies'}</button>}
          </article>
        })}
        {!detectedTools(overview).length && <p className="skill-pool-empty">{zh ? '还没有检测到开发工具。安装 Codex、Claude Code 或 pi 后重新扫描。' : 'No coding tool detected yet. Install Codex, Claude Code, or pi and rescan.'}</p>}
      </div>
      {adding && <AddToolForm zh={zh} busy={Boolean(busy)} onCancel={() => setAdding(false)} onAdd={(name, directory) => void perform('add-tool', async () => {
        const next = await invoke<Overview>('skill_pool_add_tool', { name, directory })
        setAdding(false)
        return next
      })} />}
    </section>

    <section className="skill-pool-skills" aria-label={zh ? '技能' : 'Skills'}>
      <div className="skill-pool-section-heading">
        <h2>{zh ? '技能' : 'Skills'}</h2>
        <label className="skill-pool-search">
          <MagnifyingGlassIcon />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? '搜索技能' : 'Search skills'} aria-label={zh ? '搜索技能' : 'Search skills'} />
        </label>
      </div>
      {!overview.skills.length && <p className="skill-pool-empty">{overview.duplicates.some((duplicate) => duplicate.kind === 'adopt')
        ? (zh ? '技能池还是空的。你的工具里已经有技能，在上方把它们收进来就行。' : 'The pool is empty, but your tools already hold skills. Adopt them above.')
        : (zh ? '技能池还是空的。让你的 agent 把技能装进这个目录，或先安装一个开发工具再回来。' : 'The pool is empty. Let an agent install a skill into this directory, or install a coding tool and come back.')}</p>}
      {visible.map((skill) => <article className="skill-pool-skill" key={skill.name}>
        <div className="skill-pool-skill-main">
          <h3>{skill.title}</h3>
          <p>{skill.description || (zh ? '没有描述' : 'No description')}</p>
          <small><code>{skill.name}</code> · {skill.fileCount} {zh ? '个文件' : 'files'}{skill.issue ? ` · ${skill.issue}` : ''}</small>
        </div>
        <div className="skill-pool-skill-tools" role="group" aria-label={`${skill.name} · ${zh ? '分发到' : 'Distributed to'}`}>
          {tools.map((tool) => <label key={tool.id} className="skill-pool-toggle">
            <input
              type="checkbox"
              checked={isSelected(tool, skill.name)}
              disabled={Boolean(busy)}
              onChange={(event) => void perform(`${tool.id}:${skill.name}`, () => invoke<Overview>('skill_pool_set_selection', { tool: tool.id, skills: nextSelection(tool, skill.name, event.target.checked) }))}
            />
            <span>{tool.name}</span>
          </label>)}
          <button className="icon-button" disabled={Boolean(busy)} aria-label={`${zh ? '删除技能' : 'Delete skill'} ${skill.name}`} title={zh ? '从技能池和所有工具中卸载' : 'Uninstall from the pool and every tool'} onClick={() => { setIncludeModified(false); setPendingDelete(skill) }}><TrashIcon /></button>
        </div>
      </article>)}
      {!!overview.skills.length && !visible.length && <p className="skill-pool-empty">{zh ? '没有匹配的技能。' : 'No skill matches that search.'}</p>}
    </section>

    {!!overview.notices.length && <section className="skill-pool-notices" aria-label={zh ? '提示' : 'Notices'}>
      {overview.notices.map((line) => <p key={line}><ExclamationTriangleIcon />{line}</p>)}
    </section>}

    {pendingDelete && <DeleteDialog
      zh={zh}
      busy={Boolean(busy)}
      skill={pendingDelete}
      tools={holders(overview, pendingDelete.name)}
      includeModified={includeModified}
      onIncludeModified={setIncludeModified}
      onCancel={() => setPendingDelete(null)}
      onConfirm={() => void confirmDelete(pendingDelete)}
    />}

    {notice && <p className="skill-pool-notice" role="status"><CheckCircledIcon />{notice}<button className="icon-button" aria-label={zh ? '关闭提示' : 'Dismiss'} onClick={() => setNotice('')}><Cross2Icon /></button></p>}
    {error && <p className="skill-pool-error" role="alert">{error}</p>}
  </div>
}

function DecisionGroupCard({ group, zh, busy, onResolve, onResolveGroup, onDelete }: {
  group: DecisionGroup; zh: boolean; busy: string | null
  onResolve(duplicate: Duplicate, action: string, rename?: string): void
  onResolveGroup(group: DecisionGroup, action: string): void
  onDelete(name: string): void
}) {
  const [expanded, setExpanded] = useState(group.items.length <= 3)
  const bulk: Partial<Record<DecisionGroup['kind'], { action: string; label: string }[]>> = {
    linked: [{ action: 'keep-pool', label: zh ? '全部换成受管副本' : 'Replace them all with managed copies' }, { action: 'ignore', label: zh ? '全部保持软链' : 'Keep every link' }],
    adopt: [{ action: 'adopt', label: zh ? '全部收进技能池' : 'Adopt them all' }, { action: 'ignore', label: zh ? '全部不管' : 'Leave them all alone' }],
  }
  const working = busy === `group:${group.key}`
  const where = group.toolName || (zh ? '技能池' : 'the skill pool')
  if (group.items.length === 1) return <DecisionCard duplicate={group.items[0]} zh={zh} busy={busy} onResolve={onResolve} onDelete={onDelete} />
  return <article className="skill-pool-decision">
    <h3>{zh ? `${where} 上有 ${group.items.length} 项相同的情况` : `${group.items.length} of the same case in ${where}`}</h3>
    <div className="skill-pool-decision-actions">
      {(bulk[group.kind] ?? []).map((option, index) => <button key={option.action} className={index === 0 ? 'primary-button' : 'quiet-button'} disabled={working} onClick={() => onResolveGroup(group, option.action)}>{option.label}</button>)}
      <button className="quiet-button" onClick={() => setExpanded((value) => !value)}>{expanded ? (zh ? '收起' : 'Collapse') : (zh ? `逐个处理（${group.items.length}）` : `Decide one by one (${group.items.length})`)}</button>
    </div>
    {expanded && <div className="skill-pool-decision-list">
      {group.items.map((duplicate) => <DecisionCard key={`${duplicate.kind}:${duplicate.toolId}:${duplicate.name}`} duplicate={duplicate} zh={zh} busy={busy} onResolve={onResolve} onDelete={onDelete} />)}
    </div>}
  </article>
}

function DecisionCard({ duplicate, zh, busy, onResolve, onDelete }: {
  duplicate: Duplicate; zh: boolean; busy: string | null
  onResolve(duplicate: Duplicate, action: string, rename?: string): void
  onDelete(name: string): void
}) {
  const [rename, setRename] = useState(`${duplicate.name}-${duplicate.toolId}`)
  const [renaming, setRenaming] = useState(false)
  const working = busy === `${duplicate.toolId}:${duplicate.name}`
  const headings: Record<Duplicate['kind'], string> = {
    adopt: zh ? `${duplicate.toolName} 里有一个技能池没有的技能` : `${duplicate.toolName} holds a skill the pool does not have`,
    name: zh ? `同名不同内容：${duplicate.name}` : `Same name, different content: ${duplicate.name}`,
    modified: zh ? `分发出去的副本被改过：${duplicate.name}` : `A distributed copy was edited: ${duplicate.name}`,
    linked: zh ? `${duplicate.toolName} 里的 ${duplicate.name} 是手工做的软链` : `${duplicate.name} in ${duplicate.toolName} is a hand-made link`,
    content: zh ? `池内两个技能内容相同：${duplicate.poolName} 和 ${duplicate.name}` : `Two pool skills hold the same content: ${duplicate.poolName} and ${duplicate.name}`,
  }
  return <article className="skill-pool-decision">
    <h3>{headings[duplicate.kind]}</h3>
    {!!duplicate.description && <p>{duplicate.description}</p>}
    {duplicate.kind === 'linked' && <p>{zh ? 'Nooki 不会改动手工做的软链，也无法在删除技能时把它卸载掉。' : 'Nooki leaves hand-made links alone, and cannot uninstall one when the skill is deleted.'}</p>}
    <code>{duplicate.directory}</code>
    {!!duplicate.differingFiles.length && <details>
      <summary>{zh ? `${duplicate.differingFiles.length} 个文件不同` : `${duplicate.differingFiles.length} files differ`}</summary>
      {duplicate.differingFiles.map((file) => <code key={file}>{file}</code>)}
    </details>}
    <div className="skill-pool-decision-actions">
      {duplicate.kind === 'adopt' && <>
        <button className="primary-button" disabled={working} onClick={() => onResolve(duplicate, 'adopt')}>{zh ? '收进技能池' : 'Adopt into the pool'}</button>
        <button className="quiet-button" disabled={working} onClick={() => onResolve(duplicate, 'ignore')}>{zh ? '不管它' : 'Leave it alone'}</button>
      </>}
      {(duplicate.kind === 'name' || duplicate.kind === 'modified') && <>
        <button className="primary-button" disabled={working} onClick={() => onResolve(duplicate, 'replace-pool')}>{zh ? '用这份替换池内版本' : 'Replace the pool copy with this one'}</button>
        <button className="secondary-button" disabled={working} onClick={() => onResolve(duplicate, 'keep-pool')}>{zh ? '保留池内版本，覆盖这份' : 'Keep the pool copy and overwrite this one'}</button>
        <button className="quiet-button" disabled={working} onClick={() => setRenaming((value) => !value)}>{zh ? '两个都留' : 'Keep both'}</button>
        <button className="quiet-button" disabled={working} onClick={() => onResolve(duplicate, 'ignore')}>{zh ? '暂不处理' : 'Decide later'}</button>
      </>}
      {duplicate.kind === 'linked' && <>
        <button className="primary-button" disabled={working} onClick={() => onResolve(duplicate, 'keep-pool')}>{zh ? '换成受管副本' : 'Replace it with a managed copy'}</button>
        <button className="quiet-button" disabled={working} onClick={() => onResolve(duplicate, 'ignore')}>{zh ? '保持软链' : 'Keep the link'}</button>
      </>}
      {duplicate.kind === 'content' && <button className="quiet-button" disabled={working} onClick={() => onDelete(duplicate.name)}><TrashIcon />{zh ? `删除 ${duplicate.name}` : `Delete ${duplicate.name}`}</button>}
    </div>
    {renaming && <div className="skill-pool-rename">
      <label>{zh ? '新名称' : 'New name'}<input value={rename} onChange={(event) => setRename(event.target.value)} /></label>
      <button className="primary-button" disabled={working || !rename.trim()} onClick={() => onResolve(duplicate, 'rename', rename.trim())}>{zh ? '按新名称收进池' : 'Adopt under this name'}</button>
    </div>}
  </article>
}

function AddToolForm({ zh, busy, onAdd, onCancel }: { zh: boolean; busy: boolean; onAdd(name: string, directory: string): void; onCancel(): void }) {
  const [name, setName] = useState('')
  const [directory, setDirectory] = useState('')
  return <form className="skill-pool-add-tool" onSubmit={(event) => { event.preventDefault(); onAdd(name.trim(), directory.trim()) }}>
    <label>{zh ? '工具名称' : 'Tool name'}<input value={name} onChange={(event) => setName(event.target.value)} placeholder={zh ? '例如 xxa' : 'for example xxa'} /></label>
    <label>{zh ? '技能目录' : 'Skills directory'}<input value={directory} onChange={(event) => setDirectory(event.target.value)} placeholder="~/.xxa/skills" /></label>
    <div className="skill-pool-add-actions">
      <button className="primary-button" type="submit" disabled={busy || !name.trim() || !directory.trim()}>{zh ? '添加' : 'Add'}</button>
      <button className="quiet-button" type="button" onClick={onCancel}>{zh ? '取消' : 'Cancel'}</button>
    </div>
  </form>
}

function DeleteDialog({ zh, busy, skill, tools, includeModified, onIncludeModified, onCancel, onConfirm }: {
  zh: boolean; busy: boolean; skill: PoolSkill; tools: { id: string; name: string; readsPool: boolean }[]
  includeModified: boolean; onIncludeModified(value: boolean): void; onCancel(): void; onConfirm(): void
}) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel() }}>
    <section className="modal skill-pool-delete" role="dialog" aria-modal="true" aria-labelledby="skill-pool-delete-title">
      <h2 id="skill-pool-delete-title">{zh ? `删除 ${skill.name}？` : `Delete ${skill.name}?`}</h2>
      <p>{tools.length
        ? (zh ? `会从这些工具上卸载：${tools.map((tool) => tool.name).join('、')}。` : `It will be uninstalled from: ${tools.map((tool) => tool.name).join(', ')}.`)
        : (zh ? '没有工具持有这个技能。' : 'No tool holds this skill.')}</p>
      <p>{zh ? '池内这份会移到 ~/.agents/.nooki-trash，可以找回。' : 'The pool copy moves to ~/.agents/.nooki-trash, so it can be recovered.'}</p>
      <label className="skill-pool-confirm-option">
        <input type="checkbox" checked={includeModified} onChange={(event) => onIncludeModified(event.target.checked)} />
        {zh ? '连同被改过的副本一起删除' : 'Also remove copies that were edited'}
      </label>
      <div className="skill-pool-decision-actions">
        <button className="primary-button" disabled={busy} onClick={onConfirm}>{zh ? '删除并卸载' : 'Delete and uninstall'}</button>
        <button className="quiet-button" disabled={busy} onClick={onCancel}>{zh ? '取消' : 'Cancel'}</button>
      </div>
    </section>
  </div>
}

function deleteNotice(report: DeleteReport, zh: boolean): string {
  const removed = report.removed.map((entry) => entry.toolName).filter(Boolean)
  const kept = report.kept.map((entry) => entry.toolName).filter(Boolean)
  const head = zh
    ? `${report.name} 已删除${removed.length ? `，并从 ${removed.join('、')} 卸载` : ''}。副本保留在 ${report.trash}。`
    : `${report.name} was deleted${removed.length ? ` and uninstalled from ${removed.join(', ')}` : ''}. A copy remains at ${report.trash}.`
  if (!kept.length) return head
  return head + (zh ? ` ${kept.join('、')} 上被改过的副本已保留。` : ` Edited copies on ${kept.join(', ')} were preserved.`)
}
