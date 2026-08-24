/**
 * Webview-side script for the Compression Lab panel. It hosts either:
 *  - an <iframe> pointed at the local control-plane server, or
 *  - a message telling the user to open the hosted playground externally
 *    (iframe embedding of the hosted page is not attempted without a
 *    verified CSP/X-Frame-Options check).
 */
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

const root = document.getElementById('root') as HTMLDivElement;

function renderLoading(): void {
  root.innerHTML = `<div class="center"><p>Starting the VeloxQuant-MLX compression lab…</p></div>`;
}

function renderLocal(url: string): void {
  root.innerHTML = `<iframe id="lab-frame" src="${url}" title="VeloxQuant-MLX Compression Lab"></iframe>`;
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function renderUnavailable(message: string): void {
  root.innerHTML = `
    <div class="center">
      <p>${escapeHtml(message)}</p>
      <div class="actions">
        <button id="retry-btn" type="button">Retry local server</button>
        <button id="hosted-btn" type="button" class="secondary">Use hosted version instead</button>
      </div>
    </div>
  `;
  document.getElementById('retry-btn')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'retry' });
  });
  document.getElementById('hosted-btn')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'openHosted' });
  });
}

function renderNotInstalled(interpreterPath: string): void {
  root.innerHTML = `
    <div class="center">
      <p><strong>VeloxQuant-MLX is not installed</strong> in the resolved interpreter (<code>${escapeHtml(
        interpreterPath
      )}</code>).</p>
      <div class="actions">
        <button id="install-btn" type="button">Install VeloxQuant-MLX</button>
        <button id="hosted-btn" type="button" class="secondary">Use hosted version instead</button>
      </div>
    </div>
  `;
  document.getElementById('install-btn')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'installPackage' });
  });
  document.getElementById('hosted-btn')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'openHosted' });
  });
}

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as { type: string; [key: string]: unknown };
  switch (msg.type) {
    case 'loading':
      renderLoading();
      break;
    case 'ready':
      renderLocal(msg.url as string);
      break;
    case 'unavailable':
      renderUnavailable(msg.message as string);
      break;
    case 'not-installed':
      renderNotInstalled(msg.interpreterPath as string);
      break;
    default:
      break;
  }
});

renderLoading();
vscode.postMessage({ type: 'ready' });

export {};
