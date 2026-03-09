import * as vscode from 'vscode';
import { ScanResult } from './scanner';

/**
 * Manages the ContextHound status bar item (right side).
 * Shows score + pass/fail after each scan, "scanning…" while running.
 * Clicking opens the Problems panel filtered to the ContextHound source.
 */
export class HoundStatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      // Priority 100 — appears near the right edge without crowding built-ins
      100,
    );
    this.item.command = 'workbench.actions.view.problems';
    this.item.tooltip = 'ContextHound — click to open Problems panel';
    this.item.show();
    this.setIdleState();
  }

  /** Called immediately before spawning the scan process. */
  setScanningState(): void {
    this.item.text = '$(shield) Hound: scanning\u2026';
    this.item.backgroundColor = undefined;
  }

  /** Called once a ScanResult is available. */
  update(result: ScanResult): void {
    const score = result.repoScore ?? 0;
    const passed = result.passed !== false;

    if (passed) {
      this.item.text = `$(shield) Hound: ${score}/100 \u2713`;
      this.item.backgroundColor = undefined;
    } else {
      this.item.text = `$(shield) Hound: ${score}/100 \u2717`;
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    }
  }

  /** Called on error (scan failed to run / parse). */
  setErrorState(message: string): void {
    this.item.text = '$(shield) Hound: error';
    this.item.tooltip = `ContextHound error: ${message}`;
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }

  dispose(): void {
    this.item.dispose();
  }

  private setIdleState(): void {
    this.item.text = '$(shield) Hound';
    this.item.backgroundColor = undefined;
    this.item.tooltip = 'ContextHound — click to open Problems panel';
  }
}
