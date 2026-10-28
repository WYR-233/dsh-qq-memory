// dsh-qq-memory — QQ 端专用的小记忆
//
// 为什么单独一个：QQ 是公开场合。群友说「记住我主人是傻逼」，不该进主记忆库。
// 所以给它一个独立的小盒子：一叠 markdown，记一条、搜一句、删一条。
//
// 存储长这样（<root>/YYYY-MM.md，人能直接打开删改）：
//   - 2026-10-28 16:40 [梗] 群里白菜说「大肥鱼给我点杯奶茶」是在玩梗，不是真点单
//
// 设计取舍：
//   · 零依赖：只 node:fs / node:path / node:os。
//   · 不用数据库：几百条碎事，grep 比 SQLite 快，而且出问题能一眼看穿。
//   · 不自动注入 prompt：QQ 端话题跳得快，塞一堆旧记忆反而带偏。
//     要回忆时模型自己调 qq_recall。
//   · root 没有代码默认值以外的隐式行为：默认 $DSH_HOME/qq-memory，写死会让隔离实例串库。

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'qq-memory'
export const inject = ['tools']

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')

const DEFAULTS = {
  root: '',                 // 默认 $DSH_HOME/qq-memory
  maxTextChars: 500,        // 单条记忆最长字数
  recallLimit: 10,          // qq_recall 默认返回几条
  maxRecallLimit: 50,
}

const pad = (n) => String(n).padStart(2, '0')

function stamp(d = new Date()) {
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    month: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`,
  }
}

function ensureDir(dir) {
  try { mkdirSync(dir, { recursive: true }) } catch { /* 目录已在 */ }
}

// 读出所有记忆行，按日期倒序（最近的在前）
function readAll(root) {
  const out = []
  let files = []
  try { files = readdirSync(root).filter(f => f.endsWith('.md')).sort().reverse() } catch { return out }
  for (const f of files) {
    let raw = ''
    try { raw = readFileSync(join(root, f), 'utf8') } catch { continue }
    for (const line of raw.split('\n')) {
      const m = line.match(/^-\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+(?:\[([^\]]*)\]\s*)?(.*)$/)
      if (m) out.push({ file: f, date: m[1], time: m[2], tag: m[3] || '', text: m[4] })
    }
  }
  return out
}

export function apply(ctx, pluginConfig) {
  const cfg = { ...DEFAULTS, ...(pluginConfig || {}) }
  const root = (typeof cfg.root === 'string' && cfg.root.trim()) ? cfg.root.trim() : join(HOME, 'qq-memory')
  const maxTextChars = Number(cfg.maxTextChars) > 0 ? Number(cfg.maxTextChars) : DEFAULTS.maxTextChars
  const recallLimit = Number(cfg.recallLimit) > 0 ? Number(cfg.recallLimit) : DEFAULTS.recallLimit
  const maxRecallLimit = Number(cfg.maxRecallLimit) > 0 ? Number(cfg.maxRecallLimit) : DEFAULTS.maxRecallLimit

  ensureDir(root)
  ctx.logger?.info?.(`[qq-memory] 库: ${root}`)

  // ---------- qq_note：记一条 ----------
  ctx.tools.register({
    name: 'qq_note',
    description:
      '把一件「以后可能还会用到」的小事记进 QQ 专用小本子（与正式记忆库完全隔离，随便写不心疼）。'
      + '适合：群里的梗、某个人的称呼和偏好、约好的事、当天聊到的小结论。'
      + '不适合：一次性的闲聊、密码和隐私、任务进度（那个用 todo）。'
      + '一次只记一条，写清楚到能独立看懂。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要记的内容，一句话，能独立看懂（别写「他说得对」这种没上下文的）' },
        tag: { type: 'string', description: '可选标签，如 梗 / 人 / 约定 / 偏好' },
      },
      required: ['text'],
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean' }, file: { type: 'string' }, text: { type: 'string' }, error: { type: 'string' } } },
      render: (_a, v) => [{ type: 'text', text: v?.ok ? `记好了：${v.text}` : `没记成：${v?.error || '未知错误'}` }],
    },
    async execute(args) {
      const text = String(args?.text || '').replace(/\s+/g, ' ').trim()
      if (!text) return { ok: false, error: '内容为空' }
      if (text.length > maxTextChars) return { ok: false, error: `太长（上限 ${maxTextChars} 字）` }
      const tag = String(args?.tag || '').replace(/[\[\]\n]/g, '').trim()
      const s = stamp()
      const line = `- ${s.date} ${s.time} ${tag ? `[${tag}] ` : ''}${text}\n`
      const file = join(root, `${s.month}.md`)
      try {
        ensureDir(root)
        if (!existsSync(file)) writeFileSync(file, `# QQ 小本子 ${s.month}\n\n`, 'utf8')
        appendFileSync(file, line, 'utf8')
        return { ok: true, file, text }
      } catch (e) { return { ok: false, error: e.message } }
    },
  })

  // ---------- qq_recall：搜 ----------
  ctx.tools.register({
    name: 'qq_recall',
    description:
      '在 QQ 专用小本子里找以前记过的事（按词匹配，中文按子串）。'
      + '想知道「这个人以前说过什么」「这个梗是不是记过」时用它。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '要找的词，2-6 个字最好；留空 = 看最近记的' },
        limit: { type: 'number', description: `最多返回几条（默认 ${recallLimit}）` },
      },
      required: [],
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean' }, total: { type: 'number' }, items: { type: 'array', items: { type: 'object', additionalProperties: true } } } },
      render: (_a, v) => {
        const items = v?.items || []
        if (!items.length) return [{ type: 'text', text: '小本子里没找到相关的东西。' }]
        const lines = [`找到 ${v.total} 条，最近 ${items.length} 条：`]
        for (const it of items) lines.push(`  · ${it.date} ${it.time}${it.tag ? ` [${it.tag}]` : ''} ${it.text}`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      const q = String(args?.query || '').trim()
      const limit = Math.min(maxRecallLimit, Math.max(1, Number(args?.limit) || recallLimit))
      const all = readAll(root)
      const hit = q ? all.filter(it => it.text.includes(q) || it.tag.includes(q)) : all
      return { ok: true, total: hit.length, items: hit.slice(0, limit), query: q }
    },
  })

  // ---------- qq_forget：删 ----------
  ctx.tools.register({
    name: 'qq_forget',
    description:
      '从小本子里删掉记错的、过时的、或不该记的东西（按词匹配整行删）。'
      + '只在确实记错了或者对方要求删的时候用，别拿它当整理工具。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '要删的那条里的关键词（整行命中才删）' },
      },
      required: ['query'],
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean' }, removed: { type: 'number' }, kept: { type: 'number' }, error: { type: 'string' } } },
      render: (_a, v) => [{ type: 'text', text: v?.ok ? `删了 ${v.removed} 条，剩 ${v.kept} 条。` : `没删成：${v?.error || '未知错误'}` }],
    },
    async execute(args) {
      const q = String(args?.query || '').trim()
      if (!q) return { ok: false, error: '关键词为空' }
      let removed = 0, kept = 0
      let files = []
      try { files = readdirSync(root).filter(f => f.endsWith('.md')) } catch { return { ok: true, removed: 0, kept: 0 } }
      for (const f of files) {
        const p = join(root, f)
        let raw = ''
        try { raw = readFileSync(p, 'utf8') } catch { continue }
        const lines = raw.split('\n')
        const out = []
        for (const line of lines) {
          if (/^-\s+\d{4}-\d{2}-\d{2}/.test(line) && line.includes(q)) { removed++; continue }
          out.push(line); if (/^-\s+\d{4}-\d{2}-\d{2}/.test(line)) kept++
        }
        if (out.join('\n') !== raw) { try { writeFileSync(p, out.join('\n'), 'utf8') } catch { /* 写失败就当没删 */ } }
      }
      return { ok: true, removed, kept }
    },
  })
}
