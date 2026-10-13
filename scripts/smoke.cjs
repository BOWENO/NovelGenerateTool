// Isolated Linux desktop smoke test. Requires Xvfb; no AI provider is configured.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { spawn } = require('node:child_process'), assert = require('node:assert/strict')
const root = path.join(__dirname, '..')
const output = process.env.NOVELGENERATETOOL_SMOKE_OUTPUT
  ? path.resolve(process.env.NOVELGENERATETOOL_SMOKE_OUTPUT)
  : fs.mkdtempSync(path.join(os.tmpdir(), 'novelgeneratetool-verification-'))
fs.mkdirSync(output, { recursive: true })
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'novelgeneratetool-desktop-'))
const port = 9344
const executable = process.env.NOVELGENERATETOOL_SMOKE_BINARY || path.join(root, 'release/linux-unpacked/novelgeneratetool')
let child, socket, id = 0
const pending = new Map(), runtimeErrors = []
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const next = ++id
    const timer = setTimeout(() => { pending.delete(next); reject(new Error('CDP timeout: ' + method)) }, 10000)
    pending.set(next, { resolve: value => { clearTimeout(timer); resolve(value) }, reject })
    socket.send(JSON.stringify({ id: next, method, params }))
  })
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}
async function waitFor(expression) {
  for (let i = 0; i < 50; i++) { if (await evaluate(expression)) return; await delay(100) }
  throw new Error('UI condition not met: ' + expression)
}
async function click(text) {
  await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(text)}); if (!button) throw new Error('button missing'); button.click(); })()`)
}
async function start() {
  child = spawn('xvfb-run', ['-a', executable, '--no-sandbox', '--remote-debugging-port=' + port], {
    cwd: root, detached: true, env: { ...process.env, NOVELGENERATETOOL_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe']
  })
  let log = ''
  child.stdout.on('data', data => { log += data }); child.stderr.on('data', data => { log += data })
  let page
  for (let i = 0; i < 100; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(x => x.type === 'page'); if (page) break } catch {}
    await delay(100)
  }
  if (!page) { fs.writeFileSync(path.join(output, 'desktop.log'), log); throw new Error('Desktop did not start') }
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.id) { const job = pending.get(message.id); if (job) { pending.delete(message.id); message.error ? job.reject(new Error(message.error.message)) : job.resolve(message.result) } }
    if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails.text)
  }
  await command('Runtime.enable')
  await waitFor('!!window.api && document.body?.innerText.includes("NovelGenerateTool")')
  return () => fs.writeFileSync(path.join(output, 'desktop.log'), log)
}
async function stop() {
  socket?.close(); socket = null
  if (child) { try { process.kill(-child.pid, 'SIGTERM') } catch {} child = null }
  await delay(400)
}
async function main() {
  const saveLog = await start()
  const body = await evaluate('document.body.innerText')
  assert.equal(/DAWO|inkdesk|墨案|朱雀/.test(body), false)
  assert.equal((await evaluate('window.api.configGet()')).providers.length, 0)
  const home = await command('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(output, 'home.png'), Buffer.from(home.data, 'base64'))
  await evaluate(`(async () => {
    const book = '界面恢复测试'; const text = '界面恢复测试文本，不属于小说正文。';
    await window.api.bookCreate({ title: book, genre: '测试' });
    await window.api.fileWrite(book, '草稿/第001章.md', text);
    await window.api.fileWrite(book, '报告/第001章审查.md', '界面恢复测试报告。');
    await window.api.bookMetaWrite(book, { workflow: { step: 5, chapterCursor: 1, chapterTotal: 2, completed: [], pendingChapter: { no: 1, draftPath: '草稿/第001章.md', reviewPath: '报告/第001章审查.md', baseContent: '', reviewedContent: text } } });
    return true;
  })()`)
  saveLog()
  await stop()
  const saveSecondLog = await start()
  await click('书架')
  await waitFor('document.body.innerText.includes("界面恢复测试")')
  await evaluate(`(() => { const title = [...document.querySelectorAll('div')].find(x => x.classList.contains('truncate') && x.textContent.trim() === '界面恢复测试'); if (!title) throw new Error('book card missing'); title.click(); })()`)
  await waitFor('document.querySelector("header")?.innerText.includes("写作台") && document.querySelector("header")?.innerText.includes("界面恢复测试")')
  await click('工作流')
  await waitFor('document.body.innerText.includes("待审阅") && [...document.querySelectorAll("textarea")].some(x => x.value.includes("界面恢复测试文本"))')
  const review = await command('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(output, 'review.png'), Buffer.from(review.data, 'base64'))
  await evaluate(`(() => { const toggle = [...document.querySelectorAll('button')].find(x => x.textContent.includes('章末登记')); if (!toggle) throw new Error('registration toggle missing'); toggle.click(); })()`)
  await click('采用本章')
  await waitFor('!document.body.innerText.includes("待审阅") && document.body.innerText.includes("已采用：1")')
  const state = await evaluate('window.api.bookMetaRead("界面恢复测试")')
  assert.equal(state.workflow.chapterCursor, 2)
  assert.equal(state.workflow.pendingChapter, null)
  assert.equal(await evaluate('window.api.fileRead("界面恢复测试", "正文/第001章.md")'), '界面恢复测试文本，不属于小说正文。')
  assert.equal(runtimeErrors.length, 0)
  saveSecondLog()
  fs.writeFileSync(path.join(output, 'desktop-result.json'), JSON.stringify({ passed: true, binary: executable, checks: ['startup', 'neutral branding', 'pending review restored after restart', 'draft and review loaded', 'explicit adoption', 'cursor advances after adoption'], real_ai_calls: 0, runtime_errors: runtimeErrors, screenshots: ['home.png', 'review.png'], environment: 'Linux + Xvfb; --no-sandbox used only for isolated desktop verification' }, null, 2))
  console.log('桌面验证通过：启动、品牌、重启恢复待审稿、采用与进度推进；真实模型调用0。')
}
main().catch(async error => {
  console.error(error)
  if (socket?.readyState === WebSocket.OPEN) {
    try {
      fs.writeFileSync(path.join(output, 'failure-body.txt'), await evaluate('document.body.innerText'))
      const screenshot = await command('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(output, 'failure.png'), Buffer.from(screenshot.data, 'base64'))
    } catch {}
  }
  process.exitCode = 1
}).finally(async () => { await stop(); fs.rmSync(dataDir, { recursive: true, force: true }) })
