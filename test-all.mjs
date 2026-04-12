#!/usr/bin/env node

/**
 * test-all.mjs — Comprehensive test suite for career-ops
 *
 * Run before merging any PR or pushing changes.
 * Tests: syntax, scripts, dashboard, data contract, personal data, paths.
 *
 * Usage:
 *   node test-all.mjs           # Run all tests
 *   node test-all.mjs --quick   # Skip dashboard build (faster)
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync, readdirSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const QUICK = process.argv.includes('--quick');

let passed = 0;
let failed = 0;
let warnings = 0;

function pass(msg) { console.log(`  ✅ ${msg}`); passed++; }
function fail(msg) { console.log(`  ❌ ${msg}`); failed++; }
function warn(msg) { console.log(`  ⚠️  ${msg}`); warnings++; }

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', timeout: 30000, ...opts }).trim();
  } catch (e) {
    return null;
  }
}

function fileExists(path) { return existsSync(join(ROOT, path)); }
function readFile(path) { return readFileSync(join(ROOT, path), 'utf-8'); }

console.log('\n🧪 career-ops test suite\n');

// ── 1. SYNTAX CHECKS ────────────────────────────────────────────

console.log('1. Syntax checks');

const mjsFiles = readdirSync(ROOT).filter(f => f.endsWith('.mjs'));
for (const f of mjsFiles) {
  const result = run(`node --check ${f}`);
  if (result !== null) {
    pass(`${f} syntax OK`);
  } else {
    fail(`${f} has syntax errors`);
  }
}

// ── 2. SCRIPT EXECUTION ─────────────────────────────────────────

console.log('\n2. Script execution (graceful on empty data)');

const scripts = [
  { name: 'cv-sync-check.mjs', expectExit: 1, allowFail: true }, // fails without cv.md (normal in repo)
  { name: 'verify-pipeline.mjs', expectExit: 0 },
  { name: 'normalize-statuses.mjs', expectExit: 0 },
  { name: 'dedup-tracker.mjs', expectExit: 0 },
  { name: 'merge-tracker.mjs', expectExit: 0 },
  { name: 'update-system.mjs check', expectExit: 0 },
];

for (const { name, allowFail } of scripts) {
  const result = run(`node ${name} 2>&1`);
  if (result !== null) {
    pass(`${name} runs OK`);
  } else if (allowFail) {
    warn(`${name} exited with error (expected without user data)`);
  } else {
    fail(`${name} crashed`);
  }
}

// ── 3. LIVENESS CLASSIFICATION ──────────────────────────────────

console.log('\n3. Liveness classification');

try {
  const { classifyLiveness } = await import(pathToFileURL(join(ROOT, 'liveness-core.mjs')).href);

  const expiredChromeApply = classifyLiveness({
    finalUrl: 'https://example.com/jobs/closed-role',
    bodyText: 'Company Careers\nApply\nThe job you are looking for is no longer open.',
    applyControls: [],
  });
  if (expiredChromeApply.result === 'expired') {
    pass('Expired pages are not revived by nav/footer "Apply" text');
  } else {
    fail(`Expired page misclassified as ${expiredChromeApply.result}`);
  }

  const activeWorkdayPage = classifyLiveness({
    finalUrl: 'https://example.workday.com/job/123',
    bodyText: [
      '663 JOBS FOUND',
      'Senior AI Engineer',
      'Join our applied AI team to ship production systems, partner with customers, and own delivery across evaluation, deployment, and reliability.',
    ].join('\n'),
    applyControls: ['Apply for this Job'],
  });
  if (activeWorkdayPage.result === 'active') {
    pass('Visible apply controls still keep real job pages active');
  } else {
    fail(`Active job page misclassified as ${activeWorkdayPage.result}`);
  }
} catch (e) {
  fail(`Liveness classification tests crashed: ${e.message}`);
}

// ── 4. DASHBOARD BUILD ──────────────────────────────────────────

console.log('\n4. Codex advisory behavior');

try {
  const policy = await import(pathToFileURL(join(ROOT, 'codex-policy.mjs')).href);
  const boundaries = await import(pathToFileURL(join(ROOT, 'system-boundaries.mjs')).href);

  const routerCases = [
    { input: '', expected: 'discovery' },
    { input: 'scan', expected: 'scan' },
    { input: 'pdf', expected: 'pdf' },
    { input: 'tracker', expected: 'tracker' },
    { input: 'apply', expected: 'apply' },
    { input: 'https://example.com/jobs/123', expected: 'auto-pipeline' },
    { input: 'About the role\nResponsibilities\nRequirements', expected: 'auto-pipeline' },
  ];

  for (const { input, expected } of routerCases) {
    const actual = policy.resolveMode(input);
    if (actual === expected) {
      pass(`Router resolves "${input || '(empty)'}" to ${expected}`);
    } else {
      fail(`Router resolved "${input || '(empty)'}" to ${actual} instead of ${expected}`);
    }
  }

  const advisoryAllowed = policy.getCodexPolicyDecision('scan');
  if (advisoryAllowed.allowed) {
    pass('scan is allowed in Codex advisory mode');
  } else {
    fail('scan should be allowed in Codex advisory mode');
  }

  const advisoryBlocked = policy.getCodexPolicyDecision('apply');
  if (!advisoryBlocked.allowed) {
    pass('apply is blocked in Codex advisory mode');
  } else {
    fail('apply should be blocked in Codex advisory mode');
  }

  const batchBlocked = policy.getCodexPolicyDecision('batch');
  if (!batchBlocked.allowed) {
    pass('batch is blocked in Codex advisory mode');
  } else {
    fail('batch should be blocked in Codex advisory mode');
  }

  const updateApplyBlocked = policy.getUpdateActionPolicy('apply');
  if (!updateApplyBlocked.allowed) {
    pass('update-system apply is blocked in Codex advisory mode');
  } else {
    fail('update-system apply should be blocked in Codex advisory mode');
  }

  const onboardingMissing = policy.getMissingOnboardingFiles({
    existingFiles: new Set(['modes/_profile.md', 'portals.yml']),
  });
  if (
    onboardingMissing.length === 2 &&
    onboardingMissing.includes('cv.md') &&
    onboardingMissing.includes('config/profile.yml')
  ) {
    pass('Onboarding detects missing cv.md and config/profile.yml');
  } else {
    fail(`Unexpected onboarding missing set: ${onboardingMissing.join(', ')}`);
  }

  if (!policy.shouldEnterOnboarding({ existingFiles: new Set(policy.REQUIRED_ONBOARDING_FILES) })) {
    pass('Onboarding does not trigger when required files are present');
  } else {
    fail('Onboarding should not trigger when all required files are present');
  }

  const applyIssues = policy.validateApplyModeSafety(readFile('modes/apply.md'));
  if (applyIssues.length === 0) {
    pass('apply mode explicitly stops at answer drafting');
  } else {
    fail(`apply mode safety issues: ${applyIssues.join('; ')}`);
  }

  const overlaps = boundaries.SYSTEM_PATHS.filter((path) => boundaries.USER_PATHS.includes(path));
  if (overlaps.length === 0) {
    pass('System and user update paths do not overlap');
  } else {
    fail(`Update boundaries overlap: ${overlaps.join(', ')}`);
  }

  if (readFile('update-system.mjs').includes("from './system-boundaries.mjs'")) {
    pass('update-system.mjs uses shared boundary definitions');
  } else {
    fail('update-system.mjs should import shared boundary definitions');
  }
} catch (e) {
  fail(`Codex advisory behavior tests crashed: ${e.message}`);
}

// ── 5. SCAN DRY-RUN BEHAVIOR ───────────────────────────────────

console.log('\n5. Scan dry-run behavior');

try {
  const { runScan } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);
  const tempRoot = mkdtempSync(join(tmpdir(), 'career-ops-scan-'));

  try {
    mkdirSync(join(tempRoot, 'data'), { recursive: true });

    writeFileSync(join(tempRoot, 'portals.yml'), [
      'title_filter:',
      '  positive:',
      '    - engineer',
      '  negative:',
      '    - intern',
      'tracked_companies:',
      '  - name: TestCo',
      '    api: https://boards-api.greenhouse.io/v1/boards/testco/jobs',
      '',
    ].join('\n'));

    writeFileSync(join(tempRoot, 'data/pipeline.md'), [
      '# Pipeline',
      '',
      '## Pendientes',
      '',
      '- [ ] https://jobs.example/existing | TestCo | Existing Engineer',
      '',
      '## Procesadas',
      '',
    ].join('\n'));

    writeFileSync(join(tempRoot, 'data/scan-history.tsv'), [
      'url\tfirst_seen\tportal\ttitle\tcompany\tstatus',
      'https://jobs.example/already-seen\t2026-04-10\tgreenhouse-api\tSeen Engineer\tTestCo\tadded',
      '',
    ].join('\n'));

    writeFileSync(join(tempRoot, 'data/applications.md'), [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 1 | 2026-04-10 | TestCo | Staff Engineer | 4.3/5 | Evaluated | ✅ | [001](reports/001-testco.md) | note |',
      '',
    ].join('\n'));

    const beforePipeline = readFileSync(join(tempRoot, 'data/pipeline.md'), 'utf-8');
    const beforeHistory = readFileSync(join(tempRoot, 'data/scan-history.tsv'), 'utf-8');

    const summary = await runScan({
      root: tempRoot,
      dryRun: true,
      now: new Date('2026-04-12T12:00:00Z'),
      fetchJsonImpl: async () => ({
        jobs: [
          { title: 'Existing Engineer', absolute_url: 'https://jobs.example/existing', location: { name: 'Remote' } },
          { title: 'Staff Engineer', absolute_url: 'https://jobs.example/duplicate-role', location: { name: 'Remote' } },
          { title: 'AI Intern', absolute_url: 'https://jobs.example/intern', location: { name: 'Remote' } },
          { title: 'Principal Engineer', absolute_url: 'https://jobs.example/new-good', location: { name: 'Remote' } },
        ],
      }),
    });

    if (
      summary.newOffers.length === 1 &&
      summary.newOffers[0].url === 'https://jobs.example/new-good' &&
      summary.totalDupes === 2 &&
      summary.totalFiltered === 1
    ) {
      pass('scan dry-run filters, deduplicates, and keeps only new relevant offers');
    } else {
      fail(`Unexpected scan dry-run summary: ${JSON.stringify({
        newOffers: summary.newOffers,
        totalDupes: summary.totalDupes,
        totalFiltered: summary.totalFiltered,
      })}`);
    }

    const afterPipeline = readFileSync(join(tempRoot, 'data/pipeline.md'), 'utf-8');
    const afterHistory = readFileSync(join(tempRoot, 'data/scan-history.tsv'), 'utf-8');

    if (beforePipeline === afterPipeline && beforeHistory === afterHistory) {
      pass('scan dry-run does not write pipeline or scan history files');
    } else {
      fail('scan dry-run should not modify pipeline or scan history files');
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
} catch (e) {
  fail(`scan dry-run tests crashed: ${e.message}`);
}

// ── 6. DASHBOARD BUILD ──────────────────────────────────────────

if (!QUICK) {
  console.log('\n6. Dashboard build');
  const goBuild = run('cd dashboard && go build -o /tmp/career-dashboard-test . 2>&1');
  if (goBuild !== null) {
    pass('Dashboard compiles');
  } else {
    fail('Dashboard build failed');
  }
} else {
  console.log('\n6. Dashboard build (skipped --quick)');
}

// ── 7. DATA CONTRACT ────────────────────────────────────────────

console.log('\n7. Data contract validation');

// Check system files exist
const systemFiles = [
  'AGENTS.md', 'CLAUDE.md', 'VERSION', 'DATA_CONTRACT.md',
  'codex-policy.mjs', 'system-boundaries.mjs', 'docs/CODEX.md',
  'modes/_shared.md', 'modes/_profile.template.md',
  'modes/oferta.md', 'modes/pdf.md', 'modes/scan.md',
  'templates/states.yml', 'templates/cv-template.html',
  '.claude/skills/career-ops/SKILL.md',
];

for (const f of systemFiles) {
  if (fileExists(f)) {
    pass(`System file exists: ${f}`);
  } else {
    fail(`Missing system file: ${f}`);
  }
}

// Check user files are NOT tracked (gitignored)
const userFiles = [
  'config/profile.yml', 'modes/_profile.md', 'portals.yml',
];
for (const f of userFiles) {
  const tracked = run(`git ls-files ${f}`);
  if (tracked === '') {
    pass(`User file gitignored: ${f}`);
  } else if (tracked === null) {
    pass(`User file gitignored: ${f}`);
  } else {
    fail(`User file IS tracked (should be gitignored): ${f}`);
  }
}

// ── 8. PERSONAL DATA LEAK CHECK ─────────────────────────────────

console.log('\n8. Personal data leak check');

const leakPatterns = [
  'Santiago', 'santifer.io', 'Santifer iRepair', 'Zinkee', 'ALMAS',
  'hi@santifer.io', '688921377', '/Users/santifer/',
];

const scanExtensions = ['md', 'yml', 'html', 'mjs', 'sh', 'go', 'json'];
const allowedFiles = [
  // English README + localized translations (all legitimately credit Santiago)
  'README.md', 'README.es.md', 'README.ja.md', 'README.ko-KR.md',
  'README.pt-BR.md', 'README.ru.md',
  // Standard project files
  'LICENSE', 'CITATION.cff', 'CONTRIBUTING.md',
  'package.json', '.github/FUNDING.yml', 'CLAUDE.md', 'go.mod', 'test-all.mjs',
  'docs/CODEX.md', 'AGENTS.md',
  // Community / governance files (added in v1.3.0, all legitimately reference the maintainer)
  'CODE_OF_CONDUCT.md', 'GOVERNANCE.md', 'SECURITY.md', 'SUPPORT.md',
  '.github/SECURITY.md',
  // Dashboard credit string
  'dashboard/internal/ui/screens/pipeline.go',
  'dashboard/internal/ui/screens/progress.go',
];

// Build pathspec for git grep — only scan tracked files matching these
// extensions. This is what `grep -rn` was trying to do, but git-aware:
// untracked files (debate artifacts, AI tool scratch, local plans/) and
// gitignored files can't trigger false positives because they were never
// going to reach a commit anyway.
const grepPathspec = scanExtensions.map(e => `'*.${e}'`).join(' ');

let leakFound = false;
for (const pattern of leakPatterns) {
  const result = run(
    `git grep -n "${pattern}" -- ${grepPathspec} 2>/dev/null`
  );
  if (result) {
    for (const line of result.split('\n')) {
      const file = line.split(':')[0];
      if (allowedFiles.some(a => file.includes(a))) continue;
      if (file.includes('dashboard/go.mod')) continue;
      warn(`Possible personal data in ${file}: "${pattern}"`);
      leakFound = true;
    }
  }
}
if (!leakFound) {
  pass('No personal data leaks outside allowed files');
}

// ── 9. ABSOLUTE PATH CHECK ──────────────────────────────────────

console.log('\n9. Absolute path check');

// Same git grep approach: only scans tracked files. Untracked AI tool
// outputs, local debate artifacts, etc. can't false-positive here.
const absPathResult = run(
  `git grep -n "/Users/" -- '*.mjs' '*.sh' '*.md' '*.go' '*.yml' 2>/dev/null | grep -v README.md | grep -v LICENSE | grep -v CLAUDE.md | grep -v test-all.mjs`
);
if (!absPathResult) {
  pass('No absolute paths in code files');
} else {
  for (const line of absPathResult.split('\n').filter(Boolean)) {
    fail(`Absolute path: ${line.slice(0, 100)}`);
  }
}

// ── 10. MODE FILE INTEGRITY ─────────────────────────────────────

console.log('\n10. Mode file integrity');

const expectedModes = [
  '_shared.md', '_profile.template.md', 'oferta.md', 'pdf.md', 'scan.md',
  'batch.md', 'apply.md', 'auto-pipeline.md', 'contacto.md', 'deep.md',
  'ofertas.md', 'pipeline.md', 'project.md', 'tracker.md', 'training.md',
];

for (const mode of expectedModes) {
  if (fileExists(`modes/${mode}`)) {
    pass(`Mode exists: ${mode}`);
  } else {
    fail(`Missing mode: ${mode}`);
  }
}

// Check _shared.md references _profile.md
const shared = readFile('modes/_shared.md');
if (shared.includes('_profile.md')) {
  pass('_shared.md references _profile.md');
} else {
  fail('_shared.md does NOT reference _profile.md');
}

// ── 11. CLAUDE.md INTEGRITY ─────────────────────────────────────

console.log('\n11. CLAUDE.md integrity');

const claude = readFile('CLAUDE.md');
const requiredSections = [
  'Data Contract', 'Update Check', 'Ethical Use',
  'Offer Verification', 'Canonical States', 'TSV Format',
  'First Run', 'Onboarding',
];

for (const section of requiredSections) {
  if (claude.includes(section)) {
    pass(`CLAUDE.md has section: ${section}`);
  } else {
    fail(`CLAUDE.md missing section: ${section}`);
  }
}

// ── 12. VERSION FILE ────────────────────────────────────────────

console.log('\n12. Version file');

if (fileExists('VERSION')) {
  const version = readFile('VERSION').trim();
  if (/^\d+\.\d+\.\d+$/.test(version)) {
    pass(`VERSION is valid semver: ${version}`);
  } else {
    fail(`VERSION is not valid semver: "${version}"`);
  }
} else {
  fail('VERSION file missing');
}

// ── SUMMARY ─────────────────────────────────────────────────────

console.log('\n' + '='.repeat(50));
console.log(`📊 Results: ${passed} passed, ${failed} failed, ${warnings} warnings`);

if (failed > 0) {
  console.log('🔴 TESTS FAILED — do NOT push/merge until fixed\n');
  process.exit(1);
} else if (warnings > 0) {
  console.log('🟡 Tests passed with warnings — review before pushing\n');
  process.exit(0);
} else {
  console.log('🟢 All tests passed — safe to push/merge\n');
  process.exit(0);
}
