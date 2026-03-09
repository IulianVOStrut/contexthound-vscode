import { execSync, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

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
  repoScore: number;
  scoreLabel: string;
  passed: boolean;
  allFindings: Finding[];
  files: { file: string; findings: Finding[]; fileScore: number }[];
  threshold: number;
  fileThresholdBreached: boolean;
}

export interface ExtensionConfig {
  scanOnSave: boolean;
  threshold: number;
  failOn: string;
  minConfidence: string;
  executablePath: string;
  configPath: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SCAN_TIMEOUT_MS = 60_000;

/**
 * Wrap a path in double-quotes if it contains spaces and we're on Windows
 * with shell:true — otherwise the shell splits it into separate tokens.
 */
function shellQuote(p: string): string {
  if (process.platform === 'win32' && p.includes(' ') && !p.startsWith('"')) {
    return `"${p}"`;
  }
  return p;
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

  return 'npx --yes context-hound';
}

// ─── Execution ───────────────────────────────────────────────────────────────

export async function runScan(
  root: string,
  config: ExtensionConfig,
  log?: (msg: string) => void,
): Promise<ScanResult> {
  const bin = await resolveHound(root, config.executablePath);
  log?.(`  resolved binary: ${bin}`);

  if (bin.startsWith('npx')) {
    log?.('  (first run may take ~10 s to download context-hound via npx)');
  }

  // hound writes JSON to a file, not stdout — use a temp file and read it back.
  // Include Math.random() to avoid collisions on rapid consecutive saves.
  const tmpBase = path.join(
    os.tmpdir(),
    `hound-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const tmpFile = `${tmpBase}.json`;

  const args: string[] = [
    'scan',
    '--format', 'json',
    '--out', shellQuote(tmpBase),
    '--threshold', String(config.threshold),
    '--no-cache',   // always scan fresh in the IDE
  ];

  if (config.failOn && config.failOn !== '') {
    args.push('--fail-on', config.failOn);
  }
  if (config.configPath && config.configPath !== '') {
    args.push('--config', shellQuote(config.configPath));
  }

  // minConfidence has no CLI flag — pass via env var instead
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (config.minConfidence && config.minConfidence !== '') {
    env['HOUND_MIN_CONFIDENCE'] = config.minConfidence;
  }

  // Split "npx --yes context-hound" → cmd + prepended args
  const parts = bin.split(' ');
  const cmd = parts[0];
  const cmdArgs = [...parts.slice(1), ...args];

  return new Promise((resolve, reject) => {
    let stderr = '';

    const child = spawn(cmd, cmdArgs, {
      cwd: root,
      env,
      // On Windows, shell: true is needed to resolve .cmd shims in node_modules/.bin
      shell: process.platform === 'win32',
    });

    // Kill the process and reject if it exceeds the timeout
    const timer = setTimeout(() => {
      child.kill();
      try { fs.unlinkSync(tmpFile); } catch { /* best-effort */ }
      reject(new Error(`hound timed out after ${SCAN_TIMEOUT_MS / 1000} s. Try setting a faster executablePath or reducing the scanned directory.`));
    }, SCAN_TIMEOUT_MS);

    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
      log?.(`  stderr: ${d.toString().trimEnd()}`);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to start hound: ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);

      // Exit code meanings:
      //   0 = passed           → JSON written ✓
      //   1 = error/bad args   → no JSON, reject
      //   2 = threshold breach → JSON written ✓ (passed: false)
      //   3 = failOn violation → JSON written ✓ (passed: false)
      if (code === 1 || (code !== null && code > 3)) {
        try { fs.unlinkSync(tmpFile); } catch { /* best-effort */ }
        const detail = stderr.trim() || '(no output)';
        reject(new Error(`hound exited with code ${code}.\n${detail.slice(0, 400)}`));
        return;
      }

      try {
        const raw = fs.readFileSync(tmpFile, 'utf8');
        try { fs.unlinkSync(tmpFile); } catch { /* best-effort */ }
        resolve(JSON.parse(raw) as ScanResult);
      } catch (readErr) {
        try { fs.unlinkSync(tmpFile); } catch { /* best-effort */ }
        const detail = stderr.trim() || '(no stderr)';
        reject(new Error(
          `hound ran (exit ${code}) but JSON output file not found or unreadable.\n` +
          `Expected: ${tmpFile}\nstderr: ${detail.slice(0, 200)}`,
        ));
      }
    });
  });
}
