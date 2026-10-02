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
const inferBtn = document.getElementById('infer-btn') as HTMLButtonElement;
const inferNoteEl = document.getElementById('infer-note') as HTMLDivElement;
const openLabLink = document.getElementById('open-lab-link') as HTMLAnchorElement;

const autoForm = document.getElementById('auto-form') as HTMLFormElement;
const autoSubmitBtn = document.getElementById('auto-submit-btn') as HTMLButtonElement;
const autoCancelBtn = document.getElementById('auto-cancel-btn') as HTMLButtonElement;
const memoryBtn = document.getElementById('memory-btn') as HTMLButtonElement;
const memoryEl = document.getElementById('memory-result') as HTMLDivElement;
const chipNoteEl = document.getElementById('chip-note') as HTMLDivElement;

function currentMode(): 'manual' | 'auto' {
  return (document.querySelector('input[name="mode"]:checked') as HTMLInputElement).value === 'auto' ? 'auto' : 'manual';
}

function clearOutputs(): void {
  errorEl.hidden = true;
  resultEl.hidden = true;
  memoryEl.hidden = true;
}

document.querySelectorAll('input[name="mode"]').forEach((el) => {
  el.addEventListener('change', () => {
    const auto = currentMode() === 'auto';
    form.hidden = auto;
    autoForm.hidden = !auto;
    clearOutputs();
  });
});

document.getElementById('auto-pick-btn')?.addEventListener('click', () => {
  vscode.postMessage({ type: 'pickConfig' });
});

function readAutoForm(): Record<string, unknown> {
  return {
    modelConfigPath: (document.getElementById('auto-config') as HTMLInputElement).value || undefined,
    objective: (document.getElementById('auto-objective') as HTMLSelectElement).value,
    context: optionalInt('auto-context'),
    generation: optionalInt('auto-generation'),
    probe: (document.getElementById('auto-probe') as HTMLInputElement).checked,
  };
}

function setAutoBusy(busy: boolean): void {
  autoSubmitBtn.disabled = busy;
  memoryBtn.disabled = busy;
  autoCancelBtn.hidden = !busy;
  autoSubmitBtn.textContent = busy ? 'Working…' : 'Get Auto recommendation';
}

autoForm.addEventListener('submit', (e) => {
  e.preventDefault();
  clearOutputs();
  setAutoBusy(true);
  vscode.postMessage({ type: 'submitAuto', values: readAutoForm() });
});

autoCancelBtn.addEventListener('click', () => {
  vscode.postMessage({ type: 'cancelAuto' });
});

memoryBtn.addEventListener('click', () => {
  errorEl.hidden = true;
  memoryEl.hidden = true;
  vscode.postMessage({ type: 'estimateMemory', values: readAutoForm() });
});

function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
}

interface AutoMemoryPayload {
  baselineBytes: number;
  compressedBytes: number;
  residentBytes: number;
  savingsPercent: number;
  confidence?: string;
  assumptions: string[];
}

function renderAutoResult(payload: {
  result: { fallbackUsed: boolean; ranked: { method: string; score: number; memory?: AutoMemoryPayload; warnings: string[] }[] };
}): void {
  setAutoBusy(false);
  const { ranked, fallbackUsed } = payload.result;
  if (!ranked.length) {
    resultEl.innerHTML = '<p>No strategies were ranked for this model and workload.</p>';
    resultEl.hidden = false;
    return;
  }
  resultEl.innerHTML = `
    ${fallbackUsed ? '<div class="notice notice-warning">Hardware probe unavailable — ranking used fallback defaults.</div>' : ''}
    <ul class="ranked">${ranked
      .map(
        (r, i) => `<li><label>
          <input type="radio" name="auto-method" value="${escapeHtml(r.method)}" ${i === 0 ? 'checked' : ''} />
          <strong>${escapeHtml(r.method)}</strong> <span class="estimate-note">score ${r.score.toFixed(2)}</span>
          ${
            r.memory
              ? `<div>${r.memory.savingsPercent.toFixed(0)}% KV savings (${formatBytes(r.memory.baselineBytes)} → ${formatBytes(r.memory.compressedBytes)})${
                  r.memory.confidence ? ` · confidence: ${escapeHtml(r.memory.confidence)}` : ''
                }</div>`
              : ''
          }
          ${r.warnings.length ? `<ul class="warnings">${r.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : ''}
        </label></li>`
      )
      .join('')}</ul>
    <div class="actions"><button id="auto-insert-btn" type="button">Insert selected into editor</button></div>
  `;
  resultEl.hidden = false;
  document.getElementById('auto-insert-btn')?.addEventListener('click', () => {
    const selected = resultEl.querySelector('input[name="auto-method"]:checked') as HTMLInputElement | null;
    if (selected) vscode.postMessage({ type: 'insert', method: selected.value, knobs: {} });
  });
}

function renderMemoryResult(payload: {
  result: { strategies: (AutoMemoryPayload & { method: string })[] };
}): void {
  const rows = [...payload.result.strategies].sort((a, b) => b.savingsPercent - a.savingsPercent);
  if (!rows.length) {
    memoryEl.innerHTML = '<p>No memory estimates returned.</p>';
  } else {
    memoryEl.innerHTML = `
      <table class="mem-table">
        <thead><tr><th>Strategy</th><th>Baseline</th><th>Compressed</th><th>Resident</th><th>Saved</th></tr></thead>
        <tbody>${rows
          .map(
            (r) =>
              `<tr title="${escapeHtml(r.assumptions.join('; '))}"><td>${escapeHtml(r.method)}</td><td>${formatBytes(r.baselineBytes)}</td><td>${formatBytes(
                r.compressedBytes
              )}</td><td>${formatBytes(r.residentBytes)}</td><td>${r.savingsPercent.toFixed(0)}%</td></tr>`
          )
          .join('')}</tbody>
      </table>
      <div class="estimate-note">Analytic estimates before weights are loaded; hover a row for assumptions.</div>`;
  }
  memoryEl.hidden = false;
}

openLabLink.addEventListener('click', (e) => {
  e.preventDefault();
  vscode.postMessage({ type: 'open' });
});

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

inferBtn.addEventListener('click', () => {
  vscode.postMessage({ type: 'infer' });
});

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

  const knobEntries = Object.entries(rec.knobs);

  resultEl.innerHTML = `
    <div class="method-heading">${heading}</div>
    <div class="ratio-stat">${rec.key_accounting_ratio}x<span class="label">key accounting ratio</span></div>
    <div><span class="badge ${badgeClass}">${badgeText}</span></div>
    ${
      knobEntries.length
        ? `<ul class="knobs">${knobEntries
            .map(([k, v]) => `<li><span class="knob-key">${escapeHtml(k)}</span>: ${escapeHtml(String(v))}</li>`)
            .join('')}</ul>`
        : ''
    }
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
  setAutoBusy(false);

  let body = '';
  switch (payload.kind) {
    case 'feature-needs-upgrade':
      body = `
        <p><strong>Upgrade VeloxQuant-MLX to use this feature.</strong> ${escapeHtml(payload.message)}</p>
        <div class="actions">
          <button id="upgrade-btn" type="button">Upgrade VeloxQuant-MLX</button>
        </div>
      `;
      break;
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
    case 'invalid-choice':
      body = `
        <p><strong>This configuration isn't supported by your installed VeloxQuant-MLX.</strong> Try a different chip or RAM size — upgrading will not fix this.</p>
        <details>
          <summary>Details</summary>
          <pre>${escapeHtml(payload.stderr ?? '')}</pre>
        </details>
      `;
      break;
    case 'flag-not-supported':
      body = `
        <p><strong>This request isn't supported by your installed VeloxQuant-MLX</strong> — it's already up to date, so upgrading will not fix this.</p>
        <details>
          <summary>Details</summary>
          <pre>${escapeHtml(payload.stderr ?? '')}</pre>
        </details>
        <div class="actions">
          <button id="report-issue-btn" type="button" class="secondary">Report an issue</button>
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
    case 'autoResult':
      renderAutoResult(msg as unknown as Parameters<typeof renderAutoResult>[0]);
      break;
    case 'memoryResult':
      renderMemoryResult(msg as unknown as Parameters<typeof renderMemoryResult>[0]);
      break;
    case 'autoCancelled':
      setAutoBusy(false);
      break;
    case 'configPicked':
      (document.getElementById('auto-config') as HTMLInputElement).value = msg.path as string;
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
      const note = msg.chipNote as string | undefined;
      chipNoteEl.textContent = note ?? '';
      chipNoteEl.hidden = !note;
      if (values.ramGb) {
        (document.getElementById('ram-gb') as HTMLSelectElement).value = String(values.ramGb);
      }
      break;
    }
    case 'inferAvailable':
      inferBtn.hidden = false;
      break;
    case 'inferResult': {
      const values = msg.values as Partial<RecommendFormValues> | undefined;
      if (!values || (values.nLayers === undefined && values.headDim === undefined)) {
        inferNoteEl.textContent = 'Could not infer model shape from the active file.';
        inferNoteEl.hidden = false;
        break;
      }
      if (values.nLayers !== undefined) {
        (document.getElementById('n-layers') as HTMLInputElement).value = String(values.nLayers);
      }
      if (values.headDim !== undefined) {
        (document.getElementById('head-dim') as HTMLInputElement).value = String(values.headDim);
      }
      const source = (msg.source as string | undefined) ?? 'active file';
      inferNoteEl.textContent = `Inferred from ${source}.`;
      inferNoteEl.hidden = false;
      break;
    }
    default:
      break;
  }
});

vscode.postMessage({ type: 'ready' });

export {};
