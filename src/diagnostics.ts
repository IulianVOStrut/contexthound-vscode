import * as vscode from 'vscode';
import * as path from 'path';
import { Finding, ScanResult, Severity } from './scanner';

// ─── Severity mapping ────────────────────────────────────────────────────────

const SEV_MAP: Record<Severity, vscode.DiagnosticSeverity> = {
  critical: vscode.DiagnosticSeverity.Error,
  high:     vscode.DiagnosticSeverity.Error,
  medium:   vscode.DiagnosticSeverity.Warning,
  low:      vscode.DiagnosticSeverity.Information,
};

// ─── Conversion ──────────────────────────────────────────────────────────────

/**
 * Convert a single Finding into a vscode.Diagnostic.
 * The remediation text is stashed on the diagnostic as a non-standard property
 * so HoundHoverProvider can retrieve it without keeping a separate map.
 */
export function findingToDiagnostic(f: Finding): vscode.Diagnostic {
  // VS Code ranges are 0-indexed; ContextHound lines are 1-indexed.
  const range = new vscode.Range(
    Math.max(0, f.lineStart - 1), 0,
    Math.max(0, f.lineEnd - 1), Number.MAX_SAFE_INTEGER,
  );

  const message = `[${f.id}] ${f.title}`;
  const d = new vscode.Diagnostic(range, message, SEV_MAP[f.severity]);

  d.source = 'ContextHound';
  d.code = {
    value: f.id,
    target: vscode.Uri.parse('https://github.com/IulianVOStrut/ContextHound'),
  };

  // Stash remediation for the hover provider (cast to bypass TS readonly check)
  (d as vscode.Diagnostic & { remediation: string }).remediation = f.remediation;

  return d;
}

// ─── Apply ───────────────────────────────────────────────────────────────────

/**
 * Rebuild the DiagnosticCollection from a fresh ScanResult.
 * Groups findings by file path and sets them all at once.
 */
export function applyFindings(
  collection: vscode.DiagnosticCollection,
  result: ScanResult,
  workspaceRoot: string,
): void {
  collection.clear();

  const byFile = new Map<string, vscode.Diagnostic[]>();

  for (const finding of result.findings) {
    // Findings may have relative or absolute paths; normalise to absolute.
    const absPath = path.isAbsolute(finding.file)
      ? finding.file
      : path.join(workspaceRoot, finding.file);

    const uri = vscode.Uri.file(absPath);
    const key = uri.toString();

    if (!byFile.has(key)) {
      byFile.set(key, []);
    }
    byFile.get(key)!.push(findingToDiagnostic(finding));
  }

  for (const [key, diags] of byFile) {
    collection.set(vscode.Uri.parse(key), diags);
  }
}
