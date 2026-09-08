import type { AiInvocationResult, CapabilityJob, CapabilityLanguage, TaskRecord } from '../../packages/capability-contract/src'
import { buildSummaryPrompt, parseDailySessions, type DailySessionReviewSource } from './session-parser.ts'

export type PersistedDailyReview = { date: string; source: DailySessionReviewSource; summary: AiInvocationResult }
export const REVIEW_STORAGE_KEY = 'latest-review'

export const dailyReviewJob: CapabilityJob = {
  async run(input, { host, step }) {
    const { date, language } = input as { date: string; language: CapabilityLanguage }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !['zh', 'en'].includes(language)) throw new Error('Invalid review input')
    const source = await step('scan', async () => {
      const files = await host.codex.sessions.readTodayFiles()
      if (files.date !== date) throw new Error('This review belongs to a different date. Start a new review.')
      return parseDailySessions(files.files)
    })
    if (!source.sessions.length) return { date, source, summary: null }
    const summary = await step('summarize', () => host.ai.invoke(buildSummaryPrompt(date, source.sessions, language)))
    await step('save', () => host.storage.set(REVIEW_STORAGE_KEY, { date, source, summary }))
    await step('publish', () => host.documents.publish({
      key: date,
      title: language === 'zh' ? `${date} Codex 每日总结` : `${date} Codex daily review`,
      collectionKey: 'daily-reviews',
      collectionName: language === 'zh' ? '每日回顾' : 'Daily reviews',
      documentDate: date,
      content: summary.output,
    }))
    return { date, source, summary }
  },
}

export function dailyReviewSnapshot(task: TaskRecord | undefined, legacy: PersistedDailyReview | null) {
  const source = task ? task.checkpoints.scan as DailySessionReviewSource | undefined : legacy?.source
  const summary = task ? task.checkpoints.summarize as AiInvocationResult | undefined : legacy?.summary
  const phase = !task ? (legacy ? 'ready' : 'idle')
    : task.status === 'completed' ? (summary ? 'ready' : 'empty')
      : task.status === 'running' ? (task.stage === 'scan' || !task.stage ? 'scanning' : task.stage === 'summarize' ? 'summarizing' : 'publishing')
        : task.status === 'failed' ? 'error' : task.status
  return { source: source ?? null, summary: summary ?? null, phase, error: task?.error ?? null }
}
