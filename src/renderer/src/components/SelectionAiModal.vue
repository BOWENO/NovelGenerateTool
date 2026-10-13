<script setup lang="ts">
import { ref, watch } from 'vue'
import ToolModal from '../ui/ToolModal.vue'
import ToolButton from '../ui/ToolButton.vue'
import ToolSelect from '../ui/ToolSelect.vue'
import { aiRun } from '../ai'

const props = defineProps<{ open: boolean; action: string; text: string }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'apply', text: string): void }>()

const result = ref('')
const running = ref(false)
const error = ref('')
const instruction = ref('')
const level = ref('L2')
let aborter: { abort: () => void } | null = null

const TITLES: Record<string, string> = {
  polish: '润色',
  expand: '扩写',
  fix: '纠错',
  deai: '风格检查',
  custom: '自定义指令'
}

async function run() {
  running.value = true
  error.value = ''
  result.value = ''
  const map: Record<string, string> = { polish: 'ed-polish', expand: 'ed-expand', fix: 'ed-fix', deai: 'deai-rewrite' }
  const promptId = map[props.action] || 'ed-polish'
  aborter = aiRun(
    props.action === 'deai' ? 'deai' : 'selection',
    promptId,
    {
      input: props.text,
      instruction: instruction.value || '请按你的理解优化这段文本'
    },
    {
      deaiLevel: level.value,
      onChunk: (c) => (result.value += c)
    }
  )
  try {
    await aborter.promise
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    running.value = false
    aborter = null
  }
}

watch(
  () => props.open,
  (v) => {
    if (!v) {
      aborter?.abort()
      result.value = ''
      error.value = ''
      instruction.value = ''
      return
    }
    // 打开即运行（自定义指令除外）
    if (props.action !== 'custom') void run()
  }
)

function apply() {
  if (!result.value.trim()) return
  emit('apply', result.value.trim())
  emit('close')
}
</script>

<template>
  <ToolModal :open="props.open" :title="TITLES[props.action] || 'AI 处理'" wide @close="emit('close')">
    <div class="space-y-4">
      <div v-if="props.action === 'deai'" class="flex items-center gap-2 text-sm">
        <span class="text-[var(--text-dim)]">修订范围</span>
        <ToolSelect
          v-model="level"
          class="w-auto"
          :disabled="running"
          :options="[
            { label: 'L1 轻度', value: 'L1' },
            { label: 'L2 标准', value: 'L2' },
            { label: 'L3 深度', value: 'L3' },
            { label: 'L4 极致', value: 'L4' }
          ]"
        />
        <ToolButton v-if="!running && (result || error)" variant="ghost" @click="run">重新生成</ToolButton>
      </div>

      <div v-if="props.action === 'custom'" class="flex gap-2">
        <input v-model="instruction" class="tool-input" placeholder="输入自定义指令，例如：把对话改得更口语化" @keyup.enter="run" />
        <ToolButton :disabled="running" @click="run">执行</ToolButton>
      </div>

      <div v-if="running && !result" class="tool-dots py-6 text-center"><span /><span /><span /></div>
      <div v-if="error" class="text-sm text-[#e08a7a]">{{ error }}</div>

      <div v-if="result || !running" class="grid gap-3" :class="result ? 'grid-cols-2' : 'grid-cols-1'">
        <div v-if="result">
          <div class="text-xs text-[var(--text-faint)] mb-1">AI 结果（可修改）</div>
          <textarea v-model="result" class="tool-textarea h-56 text-[15px] leading-8" />
        </div>
        <div v-if="result">
          <div class="text-xs text-[var(--text-faint)] mb-1">原文</div>
          <div class="tool-textarea h-56 overflow-y-auto text-[15px] leading-8 opacity-70" style="resize: vertical">{{ props.text }}</div>
        </div>
      </div>

      <div v-if="result" class="flex justify-end gap-2">
        <ToolButton variant="ghost" @click="emit('close')">放弃</ToolButton>
        <ToolButton @click="apply">替换选区</ToolButton>
      </div>
    </div>
  </ToolModal>
</template>
