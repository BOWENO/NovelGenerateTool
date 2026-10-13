// 本地文本统计和表达候选提示；不预测作者身份、文学质量或读者反馈。
export type Genre = 'fiction' | 'article'
export interface RedCard { key: string; label: string; sample: string; hint: string }
export interface LexiconOverrides {
  redCards?: { key: string; label: string; pattern: string; hint: string; genres?: string[] }[]
}
interface RedRule { key: string; label: string; pattern: RegExp; hint: string; genres: Genre[] }
const RED_RULES: RedRule[] = [
  { key: 'notA-butB', label: '「不是A，而是B」', pattern: /不是[^。！？，]{1,18}[，,]?\s*(?:不是[^。！？，]{1,18}[，,]?\s*)*而是/, hint: '结合场面检查是否反复、空泛或分量失当；单次命中不表示应当删除。', genres: ['fiction', 'article'] },
  { key: 'elegant-parallel', label: '同构排比三连', pattern: /有的[^。；]{1,20}有的[^。；]{1,20}有的|一边[^。；]{1,20}一边[^。；]{1,20}一边/, hint: '结合场面检查是否反复、空泛或分量失当；单次命中不表示应当删除。', genres: ['fiction', 'article'] },
  { key: 'eye-flash', label: '「眼中闪过一丝」', pattern: /(眼中|眼里|眼底|眸中|眸子)里?闪过一?[丝抹缕]?/, hint: '结合场面检查是否反复、空泛或分量失当；单次命中不表示应当删除。', genres: ['fiction'] },
  { key: 'mouth-curve', label: '「嘴角勾起一抹」', pattern: /嘴角(勾起|微微?上扬|掠过)/, hint: '结合场面检查是否反复、空泛或分量失当；单次命中不表示应当删除。', genres: ['fiction'] },
  { key: 'heart-surge', label: '「心中涌起一股」', pattern: /(心中|心头|心底)(涌起|泛起|掠过|一震|一动|一紧|暗道)/, hint: '结合场面检查是否反复、空泛或分量失当；单次命中不表示应当删除。', genres: ['fiction'] },
  { key: 'dai-zhe', label: '「，带着…」万能状语', pattern: /，带着(一[丝抹股种]|某种|几分)/, hint: '结合场面检查是否反复、空泛或分量失当；单次命中不表示应当删除。', genres: ['fiction'] },
  { key: 'shen-xi', label: '「深吸一口气」', pattern: /深吸(了一口|一口)气?/, hint: '结合场面检查是否反复、空泛或分量失当；单次命中不表示应当删除。', genres: ['fiction'] },
  { key: 'sh-仿佛一般', label: '「仿佛…一般」', pattern: /(仿佛|犹如|宛若|如同)[^。！？]{1,24}(一般|般|似的)/, hint: '结合场面检查是否反复、空泛或分量失当；单次命中不表示应当删除。', genres: ['fiction'] },
  { key: 'bu-rong-zhi-yi', label: '「不容置疑」', pattern: /不容置疑|不容置喙|不易察觉/, hint: '结合场面检查是否反复、空泛或分量失当；单次命中不表示应当删除。', genres: ['fiction'] },
  { key: 'mech-connect', label: '机械连接词', pattern: /(首先|其次|再者)[，、]|综上所述|总而言之|值得一提的是|值得注意的是|不难发现|由此可见|不可否认的是|毋庸置疑/, hint: '结合场面检查是否反复、空泛或分量失当；单次命中不表示应当删除。', genres: ['article'] },
  { key: 'xuan-hua', label: '升华套话', pattern: /(影响深远|意义重大|不言而喻|这引发了广泛|具有十分重要的意义|在当今[^。]{0,10}的时代|随着[^。]{0,12}的不断发展)/, hint: '结合场面检查是否反复、空泛或分量失当；单次命中不表示应当删除。', genres: ['article'] },
  { key: 'fu-yan', label: '悬浮概括', pattern: /(通过[^。]{1,12}来?实现|赋能|抓手|闭环|助力[^。]{0,8}发展|深入探讨)/, hint: '结合场面检查是否反复、空泛或分量失当；单次命中不表示应当删除。', genres: ['article'] },
  { key: 'ni-shuo', label: '「你以为A，实际上B」', pattern: /你以为[^。！？]{1,30}[，,]?\s*实际(上|是)/, hint: '结合场面检查是否反复、空泛或分量失当；单次命中不表示应当删除。', genres: ['article'] },
  { key: 'zi-wen-zi-da', label: '自问自答老师腔', pattern: /(这叫什么|说明什么|怎么办到的|看明白了吗|看到没有)[？?]/, hint: '结合场面检查是否反复、空泛或分量失当；单次命中不表示应当删除。', genres: ['article'] }
]


export function analyzeTextPatterns(rawText: string, genre: Genre, lex?: LexiconOverrides) {
  const text = rawText.trim()
  const lines = text.split(/\r?\n/).filter(line => line.trim())
  const dialogueChars = ((text.match(/[「“][^」”]+[」”]/g) || []) as string[]).reduce<number>((n, quote) => n + quote.length - 2, 0)
  const narrative = text.replace(/[「“][^」”]+[」”]/g, '')
  const lengths = (genre === 'fiction' ? narrative : text).split(/[。！？；\n]/).map(s => s.trim().length).filter(Boolean)
  const mean = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0
  const variance = lengths.length ? lengths.reduce((n, len) => n + (len - mean) ** 2, 0) / lengths.length : 0
  const chars = text.replace(/\s/g, '').length
  const redCards: RedCard[] = []
  const extra: RedRule[] = (lex?.redCards || []).flatMap(rule => {
    try { return [{ ...rule, pattern: new RegExp(rule.pattern), genres: (rule.genres || ['fiction', 'article']) as Genre[] }] }
    catch { return [] }
  })
  for (const rule of [...RED_RULES, ...extra]) {
    if (!rule.genres.includes(genre)) continue
    const match = text.match(rule.pattern)
    if (match) redCards.push({ key: rule.key, label: rule.label, sample: match[0].slice(0, 60), hint: rule.hint })
  }
  return {
    redCards,
    warnings: redCards.map(rule => `【待核查】${rule.label}：${rule.sample} → ${rule.hint}`),
    stats: { chars, paragraphs: lines.length, sentences: lengths.length, avgLen: Math.round(mean), cv: mean ? Math.round(Math.sqrt(variance) / mean * 100) / 100 : 0, dialogueRatio: chars ? Math.round(dialogueChars / chars * 100) / 100 : 0 }
  }
}
