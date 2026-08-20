/**
 * Webview-side script for the Recommend sidebar. Runs in a browser-like
 * context (no Node, no direct VS Code API) and talks to the extension host
 * exclusively via postMessage.
 */

// Minimal ambient declaration for the VS Code webview API injected at
// runtime; avoids depending on @types/vscode-webview just for this.
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

interface RecommendFormValues {
  chip: string;
  ramGb: number;
  modelClass: string;
  goal: string;
  seqLen?: number;
  nLayers?: number;
  nKvHeads?: number;
  headDim?: number;
}

const form = document.getElementById('recommend-form') as HTMLFormElement;
const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement;
const resultEl = document.getElementById('result') as HTMLDivElement;
const errorEl = document.getElementById('error-area') as HTMLDivElement;
const platformNoticeEl = document.getElementById('platform-notice') as HTMLDivElement;

function optionalInt(id: string): number | undefined {
  const el = document.getElementById(id) as HTMLInputElement;
  if (!el.value.trim()) return undefined;
  const n = Number(el.value);
  return Number.isFinite(n) ? n : undefined;
}

function readForm(): RecommendFormValues {
  const chip = (form.querySelector('input[name="chip"]:checked') as HTMLInputElement).value;
  const ramGb = Number((document.getElementById('ram-gb') as HTMLSelectElement).value);
  const modelClass = (document.getElementById('model-class') as HTMLSelectElement).value;
  const goal = (document.getElementById('goal') as HTMLSelectElement).value;
  return {
    chip,
    ramGb,
    modelClass,
    goal,
    seqLen: optionalInt('seq-len'),
    nLayers: optionalInt('n-layers'),
    nKvHeads: optionalInt('n-kv-heads'),
    headDim: optionalInt('head-dim'),
  };
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  errorEl.hidden = true;
  resultEl.hidden = true;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Working…';
  vscode.postMessage({ type: 'submit', values: readForm() });
});

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function renderResult(payload: {
  response: {
    recommendation: {
      method: string;
      knobs: Record<string, string | number | boolean>;
      key_accounting_ratio: number;
      resident_savings_likely: boolean;
      kv_fp16_mb: number;
      kv_compressed_mb_estimate: number;
      warnings: string[];
      rationale: string;
    };
  };
  docsUrl?: string;
}): void {
  submitBtn.disabled = false;
  submitBtn.textContent = 'Get recommendation';
  const rec = payload.response.recommendation;

  const heading = payload.docsUrl
    ? `<a href="${escapeHtml(payload.docsUrl)}" target="_blank" rel="noopener">${escapeHtml(rec.method)}</a>`
    : escapeHtml(rec.method);

  const badgeClass = rec.resident_savings_likely ? 'badge-green' : 'badge-amber';
  const badgeText = rec.resident_savings_likely
    ? 'Also reduces live RAM'
    : 'Accounting only — RAM usage likely unchanged';

  resultEl.innerHTML = `
    <div class="method-heading">${heading}</div>
    <div class="ratio-stat">${rec.key_accounting_ratio}x<span class="label">key accounting ratio</span></div>
    <div><span class="badge ${badgeClass}">${badgeText}</span></div>
    ${
      rec.warnings.length
        ? `<ul class="warnings">${rec.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>`
        : ''
    }
    <div class="rationale">${escapeHtml(rec.rationale)}</div>
    <div class="before-after">
      <div><span class="value">${rec.kv_fp16_mb} MB</span><br />fp16</div>
      <div>→</div>
      <div><span class="value">${rec.kv_compressed_mb_estimate} MB</span><br />compressed (estimate)</div>
    </div>
    <div class="estimate-note">Sizes are estimates based on the request shape, not a live measurement.</div>
    <div class="actions">
      <button id="insert-btn" type="button">Insert into editor</button>
      <button id="copy-cmd-btn" type="button" class="secondary">Copy CLI command</button>
    </div>
  `;
  resultEl.hidden = false;

  document.getElementById('insert-btn')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'insert', method: rec.method, knobs: rec.knobs });
  });
  document.getElementById('copy-cmd-btn')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'copyCommand' });
  });
}

function renderError(payload: { kind: string; message: string; stderr?: string; interpreterPath?: string }): void {
  submitBtn.disabled = false;
  submitBtn.textContent = 'Get recommendation';

  let body = '';
  switch (payload.kind) {
    case 'module-not-found':
      body = `
        <p><strong>VeloxQuant-MLX is not installed</strong> in the resolved interpreter${
          payload.interpreterPath ? ` (<code>${escapeHtml(payload.interpreterPath)}</code>)` : ''
        }.</p>
        <div class="actions">
          <button id="install-btn" type="button">Install VeloxQuant-MLX</button>
        </div>
      `;
      break;
    case 'no-interpreter':
      body = `
        <p><strong>No Python interpreter resolved.</strong> Select one to continue.</p>
        <div class="actions">
          <button id="select-interpreter-btn" type="button">Select Interpreter</button>
        </div>
      `;
      break;
    case 'unsupported-flag':
      body = `
        <p><strong>Installed VeloxQuant-MLX version is too old.</strong> This extension needs 0.42.0 or newer for <code>recommend --json</code>.</p>
        <div class="actions">
          <button id="upgrade-btn" type="button">Upgrade VeloxQuant-MLX</button>
        </div>
      `;
      break;
    case 'non-darwin':
      body = `<p>VeloxQuant-MLX targets Apple Silicon Macs. This sidebar remains available, but CLI calls will not work on this host.</p>`;
      break;
    default:
      body = `
        <p>${escapeHtml(payload.message)}</p>
        <details>
          <summary>Details</summary>
          <pre>${escapeHtml(payload.stderr ?? '')}</pre>
        </details>
        <div class="actions">
          <button id="report-issue-btn" type="button" class="secondary">Report an issue</button>
        </div>
      `;
  }

  errorEl.innerHTML = body;
  errorEl.hidden = false;

  document.getElementById('install-btn')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'installPackage' });
  });
  document.getElementById('select-interpreter-btn')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'selectInterpreter' });
  });
  document.getElementById('upgrade-btn')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'upgradePackage' });
  });
  document.getElementById('report-issue-btn')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'reportIssue', stderr: payload.stderr ?? '' });
  });
}

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as { type: string; [key: string]: unknown };
  switch (msg.type) {
    case 'result':
      renderResult(msg as unknown as Parameters<typeof renderResult>[0]);
      break;
    case 'error':
      renderError(msg as unknown as Parameters<typeof renderError>[0]);
      break;
    case 'retryReady':
      submitBtn.disabled = false;
      submitBtn.textContent = 'Get recommendation';
      break;
    case 'platformNotice':
      platformNoticeEl.textContent = msg.message as string;
      platformNoticeEl.hidden = false;
      break;
    case 'prefill': {
      const values = msg.values as Partial<RecommendFormValues>;
      if (values.chip) {
        const radio = form.querySelector(`input[name="chip"][value="${values.chip}"]`) as HTMLInputElement | null;
        if (radio) radio.checked = true;
      }
      if (values.ramGb) {
        (document.getElementById('ram-gb') as HTMLSelectElement).value = String(values.ramGb);
      }
      break;
    }
    default:
      break;
  }
});

vscode.postMessage({ type: 'ready' });

export {};
