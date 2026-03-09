import * as vscode from 'vscode';

/**
 * Provides two quick-fix actions for every ContextHound diagnostic:
 *   1. Copy remediation — puts the guidance text on the clipboard
 *   2. View rule on GitHub — opens the ContextHound README in the browser
 */
export class HoundCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  constructor(private readonly collection: vscode.DiagnosticCollection) {}

  provideCodeActions(
    doc: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    const diags = this.collection.get(doc.uri);
    if (!diags || diags.length === 0) { return []; }

    const actions: vscode.CodeAction[] = [];

    for (const diag of diags) {
      if (!diag.range.intersection(range)) { continue; }

      const ruleId = typeof diag.code === 'object' && diag.code !== null
        ? String(diag.code.value)
        : String(diag.code ?? '');

      const remediation = (diag as vscode.Diagnostic & { remediation?: string }).remediation;

      // Action 1 — copy remediation to clipboard
      if (remediation) {
        const copy = new vscode.CodeAction(
          `$(copy) Copy remediation — ${ruleId}`,
          vscode.CodeActionKind.QuickFix,
        );
        copy.diagnostics = [diag];
        copy.command = {
          command: 'contexthound.copyRemediation',
          title: 'Copy remediation',
          arguments: [remediation, ruleId],
        };
        actions.push(copy);
      }

      // Action 2 — open rule documentation on GitHub
      const docs = new vscode.CodeAction(
        `$(link-external) View ${ruleId} documentation`,
        vscode.CodeActionKind.QuickFix,
      );
      docs.diagnostics = [diag];
      docs.command = {
        command: 'vscode.open',
        title: 'Open documentation',
        arguments: [vscode.Uri.parse('https://github.com/IulianVOStrut/ContextHound#rules')],
      };
      actions.push(docs);
    }

    return actions;
  }
}
