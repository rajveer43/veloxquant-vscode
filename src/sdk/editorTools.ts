/**
 * Two read-only, editor-native example tools for the Agent-mode demo in the
 * Chat Playground — the part only an editor extension can uniquely offer,
 * distinct from what the bare SDK's own examples/agent.ts already
 * demonstrates.
 *
 * Deliberately does NOT include a file-write or shell-exec tool: an agent
 * that can execute arbitrary code or overwrite files based on model output
 * needs a real, separate confirmation-and-sandboxing design; that is out of
 * scope for this first demonstration phase and must not be added without a
 * dedicated design pass and explicit maintainer sign-off.
 */
import * as vscode from 'vscode';
import type { ToolSpec } from '@veloxquant/sdk' with { 'resolution-mode': 'require' };

export const readActiveFileTool: ToolSpec<Record<string, never>> = {
  name: 'read_active_file',
  description: "Returns the active editor's file path and full text content.",
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  execute: () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return { error: 'No active editor.' };
    }
    return {
      path: vscode.workspace.asRelativePath(editor.document.uri),
      content: editor.document.getText(),
    };
  },
};

export const listWorkspaceFilesTool: ToolSpec<{ glob: string }> = {
  name: 'list_workspace_files',
  description: 'Lists workspace file paths matching a glob (e.g. "**/*.ts"), respecting .gitignore/files.exclude.',
  parameters: {
    type: 'object',
    properties: { glob: { type: 'string', description: 'Glob pattern, e.g. "src/**/*.ts".' } },
    required: ['glob'],
    additionalProperties: false,
  },
  execute: async ({ glob }) => {
    const uris = await vscode.workspace.findFiles(glob, undefined, 200);
    return { paths: uris.map((u) => vscode.workspace.asRelativePath(u)) };
  },
};

export function registerEditorTools(register: (spec: ToolSpec<never>) => void): void {
  register(readActiveFileTool as ToolSpec<never>);
  register(listWorkspaceFilesTool as ToolSpec<never>);
}
