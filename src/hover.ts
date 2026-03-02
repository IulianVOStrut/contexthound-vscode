import * as vscode from 'vscode';

/**
 * Shows the remediation text from a ContextHound diagnostic when the user
 * hovers over a squiggled line.
 */
export class HoundHoverProvider implements vscode.HoverProvider {
  constructor(private readonly collection: vscode.DiagnosticCollection) {}

  provideHover(
    doc: vscode.TextDocument,
    pos: vscode.Position,
  ): vscode.Hover | null {
    const diags = this.collection.get(doc.uri);
    if (!diags || diags.length === 0) {
      return null;
    }

    // Find the first ContextHound diagnostic that covers this position.
    const diag = diags.find(d => d.range.contains(pos));
    if (!diag) {
      return null;
    }

    const remediation = (diag as vscode.Diagnostic & { remediation?: string }).remediation;
    if (!remediation) {
      return null;
    }

    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = true;
    md.appendMarkdown(`**ContextHound remediation**\n\n${remediation}`);

    return new vscode.Hover(md, diag.range);
  }
}
