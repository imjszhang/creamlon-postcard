#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_REPO = 'imjszhang/creamlon-postcard';
const DEFAULT_CAPABILITY_ID = 'postcard';
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function usage() {
  return `Usage: node scripts/submit-private-postcard.mjs [options]

Options:
  --inbox-repo <owner/repo>       Buyer private inbox repository. Required.
  --requester <github:owner/repo> Creamlon requester principal. Required.
  --credential <crv1_...>         Complete private credential.
  --credential-file <path>        JSON or text file containing the complete credential.
  --input <text>                  Private postcard prompt text.
  --input-file <path>             File containing the private postcard prompt.
  --request-id <id>               Request id (default: random UUID).
  --repo <owner/repo>             Public seller repository (default: imjszhang/creamlon-postcard).
  --repo-path <dir>               Local seller repository path (default: cwd).
  --creamlon-path <dir>           Local js-creamlon checkout.
  --expires <iso>                 Optional task expiry.
  --dry-run                       Write nothing and submit nothing; print the planned public task metadata.
  --help                          Show this help.
`;
}

function parseArgs(argv) {
  const opts = {
    inboxRepo: null,
    requester: null,
    credential: null,
    credentialFile: null,
    input: null,
    inputFile: null,
    requestId: null,
    repo: null,
    repoPath: null,
    creamlonPath: null,
    expires: null,
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--inbox-repo') opts.inboxRepo = argv[++i];
    else if (arg === '--requester') opts.requester = argv[++i];
    else if (arg === '--credential') opts.credential = argv[++i];
    else if (arg === '--credential-file') opts.credentialFile = argv[++i];
    else if (arg === '--input') opts.input = argv[++i];
    else if (arg === '--input-file') opts.inputFile = argv[++i];
    else if (arg === '--request-id') opts.requestId = argv[++i];
    else if (arg === '--repo') opts.repo = argv[++i];
    else if (arg === '--repo-path') opts.repoPath = argv[++i];
    else if (arg === '--creamlon-path') opts.creamlonPath = argv[++i];
    else if (arg === '--expires') opts.expires = argv[++i];
    else if (arg === '--dry-run') opts.dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (opts.help) return opts;
  if (!opts.inboxRepo) throw new Error('--inbox-repo is required.');
  if (!opts.requester) throw new Error('--requester is required.');
  const credentialModes = [opts.credential, opts.credentialFile].filter((value) => value != null).length;
  if (credentialModes !== 1) {
    throw new Error('Provide exactly one of --credential or --credential-file.');
  }
  const inputModes = [opts.input, opts.inputFile].filter((value) => value != null).length;
  if (inputModes !== 1) {
    throw new Error('Provide exactly one of --input or --input-file.');
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

function parseRepoSlug(slug) {
  const parts = String(slug || '').split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Repository must be owner/repo: ${slug}`);
  }
  return { owner: parts[0], repo: parts[1] };
}

async function githubJson(url, token, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'creamlon-postcard-private-submit',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub API failed: ${response.status} ${url}\n${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function writeGitHubFile(repoSlug, filePath, content, message, token) {
  const { owner, repo } = parseRepoSlug(repoSlug);
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  let sha = null;
  try {
    const existing = await githubJson(`https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`, token);
    sha = existing.sha || null;
  } catch (error) {
    if (!error.message.includes('GitHub API failed: 404')) throw error;
  }
  return githubJson(`https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`, token, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      ...(sha ? { sha } : {}),
    }),
  });
}

function hashTextBytes(text) {
  return `sha256:${createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')}`;
}

function readCredential(opts) {
  if (opts.credential) return opts.credential.trim();
  const raw = readFileSync(path.resolve(opts.credentialFile), 'utf8').trim();
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.credential === 'string') return parsed.credential.trim();
  } catch {
    // Plain text credential files are also supported.
  }
  return raw;
}

function assertRequestId(value) {
  if (!ID_RE.test(value)) {
    throw new Error('request_id must start with an alphanumeric character and contain only letters, numbers, dot, underscore, colon, or hyphen.');
  }
  return value;
}

function runCreamlon(args, creamlonPath, env) {
  return spawnSync(process.execPath, [path.join(creamlonPath, 'bin', 'creamlon.mjs'), ...args], {
    cwd: creamlonPath,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

function redactSubmitOutput(output) {
  return String(output || '').replace(/crv1_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, 'crv1_<redacted>');
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
  if (!token) throw new Error('Missing GITHUB_TOKEN or GH_TOKEN.');

  const publicRepo = opts.repo || envFile.CREAMLON_NODE_REPO || DEFAULT_REPO;
  const creamlonPath = path.resolve(
    opts.creamlonPath
      || envFile.CREAMLON_PATH
      || process.env.CREAMLON_PATH
      || path.join(repoPath, '..', 'js-creamlon'),
  );
  if (!existsSync(path.join(creamlonPath, 'bin', 'creamlon.mjs'))) {
    throw new Error(`Creamlon CLI not found at ${creamlonPath}`);
  }

  const requestId = assertRequestId(opts.requestId || randomUUID());
  const inputText = opts.inputFile ? readFileSync(path.resolve(opts.inputFile), 'utf8') : opts.input;
  const inputDigest = hashTextBytes(inputText);
  const inputPath = `.creamlon-inbox/requests/${requestId}/input.txt`;
  const requestPath = `.creamlon-inbox/requests/${requestId}/request.json`;
  const extensions = {
    postcard_private_input: {
      version: '1',
      inbox_repo: opts.inboxRepo,
      input_path: inputPath,
    },
  };
  const requestMetadata = {
    version: '1',
    type: 'postcard_private_request',
    request_id: requestId,
    capability_id: DEFAULT_CAPABILITY_ID,
    input_media_type: 'text/plain',
    input_digest: inputDigest,
    public_request_repo: publicRepo,
    created_at: new Date().toISOString(),
  };

  if (opts.dryRun) {
    console.log(JSON.stringify({
      request_id: requestId,
      capability_id: DEFAULT_CAPABILITY_ID,
      input_digest: inputDigest,
      inbox_repo: opts.inboxRepo,
      input_path: inputPath,
      extensions,
    }, null, 2));
    return;
  }

  await writeGitHubFile(opts.inboxRepo, inputPath, inputText, `write private postcard input ${requestId}`, token);
  await writeGitHubFile(
    opts.inboxRepo,
    requestPath,
    `${JSON.stringify(requestMetadata, null, 2)}\n`,
    `write private postcard request ${requestId}`,
    token,
  );

  const workDir = path.join(repoPath, '.data', 'private-submit', requestId);
  mkdirSync(workDir, { recursive: true });
  const extensionsFile = path.join(workDir, 'extensions.json');
  writeFileSync(extensionsFile, `${JSON.stringify(extensions, null, 2)}\n`, 'utf8');

  const args = [
    'submit',
    publicRepo,
    '--capability-id',
    DEFAULT_CAPABILITY_ID,
    '--media-type',
    'text/plain',
    '--input-digest',
    inputDigest,
    '--requester',
    opts.requester,
    '--request-id',
    requestId,
    '--extensions-file',
    extensionsFile,
    '--credential',
    readCredential(opts),
    '--pretty',
  ];
  if (opts.expires) args.splice(args.length - 1, 0, '--expires', opts.expires);

  const result = runCreamlon(args, creamlonPath, { GITHUB_TOKEN: token, GH_TOKEN: token });
  const output = redactSubmitOutput(`${result.stdout || ''}${result.stderr || ''}`);
  if (result.status !== 0) {
    throw new Error(`creamlon submit failed.\n${output}`);
  }
  process.stdout.write(result.stdout);
}

main().catch((error) => {
  console.error(redactSubmitOutput(error.message));
  process.exit(1);
});
