# ContextHound — VS Code Extension

Surfaces [ContextHound](https://github.com/IulianVOStrut/ContextHound) prompt-injection findings
as inline squiggles, hover remediations, and a status bar score — right as you write code.

---

## Features

- **Inline diagnostics** — critical/high findings appear as red errors, medium as warnings,
  low as information hints in the Problems panel and as squiggly underlines in the editor.
- **Hover remediations** — hover over any squiggle to read the full remediation guidance.
- **Status bar score** — `$(shield) Hound: 23/100 ✓` (green) or `✗` (red) after every scan.
- **Scan on save** — re-scans automatically whenever you save a file (configurable).
- **Zero-config discovery** — uses your project's local `hound` install, falls back to global
  PATH, then falls back to `npx context-hound` if nothing else is available.

---

## Requirements

One of the following must be available:

| Option | How |
|--------|-----|
| **Local install (recommended)** | `npm install --save-dev context-hound` in your project |
| **Global install** | `npm install -g context-hound` |
| **No install** | The extension will use `npx context-hound` automatically (slower first run) |

---

## Extension Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `contexthound.scanOnSave` | boolean | `true` | Re-scan on file save |
| `contexthound.threshold` | number | `60` | Score threshold 0-100 |
| `contexthound.failOn` | string | `""` | Fail if any finding is at or above this severity (`critical`, `high`, `medium`) |
| `contexthound.minConfidence` | string | `"low"` | Minimum confidence to surface (`low`, `medium`, `high`) |
| `contexthound.excludeRules` | array | `[]` | Rule IDs to skip, e.g. `["INJ-001"]` |
| `contexthound.executablePath` | string | `""` | Override path to the `hound` binary |
| `contexthound.configPath` | string | `""` | Override path to `.contexthoundrc.json` |

---

## Commands

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run:

- **ContextHound: Scan Workspace** — trigger an immediate full scan
- **ContextHound: Clear Findings** — clear all diagnostics and reset the status bar

---

## How It Works

```
File save / workspace open
        │
        ▼  (debounced 500 ms)
  hound scan --format json --dir <workspace>
        │
        ▼
  Findings → vscode.DiagnosticCollection
        │                    │
        ▼                    ▼
  Inline squiggles     Hover remediation
        │
        ▼
  Status bar: Hound: 42/100 ✓
```

---

## Local Development

```bash
git clone https://github.com/IulianVOStrut/contexthound-vscode
cd contexthound-vscode
npm install
npm run compile
# Press F5 in VS Code to launch the Extension Development Host
```

---

## License

MIT © [IulianVOStrut](https://github.com/IulianVOStrut)
