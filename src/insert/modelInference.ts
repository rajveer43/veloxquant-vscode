/**
 * Editor-facing wrapper around modelShape.ts: finds the active (or first
 * open) Python editor and infers n_layers/head_dim from its text.
 */
import * as vscode from 'vscode';
import { inferModelShapeFromText, InferredModelShape } from './modelShape';

export type { InferredModelShape } from './modelShape';

function findActivePythonEditor(): vscode.TextEditor | undefined {
  const active = vscode.window.activeTextEditor;
  if (active && active.document.languageId === 'python') {
    return active;
  }
  return vscode.window.visibleTextEditors.find((e) => e.document.languageId === 'python');
}

export function inferModelShapeFromActiveEditor(): InferredModelShape | undefined {
  const editor = findActivePythonEditor();
  if (!editor) return undefined;
  return inferModelShapeFromText(editor.document.getText());
}
