import { execSync, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// ─── Types ───────────────────────────────────────────────────────────────────

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Confidence = 'high' | 'medium' | 'low';

export interface Finding {
  id: string;
  title: string;
  severity: Severity;
  confidence: Confidence;
  file: string;
  lineStart: number;
  lineEnd: number;
  remediation: string;
  category?: string;
  description?: string;
}

export interface ScanResult {
  score: number;
  passed: boolean;
  findings: Finding[];
  filesScanned: number;
  timestamp?: string;
}

export interface ExtensionConfig {
  scanOnSave: boolean;
  threshold: number;
  failOn: string;
  minConfidence: string;
  excludeRules: string[];
  executablePath: string;
  configPath: string;
}

// ─── Discovery ───────────────────────────────────────────────────────────────

/**
 * Resolve the hound executable to use for this workspace.
 * Priority: user override → local node_modules → global PATH → npx fallback.
 */
export async function resolveHound(root: string, override?: string): Promise<string> {
  if (override && override.trim() !== '') {
    return override.trim();
  }

  const local = path.join(root, 'node_modules', '.bin', 'hound');
  if (fs.existsSync(local)) {
    return local;
  }

  try {
    execSync('hound --version', { stdio: 'pipe' });
    return 'hound';
  } catch {
    // not on PATH
  }

  return 'npx context-hound';
}

// ─── Execution ───────────────────────────────────────────────────────────────

export async function runScan(root: string, config: ExtensionConfig): Promise<ScanResult> {
  const bin = await resolveHound(root, config.executablePath);

  const args: string[] = [
    'scan',
    '--format', 'json',
    '--dir', root,
    '--no-cache',
    '--threshold', String(config.threshold),
  ];

  if (config.failOn && config.failOn !== '') {
    args.push('--fail-on', config.failOn);
  }
  if (config.configPath && config.configPath !== '') {
    args.push('--config', config.configPath);
  }
  if (config.minConfidence && config.minConfidence !== '') {
    args.push('--min-confidence', config.minConfidence);
  }
  if (config.excludeRules && config.excludeRules.length > 0) {
    args.push('--exclude-rules', config.excludeRules.join(','));
  }

  // Split "npx context-hound" → cmd + prepended args
  const parts = bin.split(' ');
  const cmd = parts[0];
  const cmdArgs = [...parts.slice(1), ...args];

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const child = spawn(cmd, cmdArgs, {
      cwd: root,
      // On Windows, shell: true is needed to resolve .cmd shims in node_modules/.bin
      shell: process.platform === 'win32',
    });

    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.on('error', (err) => {
      reject(new Error(`Failed to start hound: ${err.message}`));
    });

    child.on('close', (code) => {
      // Exit codes 0 (pass) and 1 (threshold breach) both emit valid JSON.
      // Exit code 2 = config error, 3 = fatal. Anything else is also an error.
      if (code !== null && code > 1) {
        reject(new Error(`hound exited with code ${code}. stderr: ${stderr.slice(0, 400)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as ScanResult);
      } catch {
        reject(new Error(`JSON parse error (exit ${code}): ${stdout.slice(0, 200)}`));
      }
    });
  });
}
