/**
 * Chooses where "Insert into editor" writes the generated snippet:
 *   - If the active editor is a .py file, use it directly.
 *   - Else, if other open Python documents look like they use mlx_lm /
 *     veloxquant_mlx (cheap text scan, not an AST parse), offer a QuickPick.
 *   - Else, fall back to clipboard.
 */
import * as vscode from 'vscode';

const RELEVANT_IMPORT_PATTERN = /\b(import\s+mlx_lm|from\s+mlx_lm|import\s+veloxquant_mlx|from\s+veloxquant_mlx)\b/;

export function looksRelevant(text: string): boolean {
  return RELEVANT_IMPORT_PATTERN.test(text);
}

export interface InsertTarget {
  kind: 'active-editor' | 'picked-editor' | 'clipboard';
  editor?: vscode.TextEditor;
}

function findCandidateEditors(): vscode.TextEditor[] {
  return vscode.window.visibleTextEditors.filter(
    (e) => e.document.languageId === 'python' && looksRelevant(e.document.getText())
  );
}

export async function pickInsertTarget(): Promise<InsertTarget> {
  const active = vscode.window.activeTextEditor;
  if (active && active.document.languageId === 'python') {
    return { kind: 'active-editor', editor: active };
  }

  const candidates = findCandidateEditors();
  if (candidates.length === 0) {
    return { kind: 'clipboard' };
  }

  const items = candidates.map((editor) => ({
    label: editor.document.fileName.split('/').pop() ?? editor.document.fileName,
    description: editor.document.uri.fsPath,
    editor,
  }));
  items.push({ label: '$(clippy) Copy to clipboard instead', description: '', editor: undefined as unknown as vscode.TextEditor });

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Insert VeloxQuant-MLX snippet into…',
    placeHolder: 'Choose an open Python file, or copy to clipboard',
  });

  if (!picked || !picked.editor) {
    return { kind: 'clipboard' };
  }
  return { kind: 'picked-editor', editor: picked.editor };
}

export async function insertSnippet(target: InsertTarget, snippet: string): Promise<void> {
  if (target.kind === 'clipboard' || !target.editor) {
    await vscode.env.clipboard.writeText(snippet);
    void vscode.window.showInformationMessage('VeloxQuant-MLX snippet copied to clipboard.');
    return;
  }

  const editor = target.editor;
  const position = editor.selection.active;
  await editor.edit((editBuilder) => {
    editBuilder.insert(position, snippet);
  });
  await vscode.window.showTextDocument(editor.document, editor.viewColumn);
}
