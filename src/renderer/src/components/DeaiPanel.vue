<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ToolButton from '../ui/ToolButton.vue'
import ToolSelect from '../ui/ToolSelect.vue'
import { aiRun } from '../ai'
import { analyzeTextPatterns, type LexiconOverrides } from '../lib/text-check'
import { deaiState as S } from '../lib/deaiState'

const props = defineProps<{ chapterText: string; book: string; file: string }>()
const emit = defineEmits<{ (e: 'apply-text', text: string): void }>()

/** 词库外置（追加制）：userData/词库.json 的自定义红牌与信号词 */
const lex = ref<LexiconOverrides | undefined>()

async function loadLexicon() {
  try {
    lex.value = (await window.api.lexiconRead()) as LexiconOverrides
  } catch {
    /* 词库缺失用内置 */
  }
}

async function openLexicon() {
  await window.api.lexiconOpen()
  await loadLexicon() // 编辑保存回来后重载
}

void loadLexicon()

// 切章节/切书：中止在途任务并清空结果，防止旧章改写文本被误应用到新章
watch(
  () => props.file,
  () => {
    if (S.running) S.aborter?.abort()
    S.mode = 'idle'
    S.report = ''
    S.rewritten = ''
    S.scores = null
    S.summary = ''
    S.error = ''
  }
)

// ============ 文本统计（本地计算） ============
const signal = computed(() => analyzeTextPatterns(props.chapterText || '', S.genre, lex.value))

/** OOC 对照用的角色设定卡：诊断时自动注入（正文文体才读），按书缓存（无卡也缓存，避免重复读盘）；一人一档聚合读取 */
async function loadCharacterCard() {
  if (!props.book) return
  if (S.characterBook === props.book) return
  S.characterCard = ''
  S.characterBook = props.book
  try {
    const all = await window.api.charactersReadAll(props.book)
    S.characterCard = (all.joined || '').slice(0, 6000)
  } catch {
    /* 读失败保持空卡 */
  }
}

const MODES = [
  { k: 'diagnose', t: '诊断', id: 'deai-diagnose', target: 'report' as const },
  { k: 'rewrite', t: '改写', id: 'deai-rewrite', target: 'rewritten' as const },
  { k: 'score', t: '审查建议', id: 'deai-score', target: 'report' as const }
]
const DIMS = ['直接性', '节奏感', '信任度', '真实性', '精炼度']

async function run(promptId: string, target: 'report' | 'rewritten') {
  S.running = true
  S.error = ''
  if (target === 'report') S.report = ''
  else S.rewritten = ''
  // 诊断模式 + 正文文体：注入角色设定卡供 OOC 对照
  if (promptId === 'deai-diagnose' && S.genre === 'fiction') await loadCharacterCard()
  const myFile = props.file // 任务发起时的章节，切章后在途回调全部作废
  const mySeq = ++S.runSeq // 任务代次：切章/新任务后旧收尾逻辑不再动 running 状态
  const aborter = aiRun(
    'deai',
    promptId,
    { input: props.chapterText, genre: S.genre === 'fiction' ? '小说正文' : '文章', characters: S.characterCard },
    {
      deaiLevel: S.level,
      onChunk: (c) => {
        if (props.file !== myFile) return
        if (target === 'report') S.report += c
        else S.rewritten += c
      },
      onAborted: () => {
        if (props.file === myFile) S.error = '已中止'
      }
    }
  )
  S.aborter = aborter
  try {
    const full = await aborter.promise
    if (props.file === myFile && full && target === 'report') S.report = full
  } catch (e) {
    if (props.file === myFile) S.error = (e as Error).message
  } finally {
    if (S.aborter === aborter) S.aborter = null
    if (S.runSeq === mySeq) S.running = false
  }
}

function stopRun() {
  S.aborter?.abort()
}

function applyRewrite() {
  if (!S.rewritten.trim()) return
  emit('apply-text', S.rewritten.trim())
}
</script>

<template>
  <div class="text-sm">
    <!-- 本地统计与待核查表达 -->
    <div class="rounded-lg border border-[var(--border)] bg-[var(--bg-soft)] p-3 mb-3">
      <div class="flex items-center gap-2 mb-2 flex-wrap">
        <span class="text-xs font-medium" :style="{ color: 'var(--accent)' }">文本统计</span>
        <span class="text-[10px] text-[var(--text-faint)]">用于定位待核查段落</span>
        <div class="flex-1" />
        <button
          class="text-[10.5px] text-[var(--text-faint)] hover:text-[var(--accent)] cursor-pointer"
          title="打开词库文件：可追加自定义红牌句式与信号词，保存后点这里重载"
          @click="openLexicon"
        >
          词库
        </button>
        <div class="inline-flex items-center gap-0.5 p-0.5 rounded-full bg-[var(--panel-2)]">
          <button
            class="px-2 py-0.5 rounded-full text-[11px] cursor-pointer transition-colors"
            :class="S.genre === 'fiction' ? 'font-medium' : 'text-[var(--text-faint)] hover:text-[var(--text-dim)]'"
            :style="S.genre === 'fiction' ? { color: 'var(--accent)' } : {}"
            @click="S.genre = 'fiction'"
          >小说正文</button>
          <button
            class="px-2 py-0.5 rounded-full text-[11px] cursor-pointer transition-colors"
            :class="S.genre === 'article' ? 'font-medium' : 'text-[var(--text-faint)] hover:text-[var(--text-dim)]'"
            :style="S.genre === 'article' ? { color: 'var(--accent)' } : {}"
            @click="S.genre = 'article'"
          >文章</button>
        </div>
      </div>
      <div v-if="signal.stats.chars" class="space-y-1.5">
        <div class="text-[10.5px] text-[var(--text-faint)] pt-0.5">
          {{ signal.stats.chars }} 字 · 均句长 {{ signal.stats.avgLen }} · 句长落差 CV {{ signal.stats.cv }}<template v-if="S.genre === 'fiction'"> · 对话占比 {{ Math.round(signal.stats.dialogueRatio * 100) }}%</template>
        </div>
        <div v-if="signal.warnings.length" class="space-y-1 pt-1 border-t border-[var(--border)]">
          <div v-for="(w, i) in signal.warnings" :key="i" class="text-[11px] leading-4" :style="{ color: w.startsWith('【待核查】') ? '#e08a7a' : 'var(--text-dim)' }">{{ w }}</div>
        </div>
      </div>
      <div v-else class="text-[11px] text-[var(--text-faint)]">章节无内容，写点什么再测</div>
    </div>

    <!-- 模式分段选择 + 修订范围 -->
    <div class="flex items-center gap-2 flex-wrap mb-3">
      <div class="inline-flex items-center gap-0.5 p-0.5 rounded-full bg-[var(--bg-soft)]">
        <button
          v-for="m in MODES"
          :key="m.k"
          class="px-3 py-1 rounded-full text-[12px] cursor-pointer transition-colors disabled:opacity-50"
          :class="S.mode === m.k ? 'bg-[var(--panel-2)] font-medium' : 'text-[var(--text-dim)] hover:text-[var(--text)]'"
          :style="S.mode === m.k ? { color: 'var(--accent)' } : {}"
          :disabled="S.running"
          @click="S.mode = m.k; run(m.id, m.target)"
        >
          {{ m.t }}
        </button>
      </div>
      <ToolSelect
        v-model="S.level"
        class="w-auto ml-auto"
        :disabled="S.running"
        :options="[
          { label: 'L1 轻度', value: 'L1' },
          { label: 'L2 标准', value: 'L2' },
          { label: 'L3 深度', value: 'L3' },
          { label: 'L4 极致', value: 'L4' }
        ]"
      />
    </div>

    <div v-if="S.running" class="flex items-center gap-3 py-2">
      <div class="tool-dots"><span /><span /><span /></div>
      <ToolButton variant="ghost" class="ml-auto" :disabled="!S.aborter" @click="stopRun">停止</ToolButton>
    </div>
    <div v-if="S.error" class="text-[12.5px] text-[#e08a7a]">{{ S.error }}</div>

    <!-- 诊断 / 评分报告 -->
    <div v-if="S.report" class="rounded-lg border border-[var(--border)] bg-[var(--bg-soft)] p-3 text-[13px] leading-6 whitespace-pre-wrap max-h-72 overflow-y-auto">{{ S.report }}</div>

    <!-- 改写结果 -->
    <template v-if="S.rewritten">
      <div>
        <div class="text-xs text-[var(--text-faint)] mb-1">改写结果（可直接修改）</div>
        <textarea v-model="S.rewritten" class="tool-textarea h-64 text-[15px] leading-8" />
      </div>
      <div class="flex justify-end gap-2">
        <ToolButton variant="ghost" @click="S.rewritten = ''">放弃</ToolButton>
        <ToolButton @click="applyRewrite">应用为整章内容</ToolButton>
      </div>
    </template>
  </div>
</template>
