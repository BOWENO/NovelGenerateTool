/** SSE 完整性校验供普通生成和智能体共用。 */
export async function* streamEvents(res: Response): AsyncGenerator<Record<string, any>> {
  const reader = res.body?.getReader()
  if (!reader) throw new Error('响应无内容流')
  const decoder = new TextDecoder()
  let pending = ''
  let finished = false
  function parse(line: string): Record<string, any> | null {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return null
    const data = trimmed.slice(5).trim()
    if (data === '[DONE]') { finished = true; return null }
    if (!data) return null
    const event = JSON.parse(data)
    if (event.error) throw new Error(event.error.message || '模型返回错误')
    const reason = event.choices?.[0]?.finish_reason
    if (reason === 'length') throw new Error('模型输出因长度限制被截断，本次结果未作为完整稿保存。')
    if (reason === 'content_filter') throw new Error('模型未完整返回内容，本次结果未保存。')
    if (reason) finished = true
    return event
  }
  try {
    while (true) {
      const { done, value } = await reader.read()
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true })
      const lines = pending.split('\n')
      pending = lines.pop() || ''
      for (const line of lines) {
        const event = parse(line)
        if (event) yield event
      }
      if (done) {
        if (pending.trim()) { const event = parse(pending); if (event) yield event }
        break
      }
    }
    if (!finished) throw new Error('模型连接提前结束，未收到完整结束标记，请重试。')
  } finally {
    reader.releaseLock?.()
  }
}
