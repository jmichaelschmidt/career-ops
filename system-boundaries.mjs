#!/usr/bin/env node

/**
 * system-boundaries.mjs — Shared update boundary definitions.
 *
 * update-system.mjs and the test suite import the same constants so the
 * safety tests cover the actual updater contract.
 */

export const CANONICAL_REPO = 'https://github.com/santifer/career-ops.git';
export const RAW_VERSION_URL = 'https://raw.githubusercontent.com/santifer/career-ops/main/VERSION';
export const RELEASES_API = 'https://api.github.com/repos/santifer/career-ops/releases/latest';

export const SYSTEM_PATHS = [
  'modes/_shared.md',
  'modes/_profile.template.md',
  'modes/oferta.md',
  'modes/pdf.md',
  'modes/scan.md',
  'modes/batch.md',
  'modes/apply.md',
  'modes/auto-pipeline.md',
  'modes/contacto.md',
  'modes/deep.md',
  'modes/ofertas.md',
  'modes/pipeline.md',
  'modes/project.md',
  'modes/tracker.md',
  'modes/training.md',
  'modes/de/',
  'CLAUDE.md',
  'AGENTS.md',
  'generate-pdf.mjs',
  'merge-tracker.mjs',
  'verify-pipeline.mjs',
  'dedup-tracker.mjs',
  'normalize-statuses.mjs',
  'cv-sync-check.mjs',
  'update-system.mjs',
  'batch/batch-prompt.md',
  'batch/batch-runner.sh',
  'dashboard/',
  'templates/',
  'fonts/',
  '.claude/skills/',
  'docs/',
  'VERSION',
  'DATA_CONTRACT.md',
  'CONTRIBUTING.md',
  'README.md',
  'LICENSE',
  'CITATION.cff',
  '.github/',
  'package.json',
];

export const USER_PATHS = [
  'cv.md',
  'config/profile.yml',
  'modes/_profile.md',
  'portals.yml',
  'article-digest.md',
  'interview-prep/story-bank.md',
  'data/',
  'reports/',
  'output/',
  'jds/',
];
