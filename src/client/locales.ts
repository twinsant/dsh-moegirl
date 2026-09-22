/** Sprite copy dictionaries; zh owns the key set. */

export const zh = {
  'sprite.aria': '桌面精灵，显示 agent 运行状态',
  'bubble.idle': '现在没有任务，摸摸鱼～',
  'bubble.working': '正在努力工作…',
  'bubble.attention': '有会话在等待你的操作！',
  'bubble.approval': '有会话等待你的批准！',
  'bubble.done': '任务完成啦，快去看看～',
  'bubble.open.title': '点击跳到这个会话',
  'bubble.count.sessions': '个会话',
} as const

export const en: Record<keyof typeof zh, string> = {
  'sprite.aria': 'Desktop sprite mirroring agent status',
  'bubble.idle': 'No tasks right now, taking a break~',
  'bubble.working': 'Working hard…',
  'bubble.attention': 'A session is waiting for you!',
  'bubble.approval': 'A session is waiting for your approval!',
  'bubble.done': 'A task just finished, take a look~',
  'bubble.open.title': 'Open this session',
  'bubble.count.sessions': 'sessions',
}

export type MoegirlKey = keyof typeof zh
