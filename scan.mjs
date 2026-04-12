#!/usr/bin/env node

/**
 * scan.mjs — Zero-token portal scanner
 *
 * Fetches Greenhouse, Ashby, and Lever APIs directly, applies title
 * filters from portals.yml, deduplicates against existing history,
 * and appends new offers to pipeline.md + scan-history.tsv.
 *
 * Zero Claude API tokens — pure HTTP + JSON.
 *
 * Usage:
 *   node scan.mjs                  # scan all enabled companies
 *   node scan.mjs --dry-run        # preview without writing files
 *   node scan.mjs --company Cohere # scan a single company
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import yaml from 'js-yaml';

const parseYaml = yaml.load;
const CONCURRENCY = 10;
const FETCH_TIMEOUT_MS = 10_000;

export function createScanPaths(root = '.') {
  return {
    portals: join(root, 'portals.yml'),
    scanHistory: join(root, 'data/scan-history.tsv'),
    pipeline: join(root, 'data/pipeline.md'),
    applications: join(root, 'data/applications.md'),
  };
}

export function detectApi(company) {
  if (company.api && company.api.includes('greenhouse')) {
    return { type: 'greenhouse', url: company.api };
  }

  const url = company.careers_url || '';

  const ashbyMatch = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
  if (ashbyMatch) {
    return {
      type: 'ashby',
      url: `https://api.ashbyhq.com/posting-api/job-board/${ashbyMatch[1]}?includeCompensation=true`,
    };
  }

  const leverMatch = url.match(/jobs\.lever\.co\/([^/?#]+)/);
  if (leverMatch) {
    return {
      type: 'lever',
      url: `https://api.lever.co/v0/postings/${leverMatch[1]}`,
    };
  }

  const ghEuMatch = url.match(/job-boards(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/);
  if (ghEuMatch && !company.api) {
    return {
      type: 'greenhouse',
      url: `https://boards-api.greenhouse.io/v1/boards/${ghEuMatch[1]}/jobs`,
    };
  }

  return null;
}

export function parseGreenhouse(json, companyName) {
  const jobs = json.jobs || [];
  return jobs.map((job) => ({
    title: job.title || '',
    url: job.absolute_url || '',
    company: companyName,
    location: job.location?.name || '',
  }));
}

export function parseAshby(json, companyName) {
  const jobs = json.jobs || [];
  return jobs.map((job) => ({
    title: job.title || '',
    url: job.jobUrl || '',
    company: companyName,
    location: job.location || '',
  }));
}

export function parseLever(json, companyName) {
  if (!Array.isArray(json)) return [];
  return json.map((job) => ({
    title: job.text || '',
    url: job.hostedUrl || '',
    company: companyName,
    location: job.categories?.location || '',
  }));
}

export const PARSERS = {
  greenhouse: parseGreenhouse,
  ashby: parseAshby,
  lever: parseLever,
};

export async function fetchJson(url, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export function buildTitleFilter(titleFilter) {
  const positive = (titleFilter?.positive || []).map((keyword) => keyword.toLowerCase());
  const negative = (titleFilter?.negative || []).map((keyword) => keyword.toLowerCase());

  return (title) => {
    const lowered = title.toLowerCase();
    const hasPositive = positive.length === 0 || positive.some((keyword) => lowered.includes(keyword));
    const hasNegative = negative.some((keyword) => lowered.includes(keyword));
    return hasPositive && !hasNegative;
  };
}

export function loadSeenUrls(paths) {
  const seen = new Set();

  if (existsSync(paths.scanHistory)) {
    const lines = readFileSync(paths.scanHistory, 'utf-8').split('\n');
    for (const line of lines.slice(1)) {
      const url = line.split('\t')[0];
      if (url) seen.add(url);
    }
  }

  if (existsSync(paths.pipeline)) {
    const text = readFileSync(paths.pipeline, 'utf-8');
    for (const match of text.matchAll(/- \[[ x]\] (https?:\/\/\S+)/g)) {
      seen.add(match[1]);
    }
  }

  if (existsSync(paths.applications)) {
    const text = readFileSync(paths.applications, 'utf-8');
    for (const match of text.matchAll(/https?:\/\/[^\s|)]+/g)) {
      seen.add(match[0]);
    }
  }

  return seen;
}

export function loadSeenCompanyRoles(paths) {
  const seen = new Set();
  if (!existsSync(paths.applications)) return seen;

  const text = readFileSync(paths.applications, 'utf-8');
  for (const match of text.matchAll(/\|[^|]+\|[^|]+\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g)) {
    const company = match[1].trim().toLowerCase();
    const role = match[2].trim().toLowerCase();
    if (company && role && company !== 'company') {
      seen.add(`${company}::${role}`);
    }
  }

  return seen;
}

export function appendToPipeline(paths, offers) {
  if (offers.length === 0) return;

  let text = readFileSync(paths.pipeline, 'utf-8');
  const marker = '## Pendientes';
  const idx = text.indexOf(marker);

  if (idx === -1) {
    const processedIdx = text.indexOf('## Procesadas');
    const insertAt = processedIdx === -1 ? text.length : processedIdx;
    const block = `\n${marker}\n\n${offers.map((offer) => `- [ ] ${offer.url} | ${offer.company} | ${offer.title}`).join('\n')}\n\n`;
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  } else {
    const afterMarker = idx + marker.length;
    const nextSection = text.indexOf('\n## ', afterMarker);
    const insertAt = nextSection === -1 ? text.length : nextSection;
    const block = `\n${offers.map((offer) => `- [ ] ${offer.url} | ${offer.company} | ${offer.title}`).join('\n')}\n`;
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  }

  writeFileSync(paths.pipeline, text, 'utf-8');
}

export function appendToScanHistory(paths, offers, date) {
  if (!existsSync(paths.scanHistory)) {
    writeFileSync(paths.scanHistory, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n', 'utf-8');
  }

  const lines = offers
    .map((offer) => `${offer.url}\t${date}\t${offer.source}\t${offer.title}\t${offer.company}\tadded`)
    .join('\n') + '\n';

  appendFileSync(paths.scanHistory, lines, 'utf-8');
}

export async function parallelFetch(tasks, limit) {
  const results = [];
  let i = 0;

  async function next() {
    while (i < tasks.length) {
      const task = tasks[i++];
      results.push(await task());
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => next());
  await Promise.all(workers);
  return results;
}

export async function runScan({
  root = '.',
  dryRun = false,
  filterCompany = null,
  fetchJsonImpl = fetchJson,
  now = new Date(),
} = {}) {
  const paths = createScanPaths(root);

  if (!existsSync(paths.portals)) {
    throw new Error('portals.yml not found. Run onboarding first.');
  }

  const config = parseYaml(readFileSync(paths.portals, 'utf-8'));
  const companies = config.tracked_companies || [];
  const titleFilter = buildTitleFilter(config.title_filter);

  const targets = companies
    .filter((company) => company.enabled !== false)
    .filter((company) => !filterCompany || company.name.toLowerCase().includes(filterCompany))
    .map((company) => ({ ...company, _api: detectApi(company) }))
    .filter((company) => company._api !== null);

  const skippedCount = companies.filter((company) => company.enabled !== false).length - targets.length;
  const seenUrls = loadSeenUrls(paths);
  const seenCompanyRoles = loadSeenCompanyRoles(paths);
  const date = now.toISOString().slice(0, 10);

  let totalFound = 0;
  let totalFiltered = 0;
  let totalDupes = 0;
  const newOffers = [];
  const errors = [];

  const tasks = targets.map((company) => async () => {
    const { type, url } = company._api;
    try {
      const json = await fetchJsonImpl(url);
      const jobs = PARSERS[type](json, company.name);
      totalFound += jobs.length;

      for (const job of jobs) {
        if (!titleFilter(job.title)) {
          totalFiltered++;
          continue;
        }

        if (seenUrls.has(job.url)) {
          totalDupes++;
          continue;
        }

        const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}`;
        if (seenCompanyRoles.has(key)) {
          totalDupes++;
          continue;
        }

        seenUrls.add(job.url);
        seenCompanyRoles.add(key);
        newOffers.push({ ...job, source: `${type}-api` });
      }
    } catch (err) {
      errors.push({ company: company.name, error: err.message });
    }
  });

  await parallelFetch(tasks, CONCURRENCY);

  if (!dryRun && newOffers.length > 0) {
    appendToPipeline(paths, newOffers);
    appendToScanHistory(paths, newOffers, date);
  }

  return {
    date,
    dryRun,
    paths,
    skippedCount,
    targetsScanned: targets.length,
    totalFound,
    totalFiltered,
    totalDupes,
    newOffers,
    errors,
  };
}

function formatSummary(summary) {
  const lines = [];
  lines.push(`Scanning ${summary.targetsScanned} companies via API (${summary.skippedCount} skipped — no API detected)`);
  if (summary.dryRun) lines.push('(dry run — no files will be written)');
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`Portal Scan — ${summary.date}`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`Companies scanned:     ${summary.targetsScanned}`);
  lines.push(`Total jobs found:      ${summary.totalFound}`);
  lines.push(`Filtered by title:     ${summary.totalFiltered} removed`);
  lines.push(`Duplicates:            ${summary.totalDupes} skipped`);
  lines.push(`New offers added:      ${summary.newOffers.length}`);

  if (summary.errors.length > 0) {
    lines.push('');
    lines.push(`Errors (${summary.errors.length}):`);
    for (const error of summary.errors) {
      lines.push(`  ✗ ${error.company}: ${error.error}`);
    }
  }

  if (summary.newOffers.length > 0) {
    lines.push('');
    lines.push('New offers:');
    for (const offer of summary.newOffers) {
      lines.push(`  + ${offer.company} | ${offer.title} | ${offer.location || 'N/A'}`);
    }
    if (summary.dryRun) {
      lines.push('');
      lines.push('(dry run — run without --dry-run to save results)');
    } else {
      lines.push('');
      lines.push(`Results saved to ${summary.paths.pipeline} and ${summary.paths.scanHistory}`);
    }
  }

  lines.push('');
  lines.push('→ Run /career-ops pipeline to evaluate new offers.');
  lines.push('→ Share results and get help: https://discord.gg/8pRpHETxa4');

  return lines;
}

export async function main(args = process.argv.slice(2)) {
  const dryRun = args.includes('--dry-run');
  const companyFlag = args.indexOf('--company');
  const filterCompany = companyFlag !== -1 ? args[companyFlag + 1]?.toLowerCase() : null;

  const summary = await runScan({
    root: process.cwd(),
    dryRun,
    filterCompany,
  });

  for (const line of formatSummary(summary)) {
    console.log(line);
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entrypoint && import.meta.url === entrypoint) {
  main().catch((err) => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
