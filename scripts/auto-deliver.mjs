#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const DEFAULT_REPO = 'imjszhang/creamlon-postcard';
const DEFAULT_CAPABILITY_ID = 'echo-cred';

function usage() {
  return `Usage: node scripts/auto-deliver.mjs [options]

Options:
  --dry-run                 Parse pending tasks and prepare output plan only.
  --push                    Commit and push public trust files after delivery.
  --capability-id <id>      Capability to auto-deliver (default: echo-cred).
  --limit <n>               Max tasks to process in one run (default: 5).
  --repo <owner/repo>       Override target GitHub repository.
  --repo-path <dir>         Override local node repository path.
  --creamlon-path <dir>     Override local js-creamlon checkout.
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
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!opts.capabilityId) throw new Error('--capability-id is required.');
  if (!Number.isInteger(opts.limit) || opts.limit < 1) {
    throw new Error('--limit must be a positive integer.');
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

function parseJsonOutput(result, label) {
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
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

async function loadTaskParser(creamlonPath) {
  const taskLib = path.join(creamlonPath, 'lib', 'task.mjs');
  const mod = await import(pathToFileURL(taskLib).href);
  if (typeof mod.parseTask !== 'function') {
    throw new Error(`Creamlon task parser is unavailable: ${taskLib}`);
  }
  return mod.parseTask;
}

async function fetchIssueBody(repoSlug, issueNumber, token) {
  const { owner, repo } = parseRepoSlug(repoSlug);
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'creamlon-postcard-auto-deliver',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Failed to read Issue #${issueNumber}: HTTP ${response.status}\n${text}`);
  }
  const issue = JSON.parse(text);
  return issue.body || '';
}

function runCreamlon(args, creamlonPath, env) {
  return spawnSync(process.execPath, [path.join(creamlonPath, 'bin', 'creamlon.mjs'), ...args], {
    cwd: creamlonPath,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

function runGit(args, cwd) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  });
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

function writePostcardOutput(nodePath, issueNumber, inputValue) {
  const outDir = path.join(nodePath, '.data', 'auto-deliver');
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `issue-${issueNumber}.txt`);
  const body = [
    'CREAMLON POSTCARD',
    '',
    'Your postcard was sealed by the Creamlon demo node.',
    '',
    `Issue: #${issueNumber}`,
    `Echo: ${inputValue}`,
    '',
    'The signed proof binds this output to the original GitHub task.',
  ].join('\n');
  writeFileSync(outFile, body, 'utf8');
  return outFile;
}

function maskPathForLog(filePath) {
  return filePath.replace(/\\/g, '/');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(usage());
    return;
  }

  const repoPath = path.resolve(opts.repoPath || process.cwd());
  const envFile = loadEnvFile(repoPath);
  const token = envFile.GITHUB_TOKEN || envFile.GH_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    throw new Error('Missing GITHUB_TOKEN or GH_TOKEN. Set it in .env or the current process.');
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
  const cliEnv = { GITHUB_TOKEN: token, GH_TOKEN: token };
  const watch = runCreamlon([
    'watch',
    nodeRepo,
    '--repo-path',
    repoPath,
    '--once',
    '--pretty',
  ], creamlonPath, cliEnv);
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
    const body = await fetchIssueBody(nodeRepo, task.issue_number, token);
    const parsed = parseTask(body);
    if (parsed.capability_id !== opts.capabilityId) {
      console.log(`[skip] #${task.issue_number} capability mismatch: ${parsed.capability_id}`);
      continue;
    }
    if (parsed.input?.media_type !== 'text/plain') {
      console.log(`[skip] #${task.issue_number} is not text/plain: ${parsed.input?.media_type || 'unknown'}`);
      continue;
    }
    if (typeof parsed.input?.value !== 'string') {
      console.log(`[skip] #${task.issue_number} is missing input.value.`);
      continue;
    }

    if (opts.dryRun) {
      console.log(`[dry-run] #${task.issue_number} would seal ${parsed.input.value.length} characters.`);
      continue;
    }

    const outFile = writePostcardOutput(repoPath, task.issue_number, parsed.input.value);
    console.log(`[deliver] #${task.issue_number} output=${maskPathForLog(outFile)}`);
    const delivered = runCreamlon([
      'deliver',
      nodeRepo,
      String(task.issue_number),
      '--repo-path',
      repoPath,
      '--output-file',
      outFile,
      '--pretty',
    ], creamlonPath, cliEnv);
    parseJsonOutput(delivered, `creamlon deliver #${task.issue_number}`);

    const status = runCreamlon([
      'status',
      '--repo-path',
      repoPath,
    ], creamlonPath, cliEnv);
    if (status.status !== 0) {
      throw new Error(`creamlon status failed.\n${status.stderr || status.stdout}`);
    }

    if (opts.push) {
      commitAndPushTrust(repoPath, task.issue_number);
    } else {
      console.log(`[todo] Commit and push ${publicTrustDir(repoPath)}, or rerun with --push.`);
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
