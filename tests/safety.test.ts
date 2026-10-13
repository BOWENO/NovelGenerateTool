import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { streamEvents } from '../src/main/lib/stream'
import { assertContextFits } from '../src/main/lib/context'
import { atomicWrite } from '../src/main/lib/atomic'
import { createBook, setLibraryRoot, readTextFile, writeTextFile, adoptChapter } from '../src/main/lib/library'
import { splitCharacterText } from '../src/main/lib/characters'
import { registerWorkflowStructure, readDict } from '../src/main/lib/structured'
import { analyzeTextPatterns } from '../src/renderer/src/lib/text-check'

async function collect(data: string) {
  const out = []
  for await (const event of streamEvents(new Response(data))) out.push(event)
  return out
}

async function main() {
  await assert.rejects(collect('data: {"choices":[{"delta":{"content":"半稿"},"finish_reason":"length"}]}\n'), /截断/)
  await assert.rejects(collect('data: {"choices":[{"delta":{"content":"半稿"}}]}\n'), /提前结束/)
  await assert.rejects(collect('data: {invalid}\n'), /JSON|property/i)
  assert.equal((await collect('data: {"choices":[{"delta":{"content":"完整稿"},"finish_reason":"stop"}]}'))[0].choices[0].delta.content, '完整稿')
  assert.throws(() => assertContextFits(5000, 2000), /未被自动删去/)
  assert.doesNotThrow(() => assertContextFits(1000, 2000))

  const sections = splitCharacterText('# 角色甲\n## 性格\n爱钱。\n## 经历\n做过维修。\n# 角色乙\n普通客户。')
  assert.equal(sections.length, 2)
  assert.ok(sections[0].content.includes('## 经历'))
  assert.equal(splitCharacterText('## 角色甲\n### 性格\n爱钱。\n## 角色乙\n客户。').length, 2)
  const patterns = analyzeTextPatterns('他深吸一口气。说实话，拿不准。', 'fiction')
  assert.ok(patterns.redCards.length)
  assert.equal('score' in patterns, false)

  const root = mkdtempSync(join(tmpdir(), 'novelgeneratetool-safety-'))
  try {
    setLibraryRoot(root)
    createBook('测试书')
    const rel = '正文/第001章.md'
    const body = '# 第1章\n角色甲收到了八百元。'
    const { sha256 } = adoptChapter('测试书', rel, '', body)
    assert.equal(sha256, createHash('sha256').update(body).digest('hex'))
    assert.throws(() => adoptChapter('测试书', rel, '', '覆盖稿'), /已在别处修改/)
    assert.equal(readTextFile('测试书', rel), body)
    assert.throws(() => readTextFile('../其他书', rel), /非法/)
    registerWorkflowStructure('测试书', { dict: [{ term: '角色甲', category: '人物' }], origin: { kind: 'manuscript', rel, sha256, chapterNo: 1 } })
    assert.equal(readDict('测试书').length, 1)
    writeTextFile('测试书', rel, '作者改过的正文')
    assert.throws(() => registerWorkflowStructure('测试书', { dict: [{ term: '虚构人物' }], origin: { kind: 'manuscript', rel, sha256 } }), /来源正文已变化/)
    assert.equal(readDict('测试书').length, 1)
    const target = join(root, 'atomic.txt')
    atomicWrite(target, '第一版')
    atomicWrite(target, '第二版')
    assert.equal(readFileSync(target, 'utf8'), '第二版')
    assert.equal(readdirSync(root).some(name => name.endsWith('.tmp')), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
  console.log('安全回归：流完整性、上下文容量、角色子标题、文本统计、采用冲突、来源校验与原子写入通过。')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
