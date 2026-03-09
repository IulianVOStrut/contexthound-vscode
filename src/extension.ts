import * as vscode from 'vscode';
import { runScan, ExtensionConfig } from './scanner';
import { applyFindings } from './diagnostics';
import { HoundHoverProvider } from './hover';
import { HoundStatusBar } from './statusBar';
import { HoundCodeActionProvider } from './codeActions';

// ─── Globals (set during activation, consumed during deactivation) ────────────

let collection: vscode.DiagnosticCollection;
let statusBar: HoundStatusBar;
let outputChannel: vscode.OutputChannel;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getConfig(): ExtensionConfig {
  const cfg = vscode.workspace.getConfiguration('contexthound');
  return {
    scanOnSave:     cfg.get<boolean>('scanOnSave', true),
    threshold:      cfg.get<number>('threshold', 60),
    failOn:         cfg.get<string>('failOn', ''),
    minConfidence:  cfg.get<string>('minConfidence', 'low'),
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
    outputChannel.appendLine(`[${new Date().toISOString()}] Scanning ${root} …`);
    const result = await runScan(root, config, msg => outputChannel.appendLine(msg));
    outputChannel.appendLine(`  → score ${result.repoScore}, ${result.allFindings.length} finding(s), passed=${result.passed}`);
    applyFindings(collection, result, root);
    statusBar.update(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`  → ERROR: ${message}`);
    statusBar.setErrorState(message);
    vscode.window.showWarningMessage(
      `ContextHound scan failed: ${message}`,
      'Open Output',
    ).then(choice => {
      if (choice === 'Open Output') { outputChannel.show(); }
    });
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
  // 1. Output channel for diagnostics (visible in View → Output → ContextHound).
  outputChannel = vscode.window.createOutputChannel('ContextHound');
  context.subscriptions.push(outputChannel);

  // 2. Diagnostic collection — one per extension, cleared on each scan.
  collection = vscode.languages.createDiagnosticCollection('ContextHound');
  context.subscriptions.push(collection);

  // 3. Status bar item.
  statusBar = new HoundStatusBar();
  context.subscriptions.push({ dispose: () => statusBar.dispose() });

  // 4. Hover provider — registered for all file types (ContextHound is language-agnostic).
  const hoverProvider = vscode.languages.registerHoverProvider(
    { scheme: 'file' },
    new HoundHoverProvider(collection),
  );
  context.subscriptions.push(hoverProvider);

  // 4b. Code action provider — quick-fixes on ContextHound diagnostics.
  const codeActionProvider = vscode.languages.registerCodeActionsProvider(
    { scheme: 'file' },
    new HoundCodeActionProvider(collection),
    { providedCodeActionKinds: HoundCodeActionProvider.providedCodeActionKinds },
  );
  context.subscriptions.push(codeActionProvider);

  // 5. Commands.
  context.subscriptions.push(
    vscode.commands.registerCommand('contexthound.scan', () => {
      void performScan();
    }),
    vscode.commands.registerCommand('contexthound.copyRemediation', (remediation: string, ruleId: string) => {
      void vscode.env.clipboard.writeText(remediation).then(() => {
        void vscode.window.showInformationMessage(`[${ruleId}] remediation copied to clipboard.`);
      });
    }),
    vscode.commands.registerCommand('contexthound.clear', () => {
      if (debounceTimer !== undefined) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
      }
      collection.clear();
      statusBar.update({ repoScore: 0, scoreLabel: 'low', passed: true, allFindings: [], files: [], threshold: 60, fileThresholdBreached: false });
    }),
  );

  // 6. Scan on save (if enabled).
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      if (getConfig().scanOnSave) {
        triggerScan(500);
      }
    }),
  );

  // 7. Re-scan when workspace folders change.
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      triggerScan(1000);
    }),
  );

  // 8. Initial scan on activation (debounced to let VS Code finish opening).
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
