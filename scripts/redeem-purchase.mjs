#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_REPO = 'imjszhang/creamlon-postcard';
const DEFAULT_PROVIDER = 'github-pages-demo-vendor';
const DEFAULT_CAPABILITY_ID = 'echo-cred';

function usage() {
  return `Usage: node scripts/redeem-purchase.mjs --issue <number> [options]

Options:
  --issue <number>          Public purchase redeem Issue number.
  --repo <owner/repo>       Public seller repository (default: imjszhang/creamlon-postcard).
  --repo-path <dir>         Local seller repository path (default: cwd).
  --creamlon-path <dir>     Local js-creamlon checkout.
  --expires-seconds <n>     Credential TTL in seconds (default: 3600).
  --dry-run                 Validate only; do not issue or write credentials.
  --help                    Show this help.
`;
}

function parseArgs(argv) {
  const opts = {
    issue: null,
    repo: null,
    repoPath: null,
    creamlonPath: null,
    expiresSeconds: 3600,
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--issue') opts.issue = Number.parseInt(argv[++i], 10);
    else if (arg === '--repo') opts.repo = argv[++i];
    else if (arg === '--repo-path') opts.repoPath = argv[++i];
    else if (arg === '--creamlon-path') opts.creamlonPath = argv[++i];
    else if (arg === '--expires-seconds') opts.expiresSeconds = Number.parseInt(argv[++i], 10);
    else if (arg === '--dry-run') opts.dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (opts.help) return opts;
  if (!Number.isInteger(opts.issue) || opts.issue < 1) throw new Error('--issue must be a positive integer.');
  if (!Number.isInteger(opts.expiresSeconds) || opts.expiresSeconds < 60) {
    throw new Error('--expires-seconds must be at least 60.');
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
  const parts = slug.split('/');
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
      'User-Agent': 'creamlon-postcard-purchase-redeemer',
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

async function fetchIssue(repoSlug, issueNumber, token) {
  const { owner, repo } = parseRepoSlug(repoSlug);
  return githubJson(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, token);
}

async function readGitHubFile(repoSlug, filePath, token) {
  const { owner, repo } = parseRepoSlug(repoSlug);
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  const file = await githubJson(`https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`, token);
  if (file.type !== 'file' || typeof file.content !== 'string') {
    throw new Error(`${repoSlug}:${filePath} is not a file.`);
  }
  return Buffer.from(file.content, file.encoding || 'base64').toString('utf8');
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

async function commentIssue(repoSlug, issueNumber, body, token) {
  const { owner, repo } = parseRepoSlug(repoSlug);
  return githubJson(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`, token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body }),
  });
}

function parsePurchaseIssue(body) {
  const source = body.replace(/```(?:yaml|yml)?\n([\s\S]*?)```/i, '$1');
  const parsed = {};
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Za-z0-9_.-]+):\s*(.*?)\s*$/.exec(trimmed);
    if (!match) continue;
    parsed[match[1]] = unquote(match[2]);
  }
  return parsed;
}

function unquote(value) {
  return value.replace(/^['"]|['"]$/g, '');
}

function assertField(object, field) {
  const value = object[field];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${field}.`);
  return value.trim();
}

function githubPrincipalLogin(value, field) {
  const match = /^github:([A-Za-z0-9-]{1,39})$/.exec(String(value || ''));
  if (!match) throw new Error(`${field} must be github:<login>.`);
  return match[1].toLowerCase();
}

function sameLogin(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

function validatePurchase(request, receipt, inboxManifest, publicRepo, issueAuthor) {
  const type = assertField(request, 'type');
  if (type !== 'purchase-redeem') throw new Error(`Unsupported request type: ${type}`);
  const provider = assertField(request, 'provider');
  if (provider !== DEFAULT_PROVIDER) throw new Error(`Unsupported provider: ${provider}`);
  const capabilityId = assertField(request, 'capability_id');
  if (capabilityId !== DEFAULT_CAPABILITY_ID) throw new Error(`Unsupported capability_id: ${capabilityId}`);
  const buyer = assertField(request, 'buyer');
  const paymentIntentId = assertField(request, 'payment_intent_id');
  const inboxRepo = assertField(request, 'inbox_repo');
  const buyerLogin = githubPrincipalLogin(buyer, 'buyer');
  const inboxOwner = parseRepoSlug(inboxRepo).owner;

  if (!sameLogin(issueAuthor, buyerLogin)) {
    throw new Error('Issue author does not match buyer.');
  }
  if (!sameLogin(inboxOwner, buyerLogin)) {
    throw new Error('Inbox repository owner does not match buyer.');
  }

  if (receipt.type !== 'purchase_receipt') throw new Error('Receipt type must be purchase_receipt.');
  if (receipt.provider !== provider) throw new Error('Receipt provider does not match request.');
  if (receipt.status !== 'paid') throw new Error('Receipt is not paid.');
  if (receipt.payment_intent_id !== paymentIntentId) throw new Error('Receipt payment_intent_id does not match request.');
  if (receipt.capability_id !== capabilityId) throw new Error('Receipt capability_id does not match request.');
  if (receipt.buyer !== buyer) throw new Error('Receipt buyer does not match request.');

  if (inboxManifest.type !== 'creamlon_private_inbox') throw new Error('Inbox manifest type must be creamlon_private_inbox.');
  if (inboxManifest.owner !== buyer) throw new Error('Inbox owner does not match buyer.');
  if (inboxManifest.public_request_repo !== publicRepo) throw new Error('Inbox public_request_repo does not match seller repo.');
}

function readIssuanceStore(storePath) {
  try {
    const parsed = JSON.parse(readFileSync(storePath, 'utf8'));
    if (!Array.isArray(parsed.issuances)) throw new Error('issuances must be an array');
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') return { issuances: [] };
    throw error;
  }
}

function writeIssuanceStore(storePath, store) {
  mkdirSync(path.dirname(storePath), { recursive: true });
  writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

function issueCredential(repoPath, creamlonPath, capabilityId, expiresAt, env) {
  const result = spawnSync(process.execPath, [
    path.join(creamlonPath, 'bin', 'creamlon.mjs'),
    'credential',
    'create',
    '--repo-path',
    repoPath,
    '--capability-id',
    capabilityId,
    '--expires',
    expiresAt,
    '--pretty',
  ], {
    cwd: creamlonPath,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: 'pipe',
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (result.status !== 0) throw new Error(`creamlon credential create failed.\n${output}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`creamlon credential create returned invalid JSON: ${error.message}\n${output}`);
  }
}

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
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

  const issue = await fetchIssue(publicRepo, opts.issue, token);
  const request = parsePurchaseIssue(issue.body || '');
  const inboxRepo = assertField(request, 'inbox_repo');
  const receiptPath = assertField(request, 'receipt_path');
  const paymentIntentId = assertField(request, 'payment_intent_id');
  const manifestPath = '.creamlon-inbox/manifest.json';
  const receipt = JSON.parse(await readGitHubFile(inboxRepo, receiptPath, token));
  const inboxManifest = JSON.parse(await readGitHubFile(inboxRepo, manifestPath, token));
  validatePurchase(request, receipt, inboxManifest, publicRepo, issue.user?.login);

  const storePath = path.join(repoPath, '.data', 'private-inbox-issuances.json');
  const store = readIssuanceStore(storePath);
  const existing = store.issuances.find((item) => item.payment_intent_id === paymentIntentId);
  if (existing) {
    console.log(`[skip] ${paymentIntentId} already issued as ${existing.credential_id}.`);
    return;
  }

  const expiresAt = new Date(Date.now() + opts.expiresSeconds * 1000).toISOString();
  if (opts.dryRun) {
    console.log(`[ok] ${paymentIntentId} is valid and would issue ${DEFAULT_CAPABILITY_ID} until ${expiresAt}.`);
    return;
  }

  const credential = issueCredential(repoPath, creamlonPath, DEFAULT_CAPABILITY_ID, expiresAt, { GITHUB_TOKEN: token, GH_TOKEN: token });
  const credentialPath = `.creamlon-inbox/credentials/${DEFAULT_CAPABILITY_ID}_${credential.credential_id}.json`;
  const delivery = {
    version: '1',
    type: 'credential_delivery',
    credential: credential.credential,
    credential_id: credential.credential_id,
    capability_id: DEFAULT_CAPABILITY_ID,
    payment_intent_id: paymentIntentId,
    expires_at: expiresAt,
    issued_by: `github:${publicRepo}`,
    purchase_issue: `${publicRepo}#${opts.issue}`,
  };
  await writeGitHubFile(
    inboxRepo,
    credentialPath,
    `${JSON.stringify(delivery, null, 2)}\n`,
    `deliver Creamlon credential ${credential.credential_id}`,
    token,
  );

  store.issuances.push({
    payment_intent_id: paymentIntentId,
    credential_id: credential.credential_id,
    capability_id: DEFAULT_CAPABILITY_ID,
    buyer: request.buyer,
    inbox_repo: inboxRepo,
    credential_path: credentialPath,
    purchase_issue: opts.issue,
    receipt_hash: hashJson(receipt),
    issued_at: new Date().toISOString(),
    expires_at: expiresAt,
  });
  writeIssuanceStore(storePath, store);

  await commentIssue(publicRepo, opts.issue, [
    'Creamlon Postcard ticket issued.',
    '',
    `- credential_id: ${credential.credential_id}`,
    `- capability_id: ${DEFAULT_CAPABILITY_ID}`,
    `- private_inbox: ${inboxRepo}`,
    `- credential_path: ${credentialPath}`,
    '',
    'The complete credential was written only to the buyer private inbox.',
  ].join('\n'), token);

  console.log(`[ok] Issued ${credential.credential_id} to ${inboxRepo}:${credentialPath}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
