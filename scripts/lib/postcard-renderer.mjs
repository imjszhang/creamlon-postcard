import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export const POSTCARD_RENDERER_VERSION = 'postcard-html-playwright-v1';

function truncate(value, maxLength) {
  const text = String(value || '').trim().replace(/\r\n/g, '\n');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}...`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function extractField(input, names) {
  for (const name of names) {
    const pattern = new RegExp(`(?:^|\\n)\\s*${name}\\s*[:：]\\s*(.+)`, 'i');
    const match = pattern.exec(input);
    if (match) return match[1].trim();
  }
  return null;
}

export function buildPostcardSpec(inputText) {
  const source = truncate(inputText, 1600);
  const to = extractField(source, ['to', 'recipient', '收件人', '给']);
  const from = extractField(source, ['from', 'sender', '署名', '来自']);
  const title = extractField(source, ['title', 'headline', '标题', '主题']);
  const style = extractField(source, ['style', 'theme', '风格', '画面']);
  const message = extractField(source, ['message', 'body', '正文', '祝福语', '文案']);

  const headline = title || (to ? `For ${to}` : 'A Creamlon Postcard');
  const signature = from ? `From ${from}` : 'From your Creamlon agent';
  const theme = style || 'warm cream postcard';
  const body = message || source || 'A private postcard generated for you.';

  return {
    headline: truncate(headline, 72),
    message: truncate(body, 360),
    signature: truncate(signature, 72),
    theme: truncate(theme, 90),
  };
}

function loadLogoDataUri(repoPath) {
  const logoPath = path.join(repoPath, 'templates', 'assets', 'creamlon-logo.png');
  const bytes = readFileSync(logoPath);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

function fillTemplate(template, spec, logoSrc) {
  return template
    .replaceAll('{{headline}}', escapeHtml(spec.headline))
    .replaceAll('{{message}}', escapeHtml(spec.message))
    .replaceAll('{{signature}}', escapeHtml(spec.signature))
    .replaceAll('{{theme}}', escapeHtml(spec.theme))
    .replaceAll('{{logo_src}}', logoSrc);
}

export function hashBuffer(buffer) {
  return `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
}

export function hashText(text) {
  return hashBuffer(Buffer.from(text, 'utf8'));
}

export async function renderPostcard({
  repoPath,
  issueNumber,
  requestId,
  inputText,
  inputDigest,
  credentialId,
  capabilityId,
  deliveryBasePath,
  timeoutMs = 120_000,
}) {
  const outDir = path.join(repoPath, '.data', 'auto-deliver', `issue-${issueNumber}`);
  mkdirSync(outDir, { recursive: true });

  const templatePath = path.join(repoPath, 'templates', 'postcard.html');
  const template = readFileSync(templatePath, 'utf8');
  const spec = buildPostcardSpec(inputText);
  const logoSrc = loadLogoDataUri(repoPath);
  const html = fillTemplate(template, spec, logoSrc);
  const htmlPath = path.join(outDir, 'postcard.html');
  const pngPath = path.join(outDir, 'postcard.png');
  writeFileSync(htmlPath, html, 'utf8');

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (error) {
    throw new Error('Playwright is required to render postcard.png. Run npm install before auto-delivery.');
  }

  let browser;
  try {
    browser = await chromium.launch({ timeout: timeoutMs });
  } catch (error) {
    throw new Error(`Playwright Chromium is required to render postcard.png. Run "npx playwright install chromium" before auto-delivery. ${error.message}`);
  }
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(timeoutMs);
    await page.goto(`file://${htmlPath.replace(/\\/g, '/')}`, { waitUntil: 'load', timeout: timeoutMs });
    await page.screenshot({ path: pngPath, type: 'png', timeout: timeoutMs });
  } finally {
    await browser.close();
  }

  const pngBytes = readFileSync(pngPath);
  const htmlDigest = hashText(html);
  const pngDigest = hashBuffer(pngBytes);
  const delivery = {
    version: '1',
    type: 'postcard_delivery',
    request_id: requestId,
    issue_number: issueNumber,
    capability_id: capabilityId,
    credential_id: credentialId,
    input_digest: inputDigest,
    renderer: POSTCARD_RENDERER_VERSION,
    generated_at: new Date().toISOString(),
    files: {
      postcard_png: {
        path: `${deliveryBasePath}/postcard.png`,
        media_type: 'image/png',
        digest: pngDigest,
      },
      postcard_html: {
        path: `${deliveryBasePath}/postcard.html`,
        media_type: 'text/html',
        digest: htmlDigest,
      },
    },
  };
  const deliveryJson = `${JSON.stringify(delivery, null, 2)}\n`;
  const deliveryPath = path.join(outDir, 'delivery.json');
  writeFileSync(deliveryPath, deliveryJson, 'utf8');

  return {
    outDir,
    htmlPath,
    pngPath,
    deliveryPath,
    deliveryJson,
    delivery,
  };
}
