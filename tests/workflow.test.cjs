// Run real Vue script/store actions with isolated IO and model responses.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const assert = require('node:assert/strict'), ts = require('typescript')
const root = path.join(__dirname, '..')
const vue = { ref: value => ({ value }), computed: fn => ({ get value() { return fn() } }), watch() {} }
function load(rel, extra = '', mocks = {}, globals = {}) {
  let src = fs.readFileSync(path.join(root, rel), 'utf8')
  if (rel.endsWith('.vue')) src = src.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const code = ts.transpileModule(src + '\n' + extra, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, require: name => {
    if (Object.hasOwn(mocks, name)) return mocks[name]
    if (name === 'vue') return vue
    if (name.endsWith('.vue') || name === 'lucide-vue-next') return {}
    throw new Error('Unmocked module: ' + name)
  }, console, Map, Set, JSON, Date, Math, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, ...globals }, { filename: rel })
  return exports
}
function workflow({ existing = '', switchDuringBody = false } = {}) {
  const files = new Map(), writes = [], modelCalls = [], registered = []
  const meta = title => ({ title, genre: '科幻', viewpoint: '第三人称', workflow: { step: 5, chapterCursor: 1, chapterTotal: 2, completed: [] } })
  const lib = { current: meta('书A'), async refreshTree() {} }
  files.set('书A/正文/第001章.md', existing)
  const api = {
    async fileRead(book, rel) { return files.get(book + '/' + rel) || '' },
    async fileWrite(book, rel, content) { files.set(book + '/' + rel, content); writes.push({ book, rel, content }) },
    async bookMetaWrite(book, patch) { return { ...meta(book), ...patch } },
    async outlineRead() { return [{ no: 1, beatFull: '# 第1章\n角色甲试制。' }] },
    async outlineUpsert() {}, async outlineSetStatus() {},
    async treeList() { return [] }, async panelsList() { return [] },
    async charactersReadAll() { return { files: [], joined: '' } },
    async foreshadowRead() { return [{ content: '甲'.repeat(2800), status: '悬置' }, { content: '本章必须回收的伏笔', status: '悬置' }] },
    async memoryReadGlobal() { return [{ text: '甲'.repeat(3200) }] },
    async memoryReadBook() { return [{ text: '本书重要决定' }] },
    async chapterAdopt(book, rel, base, content) {
      assert.equal(files.get(book + '/' + rel) || '', base)
      await api.fileWrite(book, rel, content)
      return { sha256: 'mock-digest' }
    },
    async structureRegister(book, data) { registered.push({ book, data }); return {} }
  }
  function aiRun(task, promptId, vars, opts = {}) {
    modelCalls.push({ promptId, vars })
    const full = promptId === 'wf-chapter' ? '# 第1章\n角色甲完成了试制。' : promptId === 'wf-review' ? '核对主角投入和动机。' : '{}'
    opts.onChunk?.(full)
    if (switchDuringBody && promptId === 'wf-chapter') lib.current = meta('书B')
    return { promise: Promise.resolve(full), abort() {} }
  }
  const view = load('src/renderer/src/views/WorkflowView.vue', 'export { generateChapters, adoptPending, reviewPending, pendingText, memoryBlock, chapterContext, sliceOutlineByVolume };', {
    '../store/app': { useAppStore: () => ({}) }, '../store/library': { useLibraryStore: () => lib },
    '../ui/toolPrompt': {}, '../ui/markdown': { renderMarkdown: x => x }, '../ai': { aiRun }
  }, { window: { api }, localStorage: { getItem: () => null, setItem() {} } })
  return { ...view, files, writes, modelCalls, registered, lib }
}
async function main() {
  const switched = workflow({ switchDuringBody: true })
  await switched.generateChapters()
  assert.equal(switched.writes.length, 0, 'switching during generation must not save into either book')

  const w = workflow()
  await w.generateChapters()
  assert.equal(w.lib.current.workflow.chapterCursor, 1)
  assert.ok(w.lib.current.workflow.pendingChapter)
  assert.equal(w.writes.some(x => x.rel.startsWith('正文/')), false)
  assert.equal(w.registered.length, 0)
  assert.ok((await w.memoryBlock()).includes('本书重要决定'))
  assert.ok((await w.memoryBlock()).length > 3200)
  assert.ok((await w.chapterContext('', 1, 2)).foreshadow.includes('本章必须回收'))
  const draft = w.pendingText.value
  w.pendingText.value += '\n人工修改后。'
  await w.adoptPending()
  assert.equal(w.registered.length, 0, 'changed draft needs a fresh review')
  await w.reviewPending()
  await w.adoptPending()
  assert.equal(w.lib.current.workflow.chapterCursor, 2)
  assert.equal(w.lib.current.workflow.pendingChapter, null)
  assert.equal(w.modelCalls.findLast(x => x.promptId === 'wf-structure-extract').vars.source, draft + '\n人工修改后。')
  assert.equal(w.registered[0].data.origin.kind, 'manuscript')

  const adoptedExisting = workflow({ existing: '# 第1章\n作者采用的旧稿。' })
  await adoptedExisting.generateChapters()
  assert.equal(adoptedExisting.modelCalls.some(x => x.promptId === 'wf-chapter'), false)
  await adoptedExisting.adoptPending()
  assert.equal(adoptedExisting.modelCalls.find(x => x.promptId === 'wf-structure-extract').vars.source, '# 第1章\n作者采用的旧稿。')

  let sent
  const { useConversationStore: definition } = load('src/renderer/src/store/conversation.ts', '', {
    pinia: { defineStore: (id, value) => value }, './app': { useAppStore: () => ({ config: { tasks: { agent: {} }, agentParams: {} } }) }, './library': { useLibraryStore: () => ({}) }
  }, { window: { api: { agentRun: async args => { sent = args } } } })
  const state = definition.state()
  Object.assign(state, { messages: [{ id: 'old', role: 'user', content: '已压缩旧消息', thinking: '' }], async persist() {}, async maybeCompress() { this.messages[0].compacted = true; this.contextSummary = '有效摘要' }, failRun(msg, reason) { throw new Error(reason) } })
  await definition.actions.sendSingle.call(state, '检查')
  assert.equal(sent.history.some(x => x.content === '已压缩旧消息'), false)
  assert.equal(sent.contextSummary, '有效摘要')

  const { analyzeTextPatterns } = load('src/renderer/src/lib/text-check.ts')
  const scan = load('src/renderer/src/components/writing/FullCheck.vue', 'export { scan, findings };', {
    '../../store/app': { useAppStore: () => ({}) }, '../../store/library': { useLibraryStore: () => ({ chapterList: () => [{ path: '正文/第001章.md', name: '第001章.md' }, { path: '正文/第021章.md', name: '第021章.md' }] }) }, '../../lib/text-check': { analyzeTextPatterns }
  }, { defineProps: () => ({ book: '测试书', open: true }), defineEmits: () => () => {}, window: { api: {
    async dictRead() { return [] }, async trackingRead() { return [{ name: '角色甲', status: '死亡', lastChapter: '第20章' }] }, async powerRead() { return { realms: [], chars: [] } }, async foreshadowRead() { return [] }, async outlineRead() { return [] }, async fileRead() { return '角色甲走进店里。' }
  } } })
  await scan.scan()
  assert.equal(scan.findings.value.some(x => x.no === 1 && x.kind === '疑似吃书'), false)
  assert.equal(scan.findings.value.some(x => x.no === 21 && x.kind === '疑似吃书'), true)
  console.log('工作流回归：切书隔离、持久化审阅关卡、修改后重审、实际采用稿登记、记忆/伏笔保留、压缩历史与历史状态扫描通过。')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
