import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { shell } from 'electron'

// ============ 词库外置（风格检查红牌/信号词表）：userData/词库.json 可编辑，改完面板里点「词库」重载 ============
// 约定：只支持「追加」自定义词与红牌（内置规则与自定义规则均只用于定位候选问题）；pattern 为正则字符串

export interface LexiconRedCard {
  key: string
  label: string
  /** 正则字符串（不要带斜杠和标志位） */
  pattern: string
  hint: string
  /** 适用文体：fiction / article，缺省两边都生效 */
  genres?: string[]
}

export interface LexiconData {
  _说明?: string
  /** 追加红牌句式（出现即警告） */
  redCards?: LexiconRedCard[]

}

const DEFAULT: LexiconData = {
  _说明: '追加需要核查的句式：redCards.pattern 填正则字符串，genres 可选 fiction 或 article。规则只定位候选问题，需回看原文。保存后在风格检查面板点词库重载。',
  redCards: []
}

function lexiconFile(): string {
  return join(app.getPath('userData'), '词库.json')
}

export function lexiconPath(): string {
  return lexiconFile()
}

/** 懒初始化：首次读取时落一份带说明的默认文件 */
export function readLexicon(): LexiconData {
  const p = lexiconFile()
  if (!existsSync(p)) {
    writeFileSync(p, JSON.stringify(DEFAULT, null, 2), 'utf-8')
    return JSON.parse(JSON.stringify(DEFAULT))
  }
  try {
    return { ...JSON.parse(readFileSync(p, 'utf-8')) }
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT))
  }
}

export function saveLexicon(data: LexiconData): void {
  writeFileSync(lexiconFile(), JSON.stringify(data, null, 2), 'utf-8')
}

/** 在系统编辑器里打开词库文件 */
export function openLexicon(): void {
  const p = lexiconFile()
  if (!existsSync(p)) readLexicon()
  shell.openPath(p)
}
