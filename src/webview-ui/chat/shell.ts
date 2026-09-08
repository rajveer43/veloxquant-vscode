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
let agentMode = false;
let currentAssistantEl: HTMLDivElement | undefined;

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
    return;
  }
  initialRenderDone = true;

  root.innerHTML = `
    <div class="toolbar">
      <select id="model-select"><option value="">Select a local model…</option></select>
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
    const select = document.getElementById('model-select') as HTMLSelectElement;
    if (select.value) {
      vscode.postMessage({ type: 'loadModel', model: select.value });
    }
  });

  document.getElementById('agent-toggle')?.addEventListener('change', (e) => {
    agentMode = (e.target as HTMLInputElement).checked;
    vscode.postMessage({ type: 'setAgentMode', enabled: agentMode });
  });

  document.getElementById('send-btn')?.addEventListener('click', sendPrompt);
  document.getElementById('stop-btn')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'stopGeneration' });
  });
}

function statusText(): string {
  if (modelState === 'idle') return 'No model loaded.';
  if (modelState === 'loading') return `Loading ${currentModel}…`;
  if (modelState === 'ready') return `Ready: ${currentModel}`;
  return `Error loading ${currentModel}`;
}

function sendPrompt(): void {
  const input = document.getElementById('prompt-input') as HTMLTextAreaElement;
  const text = input.value.trim();
  if (!text || modelState !== 'ready') return;

  appendMessage('user', text);
  input.value = '';
  currentAssistantEl = appendMessage('assistant', '');
  vscode.postMessage({ type: 'send', prompt: text });
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
      const select = document.getElementById('model-select') as HTMLSelectElement | null;
      if (select) {
        const models = message.models as string[];
        select.innerHTML =
          '<option value="">Select a local model…</option>' +
          models.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
      }
      break;
    }
    case 'modelState':
      modelState = message.state as ModelState;
      currentModel = (message.model as string) ?? currentModel;
      if (modelState === 'error') {
        appendMessage('tool', `Error: ${message.message as string}`);
      }
      render();
      break;
    case 'assistantChunk':
      if (currentAssistantEl) {
        currentAssistantEl.textContent += message.text as string;
      }
      break;
    case 'agentStep':
      appendAgentStep(message.toolName as string, message.args, message.result);
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
