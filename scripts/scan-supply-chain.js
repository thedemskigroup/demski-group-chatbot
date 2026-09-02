#!/usr/bin/env node
/**
 * Supply-chain / malware tripwire — zero dependencies.
 *
 * Scans the repo's OWN tracked files (never node_modules/.next/.git) for the
 * indicators of the macOS npm backdoor we cleaned in Aug 2026, plus generic
 * backdoor shapes. Designed to run fast as a pre-commit hook and as the first
 * CI stage so nothing infected gets committed, built, or deployed.
 *
 * Usage:
 *   node scripts/scan-supply-chain.js            # scan all tracked files
 *   node scripts/scan-supply-chain.js <files...> # scan only these (pre-commit)
 *
 * Exit code 1 on any CRITICAL finding, else 0. Warnings never fail the build.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ---- Indicators of Compromise -------------------------------------------------
// Known command-and-control hosts from the Aug 2026 incident. Extend as needed.
const C2_HOSTS = ["networkads.in", "amdcdn.ru"];

// Critical code patterns. Each: { re, why }. A single hit fails the scan.
const CRITICAL_PATTERNS = [
  { re: /String\.fromCharCode\(\s*(?:127|0x7f)\s*\)/i, why: "fromCharCode(127) obfuscation (incident signature)" },
  { re: /fromCharCode\((?:[^)]*,)?\s*(?:127|0x7f)\s*(?:,[^)]*)?\)/i, why: "fromCharCode with DEL byte" },
  { re: /base64\s+(?:-d|--decode)[^\n|]*\|\s*(?:sh|bash|zsh)\b/i, why: "base64-decode piped to shell (persistence)" },
  { re: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sh|bash|zsh)\b/i, why: "remote script piped to shell" },
  { re: /eval\s*\(\s*(?:atob|Buffer\.from|require\(['"]zlib['"]\))/i, why: "eval of decoded/base64 payload" },
  { re: /child_process[\s\S]{0,80}?(?:atob|Buffer\.from\([^)]*base64)/i, why: "child_process executing decoded payload" },
];

// File extensions worth scanning as text (source + config + shell).
const TEXT_EXT = new Set([
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".json", ".sh",
  ".yml", ".yaml", ".css", ".scss", ".env", ".html", ".mts", ".cts",
]);

// Config files that are normally tiny and pure-ASCII. The incident bloated
// postcss.config from ~134B to ~5.5KB and injected control chars.
const CONFIG_RE = /(^|\/)(postcss|tailwind|next|babel|jest|playwright)\.config\.[mc]?[jt]s$/i;
const CONFIG_MAX_BYTES = 8 * 1024;

const NEVER_SCAN = /(^|\/)(node_modules|\.next|\.git|dist|build|coverage|\.turbo)(\/|$)/;

// ---- File discovery -----------------------------------------------------------
function listFiles(argv) {
  if (argv.length) return argv.filter((f) => fs.existsSync(f));
  try {
    return execSync("git ls-files", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split("\n")
      .filter(Boolean);
  } catch {
    // Not a git repo — walk the tree, skipping NEVER_SCAN dirs.
    const out = [];
    (function walk(dir) {
      for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        if (NEVER_SCAN.test(p.replace(/\\/g, "/"))) continue;
        const st = fs.statSync(p);
        if (st.isDirectory()) walk(p);
        else out.push(p);
      }
    })(process.cwd());
    return out;
  }
}

// ---- Scan ---------------------------------------------------------------------
const findings = []; // {level, file, why}
const warnings = [];

function scanFile(file) {
  const rel = file.replace(/\\/g, "/");
  // Never scan this scanner itself — it legitimately contains the IOC strings
  // it searches for (the pattern list + C2 host list), which would self-trigger.
  try { if (path.resolve(file) === __filename) return; } catch { /* ignore */ }
  if (/(^|\/)scripts\/scan-supply-chain\.js$/.test(rel)) return;
  if (NEVER_SCAN.test(rel)) return;
  const ext = path.extname(rel).toLowerCase();
  const isConfig = CONFIG_RE.test(rel);
  if (!TEXT_EXT.has(ext) && !isConfig) return;

  let buf;
  try { buf = fs.readFileSync(file); } catch { return; }

  // Raw DEL byte (0x7f) in source/config — the incident's obfuscation marker.
  if (buf.includes(0x7f)) {
    findings.push({ file: rel, why: "raw DEL (0x7f) control byte in source/config" });
  }
  // Other control bytes (except \t \n \r) inside config files.
  if (isConfig) {
    for (const b of buf) {
      if (b < 9 || (b > 13 && b < 32)) {
        findings.push({ file: rel, why: "non-printable control byte in config file" });
        break;
      }
    }
    if (buf.length > CONFIG_MAX_BYTES) {
      warnings.push(`${rel}: config file is ${buf.length}B (unusually large — verify it wasn't tampered)`);
    }
    // Note: printable non-ASCII (accents, emoji in comments) is legitimate and
    // NOT flagged. Only control bytes / DEL (above) are the incident signal.
  }

  const text = buf.toString("utf8");
  for (const { re, why } of CRITICAL_PATTERNS) {
    if (re.test(text)) findings.push({ file: rel, why });
  }
  for (const host of C2_HOSTS) {
    if (text.includes(host)) findings.push({ file: rel, why: `known C2 host "${host}"` });
  }

  // package.json install-lifecycle scripts — surface for human review (warn only).
  if (/(^|\/)package\.json$/.test(rel)) {
    try {
      const scripts = (JSON.parse(text).scripts) || {};
      for (const k of ["preinstall", "install", "postinstall"]) {
        if (scripts[k]) warnings.push(`${rel}: has "${k}" script → "${scripts[k]}" (review it is intentional)`);
      }
    } catch { /* ignore parse errors */ }
  }
}

const files = listFiles(process.argv.slice(2));
files.forEach(scanFile);

// ---- Report -------------------------------------------------------------------
if (warnings.length) {
  console.warn("\n⚠️  supply-chain warnings (review, non-blocking):");
  warnings.forEach((w) => console.warn("   - " + w));
}
if (findings.length) {
  console.error(`\n❌  MALWARE SCAN FAILED — ${findings.length} critical finding(s):`);
  for (const f of findings) console.error(`   [${f.file}] ${f.why}`);
  console.error("\n   Do NOT commit/deploy. Isolate the machine and run your malware-cleanup runbook.");
  process.exit(1);
}
console.log(`✅  supply-chain scan clean (${files.length} files, 0 findings).`);
