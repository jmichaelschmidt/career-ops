#!/usr/bin/env node

/**
 * codex-policy.mjs — Codex advisory routing and safety contract.
 *
 * Keeps the Codex-specific usage boundary in code so test-all.mjs can
 * validate the behavior instead of trusting markdown instructions alone.
 */

import { existsSync } from 'fs';
import { join } from 'path';

export const KNOWN_MODES = new Set([
  'oferta',
  'ofertas',
  'contacto',
  'deep',
  'pdf',
  'training',
  'project',
  'tracker',
  'pipeline',
  'apply',
  'scan',
  'batch',
  'patterns',
  'followup',
  'interview-prep',
]);

export const CODEX_ADVISORY_ALLOWED_MODES = new Set([
  'discovery',
  'auto-pipeline',
  'oferta',
  'deep',
  'pdf',
  'tracker',
  'pipeline',
  'scan',
  'check-liveness',
]);

export const CODEX_ADVISORY_BLOCKED_MODES = new Set([
  'apply',
  'batch',
]);

export const REQUIRED_ONBOARDING_FILES = [
  'cv.md',
  'config/profile.yml',
  'modes/_profile.md',
  'portals.yml',
];

const JD_KEYWORDS = [
  'responsibilities',
  'requirements',
  'qualifications',
  'about the role',
  "we're looking for",
  'job description',
  'about you',
];

export function looksLikeJobInput(input = '') {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return false;
  if (/https?:\/\/\S+/.test(normalized)) return true;
  return JD_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

export function resolveMode(input = '') {
  const normalized = input.trim();
  if (!normalized) return 'discovery';

  const lowered = normalized.toLowerCase();
  if (KNOWN_MODES.has(lowered)) {
    return lowered;
  }

  if (looksLikeJobInput(normalized)) {
    return 'auto-pipeline';
  }

  return 'discovery';
}

export function getCodexPolicyDecision(mode) {
  if (CODEX_ADVISORY_BLOCKED_MODES.has(mode)) {
    return {
      allowed: false,
      reason: 'blocked in Codex advisory mode',
    };
  }

  if (CODEX_ADVISORY_ALLOWED_MODES.has(mode)) {
    return {
      allowed: true,
      reason: 'allowed in Codex advisory mode',
    };
  }

  return {
    allowed: false,
    reason: 'outside the Codex advisory allowlist',
  };
}

export function getUpdateActionPolicy(action = '') {
  const normalized = action.trim().toLowerCase();
  if (normalized === 'apply') {
    return {
      allowed: false,
      reason: 'system updates stay manual in Codex advisory mode',
    };
  }

  return {
    allowed: true,
    reason: 'read-only or non-mutating update action',
  };
}

export function getMissingOnboardingFiles({ root = null, existingFiles = null } = {}) {
  if (root) {
    return REQUIRED_ONBOARDING_FILES.filter((path) => !existsSync(join(root, path)));
  }

  const present = existingFiles instanceof Set ? existingFiles : new Set(existingFiles || []);
  return REQUIRED_ONBOARDING_FILES.filter((path) => !present.has(path));
}

export function shouldEnterOnboarding(options = {}) {
  return getMissingOnboardingFiles(options).length > 0;
}

export function validateApplyModeSafety(text) {
  const issues = [];
  const normalized = text.toLowerCase();
  const forbiddenClick = /\b(click|clic|hacer click).{0,40}(submit|send|apply|enviar|postular)/is;
  const negatedForbiddenClick = /(never|nunca).{0,20}(click|clic|hacer click).{0,40}(submit|send|apply|enviar|postular)/is;

  if (!normalized.includes('copy-paste')) {
    issues.push('apply mode must explicitly limit output to copy-paste answers');
  }

  if (!/(never|nunca).{0,80}(submit|send|apply|enviar|postular)/is.test(normalized)) {
    issues.push('apply mode must explicitly forbid final submission actions');
  }

  if (forbiddenClick.test(normalized) && !negatedForbiddenClick.test(normalized)) {
    issues.push('apply mode must not instruct the agent to click a final submit control');
  }

  return issues;
}
