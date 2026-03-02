import * as vscode from 'vscode';
import { runScan, ExtensionConfig } from './scanner';
import { applyFindings } from './diagnostics';
import { HoundHoverProvider } from './hover';
import { HoundStatusBar } from './statusBar';

// ─── Globals (set during activation, consumed during deactivation) ────────────

let collection: vscode.DiagnosticCollection;
let statusBar: HoundStatusBar;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getConfig(): ExtensionConfig {
  const cfg = vscode.workspace.getConfiguration('contexthound');
  return {
    scanOnSave:     cfg.get<boolean>('scanOnSave', true),
    threshold:      cfg.get<number>('threshold', 60),
    failOn:         cfg.get<string>('failOn', ''),
    minConfidence:  cfg.get<string>('minConfidence', 'low'),
    excludeRules:   cfg.get<string[]>('excludeRules', []),
    executablePath: cfg.get<string>('executablePath', ''),
    configPath:     cfg.get<string>('configPath', ''),
  };
}

function getWorkspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
}

/** Run a full workspace scan and push results to diagnostics + status bar. */
async function performScan(): Promise<void> {
  const root = getWorkspaceRoot();
  if (!root) {
    return; // No workspace open — nothing to scan.
  }

  const config = getConfig();
  statusBar.setScanningState();

  try {
    const result = await runScan(root, config);
    applyFindings(collection, result, root);
    statusBar.update(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    statusBar.setErrorState(message);
    vscode.window.showWarningMessage(`ContextHound scan failed: ${message}`);
  }
}

/**
 * Debounced wrapper around performScan().
 * Multiple rapid calls collapse into a single scan after `delayMs`.
 */
function triggerScan(delayMs: number): void {
  if (debounceTimer !== undefined) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined;
    void performScan();
  }, delayMs);
}

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  // 1. Diagnostic collection — one per extension, cleared on each scan.
  collection = vscode.languages.createDiagnosticCollection('ContextHound');
  context.subscriptions.push(collection);

  // 2. Status bar item.
  statusBar = new HoundStatusBar();
  context.subscriptions.push({ dispose: () => statusBar.dispose() });

  // 3. Hover provider — registered for all file types (ContextHound is language-agnostic).
  const hoverProvider = vscode.languages.registerHoverProvider(
    { scheme: 'file' },
    new HoundHoverProvider(collection),
  );
  context.subscriptions.push(hoverProvider);

  // 4. Commands.
  context.subscriptions.push(
    vscode.commands.registerCommand('contexthound.scan', () => {
      void performScan();
    }),
    vscode.commands.registerCommand('contexthound.clear', () => {
      if (debounceTimer !== undefined) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
      }
      collection.clear();
      statusBar.update({ score: 0, passed: true, findings: [], filesScanned: 0 });
    }),
  );

  // 5. Scan on save (if enabled).
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      if (getConfig().scanOnSave) {
        triggerScan(500);
      }
    }),
  );

  // 6. Re-scan when workspace folders change.
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      triggerScan(1000);
    }),
  );

  // 7. Initial scan on activation (debounced to let VS Code finish opening).
  triggerScan(1000);
}

// ─── Deactivation ────────────────────────────────────────────────────────────

export function deactivate(): void {
  if (debounceTimer !== undefined) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
  // collection and statusBar are disposed via context.subscriptions.
}
