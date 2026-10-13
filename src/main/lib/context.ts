/** 估算容量并显性停止；不通过截断重要资料换取请求成功。 */
export function assertContextFits(chars: number, windowTokens?: number): void {
  const usable = windowTokens ? Math.floor(windowTokens * 0.8 * 1.4) : 120000
  if (chars > usable) {
    throw new Error('资料超过本次模型可用上下文。请减少无关引用或调整模型容量；关键记忆未被自动删去。')
  }
}
