<script setup lang="ts">
// A native text field for the terminal: soft-keyboard autocorrect, swipe
// typing, dictation and long-press paste all work here, unlike in xterm.js's
// hidden input. "Send" pastes the text and presses Enter; "Insert" only
// pastes it.

const props = defineProps<{
  /** Optional hint shown above the field (e.g. why it opened). */
  hint?: string | null;
}>();

const emit = defineEmits<{
  send: [text: string, submit: boolean];
  close: [];
}>();

const MAX_HEIGHT_PX = 140;

const text = ref('');
const field = ref<HTMLTextAreaElement | null>(null);

function autosize() {
  const el = field.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
}

function submit(withEnter: boolean) {
  if (!text.value) return;
  emit('send', text.value, withEnter);
  text.value = '';
  nextTick(() => {
    autosize();
    field.value?.focus();
  });
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    submit(true);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
  }
}

watch(text, () => nextTick(autosize));

onMounted(() => {
  nextTick(() => field.value?.focus());
});

defineExpose({ focus: () => field.value?.focus() });
</script>

<template>
  <div class="term-composer" data-testid="terminal-composer">
    <p v-if="props.hint" class="term-composer-hint">{{ props.hint }}</p>
    <div class="term-composer-row">
      <textarea
        ref="field"
        v-model="text"
        rows="1"
        class="term-composer-field"
        placeholder="Type a command or prompt…"
        aria-label="Text to send to the terminal"
        autocapitalize="off"
        enterkeyhint="enter"
        @keydown="onKeydown"
      />
      <button
        type="button"
        class="term-composer-btn"
        aria-label="Insert without Enter"
        title="Insert without pressing Enter"
        :disabled="!text"
        @mousedown.prevent
        @click="submit(false)"
      >
        <UIcon name="i-lucide-text-cursor-input" class="size-4" />
      </button>
      <button
        type="button"
        class="term-composer-btn term-composer-send"
        aria-label="Send"
        title="Send (Ctrl/Cmd+Enter)"
        :disabled="!text"
        @mousedown.prevent
        @click="submit(true)"
      >
        <UIcon name="i-lucide-send-horizontal" class="size-4" />
      </button>
      <button
        type="button"
        class="term-composer-btn"
        aria-label="Close composer"
        title="Close"
        @mousedown.prevent
        @click="emit('close')"
      >
        <UIcon name="i-lucide-x" class="size-4" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.term-composer {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  background: var(--terminal-bar-bg);
  border-top: 1px solid var(--terminal-bar-border);
}

.term-composer-hint {
  margin: 0 2px;
  font-size: 12px;
  color: var(--terminal-text-muted);
}

.term-composer-row {
  display: flex;
  align-items: flex-end;
  gap: 4px;
}

.term-composer-field {
  flex: 1;
  min-width: 0;
  resize: none;
  max-height: 140px;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--terminal-input-border);
  background: var(--terminal-input-bg);
  color: var(--terminal-text);
  font-family: Menlo, ui-monospace, monospace;
  /* 16px: iOS zooms the page into any smaller focused field. */
  font-size: 16px;
  line-height: 1.35;
  outline: none;
}

.term-composer-field:focus {
  border-color: var(--terminal-accent);
}

.term-composer-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 8px;
  border: 1px solid var(--terminal-input-border);
  background: var(--terminal-input-bg);
  color: var(--terminal-text-muted);
  cursor: pointer;
  touch-action: manipulation;
}

.term-composer-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.term-composer-send:not(:disabled) {
  background: var(--terminal-accent);
  border-color: var(--terminal-accent);
  color: #fff;
}

.term-composer-btn:focus-visible {
  outline: 2px solid var(--terminal-accent);
  outline-offset: 1px;
}
</style>
