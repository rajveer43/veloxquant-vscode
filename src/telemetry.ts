/**
 * No custom telemetry backend. This module exists only to route any future
 * diagnostic events through VS Code's own opt-in/opt-out telemetry API
 * (`vscode.env.isTelemetryEnabled` / `vscode.env.onDidChangeTelemetryEnabled`)
 * rather than a bespoke system, per the non-goals in the extension README:
 * "No account system, no non-standard telemetry."
 *
 * Currently a no-op logger; kept as a single choke point so any telemetry
 * added later has one place to respect the user's setting.
 */
import * as vscode from 'vscode';

export function isTelemetryEnabled(): boolean {
  return vscode.env.isTelemetryEnabled;
}

export function logEvent(name: string, properties?: Record<string, string | number | boolean>): void {
  if (!isTelemetryEnabled()) {
    return;
  }
  // Intentionally a no-op sink for now: this extension does not ship a
  // telemetry backend. Kept as a named function so call sites read clearly
  // and a real reporter can be wired in later without touching callers.
  void name;
  void properties;
}
