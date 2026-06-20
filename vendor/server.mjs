#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const defaultCreamlonEntry = resolve(repoRoot, '..', 'js-creamlon', 'bin', 'creamlon.mjs');

const config = {
  port: numberEnv('PORT', 8787),
  publicBaseUrl: stringEnv('PUBLIC_BASE_URL', 'http://localhost:8787'),
  creamlonEntry: stringEnv('CREAMLON_ENTRY', defaultCreamlonEntry),
  creamlonRepoPath: stringEnv('CREAMLON_REPO_PATH', repoRoot),
  credentialTtlSeconds: numberEnv('CREAMLON_CREDENTIAL_TTL_SECONDS', 3600),
  issuanceStore: stringEnv('ISSUANCE_STORE', resolve(repoRoot, '.data', 'issuance.json')),
  perGithubLimit: numberEnv('POSTCARD_PER_GITHUB_LIMIT', 3),
};

const memoryRateLimit = new Map();

const server = createServer(async (request, response) => {
  try {
    await handleRequest(request, response);
  } catch (error) {
    console.error(error.message);
    sendJson(response, 500, { error: 'internal_server_error' });
  }
});

server.listen(config.port, () => {
  console.log(`creamlon-postcard vendor listening on ${config.publicBaseUrl}`);
});

async function handleRequest(request, response) {
  const url = new URL(request.url, config.publicBaseUrl);
  if (request.method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, { ok: true, service: 'creamlon-postcard-vendor' });
    return;
  }

  if (request.method !== 'POST' || url.pathname !== '/buy/echo-cred') {
    sendJson(response, 404, { error: 'not_found' });
    return;
  }

  const body = await readJsonBody(request);
  const normalized = normalizeRequest(body);
  const rateKey = `${clientIp(request)}:${normalized.github}`;
  const rateCount = memoryRateLimit.get(rateKey) || 0;
  if (rateCount >= config.perGithubLimit) {
    sendJson(response, 429, { error: 'rate_limited' });
    return;
  }
  memoryRateLimit.set(rateKey, rateCount + 1);

  const expiresAt = new Date(Date.now() + config.credentialTtlSeconds * 1000).toISOString();
  const credential = await createCredential(expiresAt);
  const issuance = {
    issuance_id: randomUUID(),
    created_at: new Date().toISOString(),
    credential_id: credential.credential_id,
    capability_id: 'echo-cred',
    github: normalized.github,
    ref: normalized.ref,
    skill: normalized.skill,
    skill_version: normalized.skill_version,
    expires_at: expiresAt,
    request_hash: hashJson(normalized),
  };

  await appendIssuance(issuance);

  sendJson(response, 200, {
    credential: credential.credential,
    credential_id: credential.credential_id,
    capability_id: 'echo-cred',
    expires_at: expiresAt,
    flavor: postcardFlavor(normalized.ref),
  });
}

async function createCredential(expiresAt) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    config.creamlonEntry,
    'credential',
    'create',
    '--repo-path',
    config.creamlonRepoPath,
    '--capability-id',
    'echo-cred',
    '--expires',
    expiresAt,
    '--pretty',
  ], {
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });

  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`credential create returned invalid JSON: ${error.message}\n${stderr || stdout}`);
  }
}

async function appendIssuance(record) {
  const store = await readIssuanceStore();
  store.issuances.push(record);
  await writeJsonAtomic(config.issuanceStore, store);
}

async function readIssuanceStore() {
  try {
    const raw = await readFile(config.issuanceStore, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.issuances)) {
      throw new Error('issuance store must contain an issuances array');
    }
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { issuances: [] };
    }
    throw error;
  }
}

async function writeJsonAtomic(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tmp, file);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) {
      throw new Error('request body too large');
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('request body must be JSON');
  }
}

function normalizeRequest(body) {
  const github = requireString(body.github, 'github').toLowerCase();
  if (!/^[a-z0-9-]{1,39}$/.test(github)) {
    throw new Error('github must be a GitHub login');
  }

  const ref = requireString(body.ref || 'local-dev', 'ref');
  if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(ref)) {
    throw new Error('ref must be 1-64 URL-safe characters');
  }

  const skill = requireString(body.skill || 'creamlon-postcard', 'skill');
  if (skill !== 'creamlon-postcard') {
    throw new Error('skill must be creamlon-postcard');
  }

  const skillVersion = String(body.skill_version || '0.1.0');
  if (!/^[0-9A-Za-z_.-]{1,32}$/.test(skillVersion)) {
    throw new Error('skill_version is invalid');
  }

  return {
    github,
    ref,
    skill,
    skill_version: skillVersion,
  };
}

function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function postcardFlavor(ref) {
  return `Postcard ticket sealed for ${ref}.`;
}

function hashJson(value) {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

function clientIp(request) {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return request.socket.remoteAddress || 'unknown';
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}

function stringEnv(name, fallback) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

function numberEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
