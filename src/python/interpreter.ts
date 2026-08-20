/**
 * Resolves the Python interpreter to invoke veloxquant_mlx with.
 *
 * Priority order:
 *   1. `veloxquant.pythonPath` setting, if the user set one explicitly.
 *   2. The active interpreter reported by the ms-python.python extension,
 *      using whichever of its API shapes is available (the API has changed
 *      across versions, so this is feature-detected rather than assumed).
 *   3. Nothing resolved -> caller should prompt `python.setInterpreter`.
 *
 * We deliberately never fall back to a bare `python3` on PATH: a user who
 * has a venv or conda env selected in VS Code but a different (or absent)
 * global `python3` is exactly the case this extension must not silently
 * get wrong.
 */
import * as vscode from 'vscode';

export interface InterpreterResolution {
  /** Absolute path to a Python interpreter, or undefined if none resolved. */
  path: string | undefined;
  /** Where the path came from, for diagnostics / "Copy CLI command". */
  source: 'setting' | 'python-extension' | 'none';
}

interface PythonExtensionApiV2 {
  environments?: {
    getActiveEnvironmentPath?: (resource?: vscode.Uri) => { path: string } | undefined;
    resolveEnvironment?: (
      env: { path: string } | string
    ) => Promise<{ executable?: { uri?: vscode.Uri } } | undefined>;
  };
  settings?: {
    getExecutionDetails?: (resource?: vscode.Uri) => { execCommand?: string[] | undefined };
  };
}

async function resolveFromPythonExtension(): Promise<string | undefined> {
  const ext = vscode.extensions.getExtension<PythonExtensionApiV2>('ms-python.python');
  if (!ext) {
    return undefined;
  }
  try {
    const api = ext.isActive ? ext.exports : await ext.activate();
    if (!api) {
      return undefined;
    }

    // Newer API (environments.getActiveEnvironmentPath + resolveEnvironment).
    if (api.environments?.getActiveEnvironmentPath) {
      const envPath = api.environments.getActiveEnvironmentPath();
      if (envPath?.path) {
        if (api.environments.resolveEnvironment) {
          try {
            const resolved = await api.environments.resolveEnvironment(envPath);
            const uri = resolved?.executable?.uri;
            if (uri?.fsPath) {
              return uri.fsPath;
            }
          } catch {
            // fall through to the raw envPath below
          }
        }
        return envPath.path;
      }
    }

    // Older API (settings.getExecutionDetails -> execCommand argv).
    if (api.settings?.getExecutionDetails) {
      const details = api.settings.getExecutionDetails();
      const execCommand = details?.execCommand;
      if (execCommand && execCommand.length > 0) {
        return execCommand[0];
      }
    }
  } catch {
    // Any failure talking to the Python extension is treated as "not
    // resolved", never surfaced as a hard error here.
    return undefined;
  }
  return undefined;
}

export async function resolveInterpreter(): Promise<InterpreterResolution> {
  const configured = vscode.workspace.getConfiguration('veloxquant').get<string>('pythonPath', '');
  if (configured && configured.trim().length > 0) {
    return { path: configured.trim(), source: 'setting' };
  }

  const fromExtension = await resolveFromPythonExtension();
  if (fromExtension) {
    return { path: fromExtension, source: 'python-extension' };
  }

  return { path: undefined, source: 'none' };
}

/** Opens the built-in Python extension interpreter picker. */
export async function promptSelectInterpreter(): Promise<void> {
  await vscode.commands.executeCommand('python.setInterpreter');
}
