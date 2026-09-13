/**
 * Webview-side script for the Chat Playground panel: model picker, message
 * list with incremental streaming render, an Agent-mode toggle, and a
 * stop-generation button.
 */
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();
const root = document.getElementById('root') as HTMLDivElement;

type ModelState = 'idle' | 'loading' | 'ready' | 'error';

let modelState: ModelState = 'idle';
let currentModel = '';
let currentMethod = '';
let agentMode = false;
let currentAssistantEl: HTMLDivElement | undefined;
let activeRequestId: string | undefined;
let generating = false;

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

let initialRenderDone = false;

/**
 * Renders the static shell once, then only ever patches the status text in
 * place. A full innerHTML rebuild on every modelState change would wipe the
 * transcript's streamed content mid-response.
 */
function render(): void {
  if (initialRenderDone) {
    const status = document.getElementById('status');
    if (status) status.textContent = statusText();
    updateControls();
    return;
  }
  initialRenderDone = true;

  root.innerHTML = `
    <div class="toolbar">
      <input id="model-input" list="model-list" placeholder="Local or Hugging Face model id…" />
      <datalist id="model-list"></datalist>
      <select id="method-select"><option value="">Automatic method</option></select>
      <button id="load-btn" type="button">Load</button>
      <label class="agent-toggle"><input type="checkbox" id="agent-toggle" ${agentMode ? 'checked' : ''} /> Agent mode</label>
      <span id="status" class="status">${escapeHtml(statusText())}</span>
    </div>
    <div id="transcript" class="transcript"></div>
    <div class="composer">
      <textarea id="prompt-input" placeholder="Message the model…" rows="3"></textarea>
      <button id="send-btn" type="button">Send</button>
      <button id="stop-btn" type="button" class="secondary">Stop</button>
    </div>
  `;

  document.getElementById('load-btn')?.addEventListener('click', () => {
    const input = document.getElementById('model-input') as HTMLInputElement;
    const method = (document.getElementById('method-select') as HTMLSelectElement).value;
    const model = input.value.trim();
    if (model) {
      currentModel = model;
      currentMethod = '';
      modelState = 'loading';
      render();
      vscode.postMessage({ type: 'loadModel', model, method: method || undefined });
    }
  });

  document.getElementById('agent-toggle')?.addEventListener('change', (e) => {
    agentMode = (e.target as HTMLInputElement).checked;
    vscode.postMessage({ type: 'setAgentMode', enabled: agentMode });
  });

  document.getElementById('send-btn')?.addEventListener('click', sendPrompt);
  document.getElementById('stop-btn')?.addEventListener('click', () => {
    if (activeRequestId) vscode.postMessage({ type: 'stopGeneration', requestId: activeRequestId });
  });
  updateControls();
}

function statusText(): string {
  if (generating) return `Generating with ${currentModel}…`;
  if (modelState === 'idle') return 'No model loaded.';
  if (modelState === 'loading') return `Loading ${currentModel}…`;
  if (modelState === 'ready') return `Ready: ${currentModel}${currentMethod ? ` · ${currentMethod}` : ''}`;
  return `Error loading ${currentModel}`;
}

function updateControls(): void {
  const busy = generating || modelState === 'loading';
  const disabledWhileGenerating = ['model-input', 'method-select', 'load-btn', 'agent-toggle'];
  for (const id of disabledWhileGenerating) {
    const control = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLButtonElement | null;
    if (control) control.disabled = busy;
  }
  const send = document.getElementById('send-btn') as HTMLButtonElement | null;
  if (send) send.disabled = generating || modelState !== 'ready';
  const stop = document.getElementById('stop-btn') as HTMLButtonElement | null;
  if (stop) stop.disabled = !generating;
}

function sendPrompt(): void {
  const input = document.getElementById('prompt-input') as HTMLTextAreaElement;
  const text = input.value.trim();
  if (!text || modelState !== 'ready') return;

  appendMessage('user', text);
  input.value = '';
  currentAssistantEl = appendMessage('assistant', '');
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  activeRequestId = requestId;
  generating = true;
  render();
  vscode.postMessage({ type: 'send', requestId, prompt: text });
}

function appendMessage(role: 'user' | 'assistant' | 'tool', text: string): HTMLDivElement {
  const transcript = document.getElementById('transcript') as HTMLDivElement;
  const el = document.createElement('div');
  el.className = `message ${role}`;
  el.textContent = text;
  transcript.appendChild(el);
  transcript.scrollTop = transcript.scrollHeight;
  return el;
}

function appendAgentStep(toolName: string, args: unknown, result: unknown): void {
  const transcript = document.getElementById('transcript') as HTMLDivElement;
  const details = document.createElement('details');
  details.className = 'agent-step';
  const summary = document.createElement('summary');
  summary.textContent = `used tool: ${toolName}`;
  details.appendChild(summary);
  const body = document.createElement('pre');
  body.textContent = JSON.stringify({ args, result }, null, 2);
  details.appendChild(body);
  transcript.appendChild(details);
  transcript.scrollTop = transcript.scrollHeight;
}

window.addEventListener('message', (event: MessageEvent<{ type: string; [key: string]: unknown }>) => {
  const message = event.data;
  switch (message.type) {
    case 'models': {
      const list = document.getElementById('model-list') as HTMLDataListElement | null;
      if (list) {
        const models = message.models as string[];
        list.innerHTML = models.map((m) => `<option value="${escapeHtml(m)}"></option>`).join('');
      }
      break;
    }
    case 'methods': {
      const select = document.getElementById('method-select') as HTMLSelectElement | null;
      if (select) {
        const methods = message.methods as Array<{ name: string; family: string; blurb: string }>;
        select.innerHTML = '<option value="">Automatic method</option>' + methods.map((method) =>
          `<option value="${escapeHtml(method.name)}" title="${escapeHtml(method.blurb)}">${escapeHtml(method.name)} · ${escapeHtml(method.family)}</option>`
        ).join('');
      }
      break;
    }
    case 'modelState':
      modelState = message.state as ModelState;
      currentModel = (message.model as string) ?? currentModel;
      currentMethod = (message.method as string) ?? currentMethod;
      if (modelState === 'error') {
        appendMessage('tool', `Error: ${message.message as string}`);
      }
      render();
      break;
    case 'generationStarted':
      if (message.requestId === activeRequestId) {
        generating = true;
        render();
      }
      break;
    case 'assistantChunk':
      if (message.requestId === activeRequestId && currentAssistantEl) {
        currentAssistantEl.textContent += message.text as string;
      }
      break;
    case 'agentStep':
      if (message.requestId === activeRequestId) {
        appendAgentStep(message.toolName as string, message.args, message.result);
      }
      break;
    case 'generationFinished':
      if (message.requestId === activeRequestId) {
        generating = false;
        if (message.outcome === 'cancelled') appendMessage('tool', 'Generation cancelled.');
        if (message.outcome === 'failed') appendMessage('tool', `Error: ${message.message as string}`);
        activeRequestId = undefined;
        currentAssistantEl = undefined;
        render();
      }
      break;
    case 'error':
      appendMessage('tool', `Error: ${message.message as string}`);
      break;
    default:
      break;
  }
});

render();
vscode.postMessage({ type: 'ready' });
