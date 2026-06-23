#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { renderPostcard, hashText } from './lib/postcard-renderer.mjs';

const DEFAULT_REPO = 'imjszhang/creamlon-postcard';
const DEFAULT_CAPABILITY_ID = 'postcard';
const DEFAULT_GITHUB_TIMEOUT_MS = 30_000;
const DEFAULT_TASK_TIMEOUT_MS = 120_000;
const DEFAULT_TASK_DELAY_MS = 1_000;
const STOP_AFTER_STAGES = new Set(['preflight', 'render', 'deliver']);

function usage() {
  return `Usage: node scripts/auto-deliver.mjs [options]

Options:
  --dry-run                 Alias for --stop-after preflight.
  --push                    Commit and push public trust files after delivery.
  --capability-id <id>      Capability to auto-deliver (default: postcard).
  --issue <n>               Process one explicit GitHub Issue number.
  --limit <n>               Max tasks to process in one run (default: 1).
  --batch                   Allow processing more than one task in one run.
  --stop-after <stage>      Stop after preflight, render, or deliver for review.
  --publish-reviewed        Publish local artifacts from a reviewed --stop-after deliver run.
  --allow-overwrite-private Allow overwriting existing private inbox delivery files.
  --repo <owner/repo>       Override target GitHub repository.
  --repo-path <dir>         Override local node repository path.
  --creamlon-path <dir>     Override local js-creamlon checkout.
  --github-timeout-ms <n>   GitHub API timeout in milliseconds (default: 30000).
  --task-timeout-ms <n>     Per task render/CLI timeout in milliseconds (default: 120000).
  --task-delay-ms <n>       Delay between delivered tasks in milliseconds (default: 1000).
  --keep-artifacts          Keep local .data/auto-deliver artifacts after delivery (default in review mode).
  --help                    Show this help.
`;
}

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    push: false,
    capabilityId: DEFAULT_CAPABILITY_ID,
    issueNumber: null,
    limit: 1,
    batch: false,
    stopAfter: null,
    publishReviewed: false,
    allowOverwritePrivate: false,
    repo: null,
    repoPath: null,
    creamlonPath: null,
    githubTimeoutMs: null,
    taskTimeoutMs: null,
    taskDelayMs: null,
    keepArtifacts: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--push') {
      opts.push = true;
    } else if (arg === '--capability-id') {
      opts.capabilityId = argv[++i];
    } else if (arg === '--issue') {
      opts.issueNumber = Number.parseInt(argv[++i], 10);
    } else if (arg === '--limit') {
      opts.limit = Number.parseInt(argv[++i], 10);
    } else if (arg === '--batch') {
      opts.batch = true;
    } else if (arg === '--stop-after') {
      opts.stopAfter = argv[++i];
    } else if (arg === '--publish-reviewed') {
      opts.publishReviewed = true;
    } else if (arg === '--allow-overwrite-private') {
      opts.allowOverwritePrivate = true;
    } else if (arg === '--repo') {
      opts.repo = argv[++i];
    } else if (arg === '--repo-path') {
      opts.repoPath = argv[++i];
    } else if (arg === '--creamlon-path') {
      opts.creamlonPath = argv[++i];
    } else if (arg === '--github-timeout-ms') {
      opts.githubTimeoutMs = Number.parseInt(argv[++i], 10);
    } else if (arg === '--task-timeout-ms') {
      opts.taskTimeoutMs = Number.parseInt(argv[++i], 10);
    } else if (arg === '--task-delay-ms') {
      opts.taskDelayMs = Number.parseInt(argv[++i], 10);
    } else if (arg === '--keep-artifacts') {
      opts.keepArtifacts = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!opts.capabilityId) throw new Error('--capability-id is required.');
  if (opts.dryRun) opts.stopAfter = 'preflight';
  if (opts.issueNumber !== null && (!Number.isInteger(opts.issueNumber) || opts.issueNumber < 1)) {
    throw new Error('--issue must be a positive integer.');
  }
  if (!Number.isInteger(opts.limit) || opts.limit < 1) {
    throw new Error('--limit must be a positive integer.');
  }
  if (opts.limit > 1 && !opts.batch) {
    throw new Error('--limit > 1 requires --batch. Review mode processes one task by default.');
  }
  if (opts.stopAfter !== null && !STOP_AFTER_STAGES.has(opts.stopAfter)) {
    throw new Error('--stop-after must be one of: preflight, render, deliver.');
  }
  if (opts.publishReviewed && opts.issueNumber === null) {
    throw new Error('--publish-reviewed requires --issue.');
  }
  if (opts.publishReviewed && opts.stopAfter) {
    throw new Error('--publish-reviewed cannot be used with --stop-after.');
  }
  if (opts.push && opts.stopAfter) {
    throw new Error('--push cannot be used with --stop-after.');
  }
  for (const [name, value, min] of [
    ['--github-timeout-ms', opts.githubTimeoutMs, 1],
    ['--task-timeout-ms', opts.taskTimeoutMs, 1],
    ['--task-delay-ms', opts.taskDelayMs, 0],
  ]) {
    if (value !== null && (!Number.isInteger(value) || value < min)) {
      throw new Error(`${name} must be an integer >= ${min}.`);
    }
  }
  return opts;
}

function loadEnvFile(repoPath) {
  const envPath = path.join(repoPath, '.env');
  if (!existsSync(envPath)) return {};
  const env = {};
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    env[key] = value;
  }
  return env;
}

function numberSetting(name, cliValue, envFile, fallback, min = 1) {
  const raw = cliValue ?? envFile[name] ?? process.env[name] ?? fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} must be an integer >= ${min}.`);
  }
  return value;
}

function boolSetting(name, cliValue, envFile, fallback = false) {
  if (cliValue) return true;
  const raw = envFile[name] ?? process.env[name];
  if (raw === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(String(raw).trim());
}

function tokenSetting(envFile, names) {
  for (const name of names) {
    const value = envFile[name] || process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return null;
}

function parseJsonOutput(result, label) {
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (result.error) {
    throw new Error(`${label} failed: ${result.error.message}\n${output}`);
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed.\n${output}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error.message}\n${output}`);
  }
}

function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function parseRepoSlug(slug) {
  const parts = slug.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Repository must be owner/repo: ${slug}`);
  }
  return { owner: parts[0], repo: parts[1] };
}

function sameLogin(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

function sameRepoSlug(left, right) {
  const leftRepo = parseRepoSlug(left);
  const rightRepo = parseRepoSlug(right);
  return sameLogin(leftRepo.owner, rightRepo.owner) && sameLogin(leftRepo.repo, rightRepo.repo);
}

async function loadTaskParser(creamlonPath) {
  const taskLib = path.join(creamlonPath, 'lib', 'task.mjs');
  const mod = await import(pathToFileURL(taskLib).href);
  if (typeof mod.parseTask !== 'function') {
    throw new Error(`Creamlon task parser is unavailable: ${taskLib}`);
  }
  return mod.parseTask;
}

async function fetchIssueBody(repoSlug, issueNumber, token, timeoutMs) {
  const { owner, repo } = parseRepoSlug(repoSlug);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'creamlon-postcard-auto-deliver',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Timed out reading Issue #${issueNumber} after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Failed to read Issue #${issueNumber}: HTTP ${response.status}\n${text}`);
  }
  const issue = JSON.parse(text);
  return issue.body || '';
}

function runCreamlon(args, creamlonPath, env, timeoutMs) {
  return spawnSync(process.execPath, [path.join(creamlonPath, 'bin', 'creamlon.mjs'), ...args], {
    cwd: creamlonPath,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: timeoutMs,
  });
}

function runGit(args, cwd) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

async function githubJson(url, token, init = {}, timeoutMs = DEFAULT_GITHUB_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'creamlon-postcard-auto-deliver',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.headers || {}),
      },
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`GitHub API timed out after ${timeoutMs}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub API failed: ${response.status} ${url}\n${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function writeGitHubFile(repoSlug, filePath, content, message, token, timeoutMs) {
  const { owner, repo } = parseRepoSlug(repoSlug);
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  let sha = null;
  try {
    const existing = await githubJson(`https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`, token, {}, timeoutMs);
    sha = existing.sha || null;
  } catch (error) {
    if (!error.message.includes('GitHub API failed: 404')) throw error;
  }
  return githubJson(`https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`, token, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message,
      content: Buffer.isBuffer(content)
        ? content.toString('base64')
        : Buffer.from(content, 'utf8').toString('base64'),
      ...(sha ? { sha } : {}),
    }),
  }, timeoutMs);
}

async function githubFileExists(repoSlug, filePath, token, timeoutMs) {
  const { owner, repo } = parseRepoSlug(repoSlug);
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  try {
    const file = await githubJson(`https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`, token, {}, timeoutMs);
    return file.type === 'file';
  } catch (error) {
    if (error.message.includes('GitHub API failed: 404')) return false;
    throw error;
  }
}

async function assertGitHubFilesDoNotExist(repoSlug, filePaths, token, timeoutMs) {
  for (const filePath of filePaths) {
    if (await githubFileExists(repoSlug, filePath, token, timeoutMs)) {
      throw new Error(`Private delivery file already exists and needs human review: ${repoSlug}:${filePath}. Use --allow-overwrite-private only after confirming it is safe.`);
    }
  }
}

async function readGitHubFile(repoSlug, filePath, token, timeoutMs) {
  const { owner, repo } = parseRepoSlug(repoSlug);
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  const file = await githubJson(`https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`, token, {}, timeoutMs);
  if (file.type !== 'file' || typeof file.content !== 'string') {
    throw new Error(`${repoSlug}:${filePath} is not a file.`);
  }
  return Buffer.from(file.content, file.encoding || 'base64').toString('utf8');
}

function readPrivateInboxIssuances(nodePath) {
  const storePath = path.join(nodePath, '.data', 'private-inbox-issuances.json');
  if (!existsSync(storePath)) return [];
  const parsed = JSON.parse(readFileSync(storePath, 'utf8'));
  return Array.isArray(parsed.issuances) ? parsed.issuances : [];
}

function publicTrustDir(nodePath) {
  const bundledTrust = path.join(nodePath, '.creamlon', 'trust');
  if (existsSync(bundledTrust)) return path.join('.creamlon', 'trust');
  return 'trust';
}

function reviewOutDir(nodePath, issueNumber) {
  return path.join(nodePath, '.data', 'auto-deliver', `issue-${issueNumber}`);
}

function reviewReportPath(nodePath, issueNumber) {
  return path.join(reviewOutDir(nodePath, issueNumber), 'run-report.json');
}

function privateDeliveryBasePath(issueNumber) {
  return `.creamlon-inbox/deliveries/issue-${issueNumber}`;
}

function privateDeliveryFilePaths(issueNumber) {
  const basePath = privateDeliveryBasePath(issueNumber);
  return [
    `${basePath}/postcard.png`,
    `${basePath}/postcard.html`,
    `${basePath}/delivery.json`,
    `${basePath}/proof.json`,
    `${basePath}/status.json`,
  ];
}

function writeReviewReport(nodePath, issueNumber, report) {
  const outDir = reviewOutDir(nodePath, issueNumber);
  mkdirSync(outDir, { recursive: true });
  const filePath = reviewReportPath(nodePath, issueNumber);
  writeFileSync(filePath, formatJson({
    ...report,
    updated_at: new Date().toISOString(),
  }), 'utf8');
  console.log(`[review] Wrote ${maskPathForLog(filePath)}.`);
}

function commitAndPushTrust(nodePath, issueNumber) {
  const trustDir = publicTrustDir(nodePath);
  const status = runGit(['status', '--porcelain', '--', trustDir], nodePath);
  if (status.status !== 0) {
    throw new Error(`git status failed.\n${status.stderr || status.stdout}`);
  }
  if (!status.stdout.trim()) {
    console.log(`[skip] ${trustDir} has no changes to publish.`);
    return;
  }

  for (const args of [
    ['add', trustDir],
    ['commit', '-m', `chore: publish Creamlon postcard proof #${issueNumber}`],
    ['push'],
  ]) {
    const result = runGit(args, nodePath);
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed.\n${result.stderr || result.stdout}`);
    }
  }
  console.log(`[ok] Published ${trustDir}.`);
}

function assertPrivateInboxPath(filePath, label) {
  const value = String(filePath || '').trim();
  if (
    !value.startsWith('.creamlon-inbox/')
    || value.includes('\\')
    || value.startsWith('/')
    || /^[A-Za-z]:/.test(value)
    || value.split('/').some((part) => part === '..' || part === '')
  ) {
    throw new Error(`${label} must be a safe path under .creamlon-inbox/.`);
  }
  return value;
}

function resolvePrivateInput(nodePath, parsedTask) {
  const credentialId = parsedTask.credential?.credential_id;
  if (!credentialId) throw new Error('Task is missing credential_id.');

  const issuance = readPrivateInboxIssuances(nodePath)
    .find((item) => item.credential_id === credentialId);
  if (!issuance?.inbox_repo) {
    throw new Error(`No private inbox issuance found for credential_id ${credentialId}.`);
  }

  const privateInput = parsedTask.extensions?.postcard_private_input;
  if (!privateInput || typeof privateInput !== 'object' || Array.isArray(privateInput)) {
    throw new Error('Task is missing extensions.postcard_private_input.');
  }
  if (String(privateInput.version || '') !== '1') {
    throw new Error('extensions.postcard_private_input.version must be "1".');
  }
  const inboxRepo = String(privateInput.inbox_repo || '').trim();
  if (!sameRepoSlug(inboxRepo, issuance.inbox_repo)) {
    throw new Error('Private input inbox_repo does not match the issued credential inbox.');
  }
  const inputPath = assertPrivateInboxPath(privateInput.input_path, 'input_path');
  const expectedInputPath = `.creamlon-inbox/requests/${parsedTask.request_id}/input.txt`;
  if (inputPath !== expectedInputPath) {
    throw new Error(`input_path must match the task request_id: ${expectedInputPath}.`);
  }

  return { credentialId, issuance, inboxRepo, inputPath };
}

async function fetchPrivateInput(nodePath, parsedTask, token, timeoutMs) {
  if (!parsedTask.input?.digest) throw new Error('Private postcard tasks require input.digest.');
  const privateInput = resolvePrivateInput(nodePath, parsedTask);
  const inputText = await readGitHubFile(privateInput.inboxRepo, privateInput.inputPath, token, timeoutMs);
  const inputDigest = hashText(inputText);
  if (inputDigest !== parsedTask.input.digest) {
    throw new Error(`Private input digest mismatch: expected ${parsedTask.input.digest}, got ${inputDigest}.`);
  }
  return { ...privateInput, inputText, inputDigest };
}

async function writePrivateInboxDeliveryFiles(nodePath, issueNumber, parsedTask, artifacts, token, timeoutMs) {
  const privateInput = resolvePrivateInput(nodePath, parsedTask);
  const basePath = privateDeliveryBasePath(issueNumber);

  await writeGitHubFile(
    privateInput.inboxRepo,
    `${basePath}/postcard.png`,
    readFileSync(artifacts.pngPath),
    `deliver Creamlon postcard image #${issueNumber}`,
    token,
    timeoutMs,
  );
  await writeGitHubFile(
    privateInput.inboxRepo,
    `${basePath}/postcard.html`,
    readFileSync(artifacts.htmlPath, 'utf8'),
    `deliver Creamlon postcard HTML #${issueNumber}`,
    token,
    timeoutMs,
  );
  await writeGitHubFile(
    privateInput.inboxRepo,
    `${basePath}/delivery.json`,
    artifacts.deliveryJson,
    `deliver Creamlon postcard manifest #${issueNumber}`,
    token,
    timeoutMs,
  );
  console.log(`[ok] Wrote private postcard artifacts to ${privateInput.inboxRepo}:${basePath}.`);
}

function buildPrivateDeliveryStatus(publicRepo, issueNumber, parsedTask, privateInput) {
  const basePath = privateDeliveryBasePath(issueNumber);
  return {
    version: '1',
    type: 'postcard_delivery_status',
    issue_number: issueNumber,
    credential_id: privateInput.credentialId,
    capability_id: parsedTask.capability_id,
    delivered_at: new Date().toISOString(),
    public_proof_repo: publicRepo,
    delivery_path: `${basePath}/delivery.json`,
    postcard_path: `${basePath}/postcard.png`,
  };
}

async function writePrivateInboxProofFiles(nodePath, publicRepo, issueNumber, parsedTask, proof, token, timeoutMs) {
  const privateInput = resolvePrivateInput(nodePath, parsedTask);
  const basePath = privateDeliveryBasePath(issueNumber);
  const status = buildPrivateDeliveryStatus(publicRepo, issueNumber, parsedTask, privateInput);

  await writeGitHubFile(
    privateInput.inboxRepo,
    `${basePath}/proof.json`,
    formatJson(proof),
    `deliver Creamlon postcard proof #${issueNumber}`,
    token,
    timeoutMs,
  );
  await writeGitHubFile(
    privateInput.inboxRepo,
    `${basePath}/status.json`,
    formatJson(status),
    `deliver Creamlon postcard status #${issueNumber}`,
    token,
    timeoutMs,
  );
  console.log(`[ok] Wrote private proof metadata to ${privateInput.inboxRepo}:${basePath}.`);
}

function maskPathForLog(filePath) {
  return filePath.replace(/\\/g, '/');
}

function safeLockName(value) {
  return String(value).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 140);
}

async function withLocalLock(nodePath, scope, key, callback) {
  const lockDir = path.join(nodePath, '.data', 'locks', `${scope}-${safeLockName(key)}.lock`);
  mkdirSync(path.dirname(lockDir), { recursive: true });
  try {
    mkdirSync(lockDir);
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(`Another operator process is already handling ${scope} ${key}. Remove ${maskPathForLog(lockDir)} only after confirming it is stale.`);
    }
    throw error;
  }
  writeFileSync(path.join(lockDir, 'owner.json'), `${JSON.stringify({
    scope,
    key,
    pid: process.pid,
    created_at: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8');
  try {
    return await callback();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

function cleanupArtifacts(artifacts, keepArtifacts) {
  if (!artifacts?.outDir) return;
  if (keepArtifacts) {
    console.log(`[debug] Kept local artifacts at ${maskPathForLog(artifacts.outDir)}.`);
    return;
  }
  rmSync(artifacts.outDir, { recursive: true, force: true });
  console.log(`[ok] Removed local private artifacts from ${maskPathForLog(artifacts.outDir)}.`);
}

function keepArtifactsForRecovery(artifacts) {
  if (!artifacts?.outDir) return;
  console.log(`[warn] Kept local artifacts for recovery at ${maskPathForLog(artifacts.outDir)}.`);
}

function keepArtifactsForReview(artifacts) {
  if (!artifacts?.outDir) return;
  console.log(`[review] Kept local artifacts at ${maskPathForLog(artifacts.outDir)}.`);
}

function delay(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function assertTaskCanBeDelivered(task, parsedTask, capabilityId) {
  if (parsedTask.capability_id !== capabilityId) {
    throw new Error(`#${task.issue_number} capability mismatch: expected ${capabilityId}, got ${parsedTask.capability_id}.`);
  }
  if (parsedTask.input?.media_type !== 'text/plain') {
    throw new Error(`#${task.issue_number} is not text/plain: ${parsedTask.input?.media_type || 'unknown'}.`);
  }
  if (!parsedTask.input?.digest) {
    throw new Error(`#${task.issue_number} is missing private input.digest.`);
  }
}

function localArtifactPaths(artifacts) {
  if (!artifacts) return {};
  return {
    out_dir: maskPathForLog(artifacts.outDir),
    postcard_html: maskPathForLog(artifacts.htmlPath),
    postcard_png: maskPathForLog(artifacts.pngPath),
    delivery_json: maskPathForLog(artifacts.deliveryPath),
  };
}

function writeLocalProofFiles(artifacts, publicRepo, issueNumber, parsedTask, privateInput, proof) {
  const proofPath = path.join(artifacts.outDir, 'proof.json');
  const statusPath = path.join(artifacts.outDir, 'status.json');
  const status = buildPrivateDeliveryStatus(publicRepo, issueNumber, parsedTask, privateInput);
  writeFileSync(proofPath, formatJson(proof), 'utf8');
  writeFileSync(statusPath, formatJson(status), 'utf8');
  return {
    proof_json: maskPathForLog(proofPath),
    status_json: maskPathForLog(statusPath),
  };
}

function reviewedArtifactPaths(nodePath, issueNumber) {
  const outDir = reviewOutDir(nodePath, issueNumber);
  return {
    outDir,
    htmlPath: path.join(outDir, 'postcard.html'),
    pngPath: path.join(outDir, 'postcard.png'),
    deliveryPath: path.join(outDir, 'delivery.json'),
    proofPath: path.join(outDir, 'proof.json'),
    statusPath: path.join(outDir, 'status.json'),
  };
}

function readReviewedArtifacts(nodePath, issueNumber) {
  const paths = reviewedArtifactPaths(nodePath, issueNumber);
  for (const [name, filePath] of Object.entries(paths)) {
    if (name === 'outDir') continue;
    if (!existsSync(filePath)) {
      throw new Error(`Reviewed artifact is missing: ${maskPathForLog(filePath)}. Run --stop-after deliver before --publish-reviewed.`);
    }
  }
  return {
    outDir: paths.outDir,
    htmlPath: paths.htmlPath,
    pngPath: paths.pngPath,
    deliveryPath: paths.deliveryPath,
    deliveryJson: readFileSync(paths.deliveryPath, 'utf8'),
    proof: JSON.parse(readFileSync(paths.proofPath, 'utf8')),
    localProofPaths: {
      proof_json: maskPathForLog(paths.proofPath),
      status_json: maskPathForLog(paths.statusPath),
    },
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(usage());
    return;
  }

  const repoPath = path.resolve(opts.repoPath || process.cwd());
  const envFile = loadEnvFile(repoPath);
  const runtime = {
    githubTimeoutMs: numberSetting('POSTCARD_GITHUB_TIMEOUT_MS', opts.githubTimeoutMs, envFile, DEFAULT_GITHUB_TIMEOUT_MS),
    taskTimeoutMs: numberSetting('POSTCARD_TASK_TIMEOUT_MS', opts.taskTimeoutMs, envFile, DEFAULT_TASK_TIMEOUT_MS),
    taskDelayMs: numberSetting('POSTCARD_TASK_DELAY_MS', opts.taskDelayMs, envFile, DEFAULT_TASK_DELAY_MS, 0),
    keepArtifacts: boolSetting('POSTCARD_KEEP_ARTIFACTS', opts.keepArtifacts, envFile, true),
  };
  const legacyToken = tokenSetting(envFile, ['GITHUB_TOKEN', 'GH_TOKEN']);
  const publicToken = tokenSetting(envFile, ['CREAMLON_PUBLIC_GITHUB_TOKEN', 'POSTCARD_PUBLIC_GITHUB_TOKEN'])
    || legacyToken;
  const inboxToken = tokenSetting(envFile, ['CREAMLON_INBOX_GITHUB_TOKEN', 'POSTCARD_INBOX_GITHUB_TOKEN'])
    || legacyToken;
  if (!publicToken || !inboxToken) {
    throw new Error('Missing GitHub token. Set GITHUB_TOKEN/GH_TOKEN, or split CREAMLON_PUBLIC_GITHUB_TOKEN and CREAMLON_INBOX_GITHUB_TOKEN.');
  }

  const nodeRepo = opts.repo || envFile.CREAMLON_NODE_REPO || DEFAULT_REPO;
  const creamlonPath = path.resolve(
    opts.creamlonPath
      || envFile.CREAMLON_PATH
      || process.env.CREAMLON_PATH
      || path.join(repoPath, '..', 'js-creamlon'),
  );

  if (!existsSync(path.join(creamlonPath, 'bin', 'creamlon.mjs'))) {
    throw new Error(`Creamlon CLI not found at ${creamlonPath}`);
  }
  if (!existsSync(path.join(repoPath, '.creamlon', 'manifest.yaml'))) {
    throw new Error(`Bundled Creamlon manifest not found in ${repoPath}`);
  }

  const parseTask = await loadTaskParser(creamlonPath);
  const cliEnv = { GITHUB_TOKEN: publicToken, GH_TOKEN: publicToken };
  if (opts.publishReviewed) {
    const issueNumber = opts.issueNumber;
    const body = await fetchIssueBody(nodeRepo, issueNumber, publicToken, runtime.githubTimeoutMs);
    const parsed = parseTask(body);
    assertTaskCanBeDelivered({ issue_number: issueNumber }, parsed, opts.capabilityId);
    const privateInput = await fetchPrivateInput(repoPath, parsed, inboxToken, runtime.githubTimeoutMs);
    const privatePaths = privateDeliveryFilePaths(issueNumber);
    const artifacts = readReviewedArtifacts(repoPath, issueNumber);

    const status = runCreamlon([
      'status',
      '--repo-path',
      repoPath,
    ], creamlonPath, cliEnv, runtime.taskTimeoutMs);
    if (status.error || status.status !== 0) {
      throw new Error(`creamlon status failed.\n${status.error?.message || status.stderr || status.stdout}`);
    }
    if (!opts.allowOverwritePrivate) {
      await assertGitHubFilesDoNotExist(privateInput.inboxRepo, privatePaths, inboxToken, runtime.githubTimeoutMs);
    }
    await writePrivateInboxDeliveryFiles(repoPath, issueNumber, parsed, artifacts, inboxToken, runtime.githubTimeoutMs);
    await writePrivateInboxProofFiles(repoPath, nodeRepo, issueNumber, parsed, artifacts.proof, inboxToken, runtime.githubTimeoutMs);
    writeReviewReport(repoPath, issueNumber, {
      version: '1',
      mode: 'review',
      public_repo: nodeRepo,
      issue_number: issueNumber,
      request_id: parsed.request_id,
      capability_id: parsed.capability_id,
      credential_id: privateInput.credentialId,
      input_digest: privateInput.inputDigest,
      private_input: {
        inbox_repo: privateInput.inboxRepo,
        input_path: privateInput.inputPath,
        input_characters: privateInput.inputText.length,
      },
      planned_private_writes: privatePaths.map((filePath) => `${privateInput.inboxRepo}:${filePath}`),
      allow_overwrite_private: opts.allowOverwritePrivate,
      stage: 'publish-private',
      status: 'ok',
      local_artifacts: {
        ...localArtifactPaths(artifacts),
        ...artifacts.localProofPaths,
      },
      public_trust_dir: publicTrustDir(repoPath),
    });
    if (opts.push) {
      commitAndPushTrust(repoPath, issueNumber);
    } else {
      console.log(`[todo] Commit and push ${publicTrustDir(repoPath)}, or rerun with --push.`);
    }
    return;
  }

  const watch = runCreamlon([
    'watch',
    nodeRepo,
    '--repo-path',
    repoPath,
    '--once',
    '--pretty',
  ], creamlonPath, cliEnv, runtime.taskTimeoutMs);
  const watchJson = parseJsonOutput(watch, 'creamlon watch');
  const allTasks = watchJson.tasks || [];
  let targetedTask = null;
  if (opts.issueNumber !== null) {
    targetedTask = allTasks.find((task) => Number(task.issue_number) === opts.issueNumber);
    if (!targetedTask) {
      throw new Error(`#${opts.issueNumber} was not returned by creamlon watch.`);
    }
    if (!targetedTask.valid) {
      throw new Error(`#${opts.issueNumber} is not a valid pending task and needs human review.`);
    }
  }
  const tasks = targetedTask
    ? [targetedTask]
    : allTasks
      .filter((task) => task.valid && task.capability_id === opts.capabilityId)
      .slice(0, opts.limit);

  if (tasks.length === 0) {
    const target = opts.issueNumber === null ? `pending ${opts.capabilityId} tasks` : `Issue #${opts.issueNumber}`;
    console.log(`[ok] No valid ${target}.`);
    return;
  }
  if (!opts.batch && tasks.length > 1) {
    throw new Error(`Review mode expected one task, got ${tasks.length}. Use --batch only after reviewing the queue.`);
  }

  console.log(`[info] Found ${tasks.length} valid ${opts.capabilityId} task(s).`);
  for (const task of tasks) {
    const body = await fetchIssueBody(nodeRepo, task.issue_number, publicToken, runtime.githubTimeoutMs);
    const parsed = parseTask(body);
    assertTaskCanBeDelivered(task, parsed, opts.capabilityId);

    let deliveredTask = false;
    let stoppedForReview = null;
    await withLocalLock(repoPath, 'deliver', `${task.issue_number}-${parsed.request_id}`, async () => {
      let artifacts = null;
      try {
        const privateInput = await fetchPrivateInput(repoPath, parsed, inboxToken, runtime.githubTimeoutMs);
        const privatePaths = privateDeliveryFilePaths(task.issue_number);
        const baseReport = {
          version: '1',
          mode: 'review',
          public_repo: nodeRepo,
          issue_number: task.issue_number,
          request_id: parsed.request_id,
          capability_id: parsed.capability_id,
          credential_id: privateInput.credentialId,
          input_digest: privateInput.inputDigest,
          private_input: {
            inbox_repo: privateInput.inboxRepo,
            input_path: privateInput.inputPath,
            input_characters: privateInput.inputText.length,
          },
          planned_private_writes: privatePaths.map((filePath) => `${privateInput.inboxRepo}:${filePath}`),
          allow_overwrite_private: opts.allowOverwritePrivate,
        };
        if (!opts.allowOverwritePrivate) {
          await assertGitHubFilesDoNotExist(privateInput.inboxRepo, privatePaths, inboxToken, runtime.githubTimeoutMs);
        }
        writeReviewReport(repoPath, task.issue_number, {
          ...baseReport,
          stage: 'preflight',
          status: 'ok',
        });
        if (opts.stopAfter === 'preflight') {
          stoppedForReview = 'preflight';
          console.log(`[review] Stopped after preflight for Issue #${task.issue_number}.`);
          return;
        }

        const basePath = privateDeliveryBasePath(task.issue_number);
        artifacts = await renderPostcard({
          repoPath,
          issueNumber: task.issue_number,
          requestId: parsed.request_id,
          inputText: privateInput.inputText,
          inputDigest: privateInput.inputDigest,
          credentialId: privateInput.credentialId,
          capabilityId: parsed.capability_id,
          deliveryBasePath: basePath,
          timeoutMs: runtime.taskTimeoutMs,
        });
        writeReviewReport(repoPath, task.issue_number, {
          ...baseReport,
          stage: 'render',
          status: 'ok',
          local_artifacts: localArtifactPaths(artifacts),
        });
        if (opts.stopAfter === 'render') {
          stoppedForReview = 'render';
          console.log(`[review] Stopped after render for Issue #${task.issue_number}.`);
          return;
        }

        console.log(`[deliver] #${task.issue_number} output=${maskPathForLog(artifacts.deliveryPath)}`);
        const delivered = runCreamlon([
          'deliver',
          nodeRepo,
          String(task.issue_number),
          '--repo-path',
          repoPath,
          '--output-file',
          artifacts.deliveryPath,
          '--pretty',
        ], creamlonPath, cliEnv, runtime.taskTimeoutMs);
        const proof = parseJsonOutput(delivered, `creamlon deliver #${task.issue_number}`);
        const localProofPaths = writeLocalProofFiles(artifacts, nodeRepo, task.issue_number, parsed, privateInput, proof);

        const status = runCreamlon([
          'status',
          '--repo-path',
          repoPath,
        ], creamlonPath, cliEnv, runtime.taskTimeoutMs);
        if (status.error || status.status !== 0) {
          throw new Error(`creamlon status failed.\n${status.error?.message || status.stderr || status.stdout}`);
        }
        writeReviewReport(repoPath, task.issue_number, {
          ...baseReport,
          stage: 'deliver',
          status: 'ok',
          local_artifacts: {
            ...localArtifactPaths(artifacts),
            ...localProofPaths,
          },
          public_trust_dir: publicTrustDir(repoPath),
        });
        if (opts.stopAfter === 'deliver') {
          stoppedForReview = 'deliver';
          console.log(`[review] Stopped after deliver for Issue #${task.issue_number}. Review local trust changes before publishing.`);
          return;
        }

        if (!opts.allowOverwritePrivate) {
          await assertGitHubFilesDoNotExist(privateInput.inboxRepo, privatePaths, inboxToken, runtime.githubTimeoutMs);
        }
        await writePrivateInboxDeliveryFiles(repoPath, task.issue_number, parsed, artifacts, inboxToken, runtime.githubTimeoutMs);
        await writePrivateInboxProofFiles(repoPath, nodeRepo, task.issue_number, parsed, proof, inboxToken, runtime.githubTimeoutMs);
        writeReviewReport(repoPath, task.issue_number, {
          ...baseReport,
          stage: 'publish-private',
          status: 'ok',
          local_artifacts: {
            ...localArtifactPaths(artifacts),
            ...localProofPaths,
          },
          public_trust_dir: publicTrustDir(repoPath),
        });
        deliveredTask = true;
      } finally {
        if (deliveredTask) {
          cleanupArtifacts(artifacts, runtime.keepArtifacts);
        } else if (stoppedForReview) {
          keepArtifactsForReview(artifacts);
        } else {
          keepArtifactsForRecovery(artifacts);
        }
      }
    });
    if (!deliveredTask) {
      if (stoppedForReview) continue;
      throw new Error(`#${task.issue_number} did not complete delivery.`);
    }

    if (opts.push) {
      commitAndPushTrust(repoPath, task.issue_number);
    } else {
      console.log(`[todo] Commit and push ${publicTrustDir(repoPath)}, or rerun with --push.`);
    }
    await delay(runtime.taskDelayMs);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
