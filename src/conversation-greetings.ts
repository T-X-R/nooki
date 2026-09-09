export const conversationGreetings = [
  { zh: '今天想聊点什么？', en: 'What would you like to talk about today?' },
  { zh: '最近在琢磨什么？', en: 'What’s been on your mind lately?' },
  { zh: '有什么想一起理清的？', en: 'What would you like to think through together?' },
  { zh: '想从哪里开始？', en: 'Where would you like to start?' },
  { zh: '有个想法，想聊聊吗？', en: 'Have an idea you’d like to explore?' },
  { zh: '今天想弄明白什么？', en: 'What would you like to figure out today?' },
  { zh: '哪件事让你有点拿不准？', en: 'Is there something you’re unsure about?' },
  { zh: '想给哪个问题换个角度？', en: 'What could use a fresh perspective?' },
  { zh: '有什么值得展开聊聊的？', en: 'What would you like to explore a little further?' },
  { zh: '有没有一个念头，还没想完整？', en: 'Have a thought that’s still taking shape?' },
  { zh: '想一起看看这些资料吗？', en: 'Shall we look through these documents together?', documentsOnly: true },
  { zh: '从你最关心的地方说起？', en: 'Shall we start with what matters most to you?' },
]

// Like composer drafts, openings survive navigation but stay local to this app session.
export function createGreetingRotation(random = Math.random) {
  const openings = new Map<string, number>()
  let recent: number[] = []
  return {
    get(key: string, options: { fresh: boolean; hasDocuments: boolean; hasText: boolean }) {
      const current = openings.get(key)
      const invalidContext = current !== undefined && conversationGreetings[current].documentsOnly && !options.hasDocuments
      if (current !== undefined && !invalidContext && (!options.fresh || options.hasText)) return conversationGreetings[current]
      const choices = conversationGreetings.map((_, i) => i).filter((i) => !recent.includes(i) && (options.hasDocuments || !conversationGreetings[i].documentsOnly))
      const next = choices[Math.floor(random() * choices.length)]
      openings.set(key, next)
      recent = [...recent, next].slice(-5)
      return conversationGreetings[next]
    },
    clearDraft() { openings.delete('new') },
  }
}
