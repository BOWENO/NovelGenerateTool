import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync, copyFileSync } from 'fs'
import { join, normalize, sep, basename } from 'path'
import { app } from 'electron'
import { getLibraryRoot } from './library'

/** 素材库 / 技能库 / 灵感便签：Markdown + YAML frontmatter，条目按分组（子目录）组织 */
export type LibKind = 'materials' | 'skills' | 'notes'

export const LIB_DIR: Record<LibKind, string> = { materials: '_素材库', skills: '_技能库', notes: '_灵感便签' }
export const LIB_LABEL: Record<LibKind, string> = { materials: '素材库', skills: '技能库', notes: '灵感便签' }

export interface LibEntry {
  kind: LibKind
  group: string
  name: string
  path: string
  summary: string
  tags: string[]
  updatedAt: string
  size: number
}

export interface LibGroup {
  name: string
  entries: LibEntry[]
}

function kindRoot(kind: LibKind): string {
  return join(getLibraryRoot(), LIB_DIR[kind])
}

/** 库根目录绝对路径（供「在资源管理器中打开」） */
export function kindRootPath(kind: LibKind): string {
  const p = kindRoot(kind)
  mkdirSync(p, { recursive: true })
  return p
}

export function ensureLibraries(): void {
  for (const kind of ['materials', 'skills', 'notes'] as LibKind[]) {
    const root = kindRoot(kind)
    mkdirSync(root, { recursive: true })
    if (!existsSync(join(root, '通用'))) mkdirSync(join(root, '通用'), { recursive: true })
  }
  seedPresetLibraries()
}

/**
 * 安装包内置预置库（resources/preset-libraries/{skills,materials}/分组/条目.md）补缺：
 * - 首次启动（纯净安装）把预置的技能与素材写入用户库
 * - 已存在的条目绝不覆盖（保留用户改动）；被用户删除的条目也不会复活（种子标记按路径记录）
 * - 应用升级自带新条目时会自动补入（补入清单落盘，资源库页可感知）
 */
export function seedPresetLibraries(): { added: string[] } {
  const added: string[] = []
  const base = app.isPackaged
    ? join(process.resourcesPath, 'preset-libraries')
    : join(app.getAppPath(), 'resources', 'preset-libraries')
  if (!existsSync(base)) return { added }
  const markPath = join(app.getPath('userData'), 'preset-libs-seeded.json')
  let mark: Record<string, true> = {}
  try {
    mark = JSON.parse(readFileSync(markPath, 'utf8'))
  } catch {
    /* 无标记文件：全新环境 */
  }
  let dirty = false
  for (const kind of ['skills', 'materials'] as LibKind[]) {
    const src = join(base, kind)
    if (!existsSync(src)) continue
    const dest = kindRoot(kind)
    for (const group of readdirSync(src)) {
      const gdir = join(src, group)
      if (!statSync(gdir).isDirectory()) continue
      mkdirSync(join(dest, group), { recursive: true })
      for (const f of readdirSync(gdir)) {
        if (!f.endsWith('.md')) continue
        const relKey = `${kind}/${group}/${f}`
        const target = join(dest, group, f)
        if (mark[relKey]) continue // 这条预置之前已处理过（用户删了也不复活）
        if (!existsSync(target)) {
          copyFileSync(join(gdir, f), target)
          added.push(`${kind === 'skills' ? '技能' : '素材'}/${group}/${f.replace(/\.md$/, '')}`)
        }
        mark[relKey] = true
        dirty = true
      }
    }
  }
  if (dirty) {
    try {
      writeFileSync(markPath, JSON.stringify(mark, null, 2), 'utf8')
    } catch {
      /* 标记写失败只是下次启动会重复补缺，无实害 */
    }
  }
  if (added.length) {
    // 补入记录落盘（资源库页展示「最近更新」），保留最近一次
    try {
      writeFileSync(
        join(app.getPath('userData'), 'preset-libs-last.json'),
        JSON.stringify({ at: new Date().toISOString(), added }, null, 2),
        'utf8'
      )
    } catch {
      /* 记录写失败无实害 */
    }
  }
  return { added }
}

/** 上次预置库补入记录（资源库页展示） */
export function lastPresetUpdate(): { at: string; added: string[] } | null {
  try {
    const p = join(app.getPath('userData'), 'preset-libs-last.json')
    if (!existsSync(p)) return null
    const r = JSON.parse(readFileSync(p, 'utf8')) as { at: string; added: string[] }
    return r.added?.length ? r : null
  } catch {
    return null
  }
}

/** 部分内置技能落在独立分组（不进「写作方法论」） */
function serializeEntry(meta: { name: string; summary: string; tags: string[] }, body: string): string {
  const tags = meta.tags.length ? `[${meta.tags.join(', ')}]` : '[]'
  return `---\nname: ${meta.name}\nsummary: ${meta.summary}\ntags: ${tags}\nupdatedAt: ${new Date().toISOString()}\n---\n\n${body}`
}

export interface ParsedEntry {
  name: string
  summary: string
  tags: string[]
  updatedAt: string
  body: string
}

export function parseEntry(raw: string, fallbackName: string): ParsedEntry {
  const out: ParsedEntry = { name: fallbackName, summary: '', tags: [], updatedAt: '', body: raw }
  if (!raw.startsWith('---')) return out
  const end = raw.indexOf('\n---', 3)
  if (end < 0) return out
  const head = raw.slice(3, end)
  out.body = raw.slice(end + 4).replace(/^\r?\n/, '')
  for (const line of head.split('\n')) {
    const i = line.indexOf(':')
    if (i < 0) continue
    const k = line.slice(0, i).trim()
    const v = line.slice(i + 1).trim()
    if (k === 'name') out.name = v || fallbackName
    else if (k === 'summary') out.summary = v
    else if (k === 'updatedAt') out.updatedAt = v
    else if (k === 'tags') out.tags = v.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean)
  }
  return out
}

/** 防路径穿越 */
function safeResolve(kind: LibKind, relPath: string): string {
  const base = normalize(kindRoot(kind))
  const full = normalize(join(base, relPath))
  if (!full.startsWith(base + sep) && full !== base) throw new Error('非法路径')
  return full
}

export function listLibrary(kind: LibKind): LibGroup[] {
  const root = kindRoot(kind)
  mkdirSync(root, { recursive: true })
  const groups: LibGroup[] = []
  for (const name of readdirSync(root)) {
    const p = join(root, name)
    try {
      if (!statSync(p).isDirectory()) continue
    } catch {
      continue
    }
    const entries: LibEntry[] = []
    for (const f of readdirSync(p)) {
      if (!f.endsWith('.md')) continue
      const fp = join(p, f)
      try {
        const raw = readFileSync(fp, 'utf-8')
        const parsed = parseEntry(raw, f.replace(/\.md$/, ''))
        entries.push({
          kind,
          group: name,
          name: parsed.name,
          path: `${name}/${f}`,
          summary: parsed.summary,
          tags: parsed.tags,
          updatedAt: parsed.updatedAt || statSync(fp).mtime.toISOString(),
          size: raw.length
        })
      } catch {
        /* 跳过损坏条目 */
      }
    }
    groups.push({ name, entries: entries.sort((a, b) => a.name.localeCompare(b.name, 'zh')) })
  }
  return groups.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

export function readEntry(kind: LibKind, group: string, name: string): ParsedEntry {
  const p = safeResolve(kind, join(group, `${name}.md`))
  if (!existsSync(p)) return { name, summary: '', tags: [], updatedAt: '', body: '' }
  return parseEntry(readFileSync(p, 'utf-8'), name)
}

export function writeEntry(kind: LibKind, group: string, name: string, summary: string, tags: string[], body: string): void {
  if (!/^[^\\/:*?"<>|]+$/.test(group) || !/^[^\\/:*?"<>|]+$/.test(name)) throw new Error('名称含非法字符')
  const dir = safeResolve(kind, group)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.md`), serializeEntry({ name, summary, tags }, body), 'utf-8')
}

export function deleteEntry(kind: LibKind, group: string, name: string): void {
  const p = safeResolve(kind, join(group, `${name}.md`))
  if (existsSync(p)) rmSync(p)
}

export function createGroup(kind: LibKind, group: string): void {
  if (!/^[^\\/:*?"<>|]+$/.test(group)) throw new Error('名称含非法字符')
  mkdirSync(safeResolve(kind, group), { recursive: true })
}

export function deleteGroup(kind: LibKind, group: string): void {
  const p = safeResolve(kind, group)
  if (!existsSync(p)) return
  rmSync(p, { recursive: true, force: true })
  // Windows 下目录可能仍被占用而删除失败，此时必须报错，不能静默当成功
  if (existsSync(p)) throw new Error(`分组「${group}」删除失败，目录可能仍被其他程序占用`)
}

/** 从外部 Markdown 文件导入为技能条目 */
export function importSkillFile(srcPath: string, group: string): string {
  const name = basename(srcPath).replace(/\.md$/i, '')
  const dir = safeResolve('skills', group)
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, `${name}.md`)
  if (existsSync(dest)) throw new Error('已存在同名技能')
  const raw = readFileSync(srcPath, 'utf-8')
  if (raw.startsWith('---')) copyFileSync(srcPath, dest)
  else writeFileSync(dest, serializeEntry({ name, summary: '', tags: [] }, raw), 'utf-8')
  return name
}

/** 读取多个条目内容，供智能体上下文注入 */
export function readEntriesForContext(kind: LibKind, refs: { group: string; name: string }[]): { title: string; content: string }[] {
  const out: { title: string; content: string }[] = []
  for (const r of refs) {
    const e = readEntry(kind, r.group, r.name)
    if (e.body.trim()) out.push({ title: `[${LIB_LABEL[kind]}·${r.group}] ${e.name}${e.summary ? ` — ${e.summary}` : ''}`, content: e.body })
  }
  return out
}