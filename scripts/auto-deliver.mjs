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

function usage() {
  return `Usage: node scripts/auto-deliver.mjs [options]

Options:
  --dry-run                 Parse pending tasks and prepare output plan only.
  --push                    Commit and push public trust files after delivery.
  --capability-id <id>      Capability to auto-deliver (default: postcard).
  --limit <n>               Max tasks to process in one run (default: 5).
  --repo <owner/repo>       Override target GitHub repository.
  --repo-path <dir>         Override local node repository path.
  --creamlon-path <dir>     Override local js-creamlon checkout.
  --github-timeout-ms <n>   GitHub API timeout in milliseconds (default: 30000).
  --task-timeout-ms <n>     Per task render/CLI timeout in milliseconds (default: 120000).
  --task-delay-ms <n>       Delay between delivered tasks in milliseconds (default: 1000).
  --keep-artifacts          Keep local .data/auto-deliver artifacts after delivery.
  --help                    Show this help.
`;
}

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    push: false,
    capabilityId: DEFAULT_CAPABILITY_ID,
    limit: 5,
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
    } else if (arg === '--limit') {
      opts.limit = Number.parseInt(argv[++i], 10);
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
  if (!Number.isInteger(opts.limit) || opts.limit < 1) {
    throw new Error('--limit must be a positive integer.');
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
  const basePath = `.creamlon-inbox/deliveries/issue-${issueNumber}`;

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

async function writePrivateInboxProofFiles(nodePath, publicRepo, issueNumber, parsedTask, proof, token, timeoutMs) {
  const privateInput = resolvePrivateInput(nodePath, parsedTask);
  const basePath = `.creamlon-inbox/deliveries/issue-${issueNumber}`;
  const status = {
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

  await writeGitHubFile(
    privateInput.inboxRepo,
    `${basePath}/proof.json`,
    `${JSON.stringify(proof, null, 2)}\n`,
    `deliver Creamlon postcard proof #${issueNumber}`,
    token,
    timeoutMs,
  );
  await writeGitHubFile(
    privateInput.inboxRepo,
    `${basePath}/status.json`,
    `${JSON.stringify(status, null, 2)}\n`,
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

function delay(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
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
    keepArtifacts: boolSetting('POSTCARD_KEEP_ARTIFACTS', opts.keepArtifacts, envFile),
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
  const watch = runCreamlon([
    'watch',
    nodeRepo,
    '--repo-path',
    repoPath,
    '--once',
    '--pretty',
  ], creamlonPath, cliEnv, runtime.taskTimeoutMs);
  const watchJson = parseJsonOutput(watch, 'creamlon watch');
  const tasks = (watchJson.tasks || [])
    .filter((task) => task.valid && task.capability_id === opts.capabilityId)
    .slice(0, opts.limit);

  if (tasks.length === 0) {
    console.log(`[ok] No valid pending ${opts.capabilityId} tasks.`);
    return;
  }

  console.log(`[info] Found ${tasks.length} valid ${opts.capabilityId} task(s).`);
  for (const task of tasks) {
    const body = await fetchIssueBody(nodeRepo, task.issue_number, publicToken, runtime.githubTimeoutMs);
    const parsed = parseTask(body);
    if (parsed.capability_id !== opts.capabilityId) {
      console.log(`[skip] #${task.issue_number} capability mismatch: ${parsed.capability_id}`);
      continue;
    }
    if (parsed.input?.media_type !== 'text/plain') {
      console.log(`[skip] #${task.issue_number} is not text/plain: ${parsed.input?.media_type || 'unknown'}`);
      continue;
    }
    if (!parsed.input?.digest) {
      console.log(`[skip] #${task.issue_number} is missing private input.digest.`);
      continue;
    }

    if (opts.dryRun) {
      let privateInput;
      try {
        privateInput = await fetchPrivateInput(repoPath, parsed, inboxToken, runtime.githubTimeoutMs);
      } catch (error) {
        console.log(`[skip] #${task.issue_number} private input is unavailable: ${error.message}`);
        continue;
      }
      console.log(`[dry-run] #${task.issue_number} would render ${privateInput.inputText.length} private characters from ${privateInput.inboxRepo}:${privateInput.inputPath}.`);
      continue;
    }

    let deliveredTask = false;
    await withLocalLock(repoPath, 'deliver', `${task.issue_number}-${parsed.request_id}`, async () => {
      let artifacts = null;
      try {
        let privateInput;
        try {
          privateInput = await fetchPrivateInput(repoPath, parsed, inboxToken, runtime.githubTimeoutMs);
        } catch (error) {
          console.log(`[skip] #${task.issue_number} private input is unavailable: ${error.message}`);
          return;
        }

        const basePath = `.creamlon-inbox/deliveries/issue-${task.issue_number}`;
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

        await writePrivateInboxDeliveryFiles(repoPath, task.issue_number, parsed, artifacts, inboxToken, runtime.githubTimeoutMs);
        await writePrivateInboxProofFiles(repoPath, nodeRepo, task.issue_number, parsed, proof, inboxToken, runtime.githubTimeoutMs);

        const status = runCreamlon([
          'status',
          '--repo-path',
          repoPath,
        ], creamlonPath, cliEnv, runtime.taskTimeoutMs);
        if (status.error || status.status !== 0) {
          throw new Error(`creamlon status failed.\n${status.error?.message || status.stderr || status.stdout}`);
        }
        deliveredTask = true;
      } finally {
        cleanupArtifacts(artifacts, runtime.keepArtifacts);
      }
    });
    if (!deliveredTask) continue;

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
