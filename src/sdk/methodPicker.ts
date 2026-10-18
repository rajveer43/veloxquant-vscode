import * as vscode from 'vscode';
import { arrangeForPicker, listServableMethods } from './methods';
import type { ServableMethod } from './methods';

/** Servable methods for a picker: stable first, experimental hidden unless `veloxquant.showExperimentalMethods` is on. */
export async function listPickerMethods(): Promise<ServableMethod[]> {
  const show = vscode.workspace.getConfiguration('veloxquant').get<boolean>('showExperimentalMethods', false);
  return arrangeForPicker(await listServableMethods(), show);
}
