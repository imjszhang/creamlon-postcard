import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export const POSTCARD_RENDERER_VERSION = 'postcard-html-playwright-v2';

const DEFAULT_PUBLIC_REPO = 'imjszhang/creamlon-postcard';
const DEFAULT_PUBLIC_SITE_BASE_URL = 'https://imjszhang.github.io/creamlon-postcard';

const PALETTES = [
  {
    id: 'warm',
    label: 'Warm cream',
    keywords: ['warm', 'cream', 'sunset', 'soft', 'orange', 'gold'],
    background: 'radial-gradient(circle at 16% 18%, rgba(255, 202, 155, 0.5), transparent 25%), radial-gradient(circle at 85% 28%, rgba(255, 226, 164, 0.6), transparent 30%), linear-gradient(135deg, #fff4df 0%, #ffe3cd 52%, #f7c5b8 100%)',
    paper: '#fffaf1',
    ink: '#3b2b24',
    accent: '#d98666',
    accentDark: '#9d5a49',
    line: 'rgba(59, 43, 36, 0.18)',
    art: ['#f7a88c', '#ffe5ae', '#a6d5bf'],
  },
  {
    id: 'midnight',
    label: 'Midnight blue',
    keywords: ['night', 'midnight', 'moon', 'star', 'space', 'blue'],
    background: 'radial-gradient(circle at 18% 20%, rgba(111, 155, 255, 0.26), transparent 24%), radial-gradient(circle at 82% 24%, rgba(244, 197, 255, 0.26), transparent 28%), linear-gradient(135deg, #17213b 0%, #28375e 56%, #5f5b9a 100%)',
    paper: '#f7f2ff',
    ink: '#20253f',
    accent: '#7068ca',
    accentDark: '#34306f',
    line: 'rgba(52, 48, 111, 0.18)',
    art: ['#28375e', '#7068ca', '#f4c5ff'],
  },
  {
    id: 'botanical',
    label: 'Botanical mint',
    keywords: ['mint', 'forest', 'leaf', 'green', 'garden', 'botanical'],
    background: 'radial-gradient(circle at 18% 18%, rgba(166, 213, 191, 0.55), transparent 26%), radial-gradient(circle at 84% 32%, rgba(255, 245, 177, 0.45), transparent 30%), linear-gradient(135deg, #effff6 0%, #cdeedc 54%, #8ac6aa 100%)',
    paper: '#fbfff7',
    ink: '#223b2f',
    accent: '#4c9f78',
    accentDark: '#26654b',
    line: 'rgba(34, 59, 47, 0.18)',
    art: ['#8ac6aa', '#fff5b1', '#76a9d8'],
  },
  {
    id: 'rose',
    label: 'Rose letter',
    keywords: ['rose', 'pink', 'love', 'heart', 'romance', 'flower'],
    background: 'radial-gradient(circle at 20% 18%, rgba(255, 190, 208, 0.55), transparent 26%), radial-gradient(circle at 82% 26%, rgba(255, 235, 170, 0.45), transparent 28%), linear-gradient(135deg, #fff0f4 0%, #ffd4df 55%, #e9a1b6 100%)',
    paper: '#fff8f9',
    ink: '#432531',
    accent: '#d76f93',
    accentDark: '#93415f',
    line: 'rgba(67, 37, 49, 0.18)',
    art: ['#e9a1b6', '#ffd4df', '#fff0a8'],
  },
  {
    id: 'arcade',
    label: 'Arcade neon',
    keywords: ['neon', 'cyber', 'arcade', 'future', 'electric', 'purple'],
    background: 'radial-gradient(circle at 18% 18%, rgba(0, 230, 255, 0.32), transparent 24%), radial-gradient(circle at 82% 28%, rgba(255, 60, 184, 0.34), transparent 28%), linear-gradient(135deg, #110f28 0%, #2b1450 50%, #5f1d6c 100%)',
    paper: '#fbf7ff',
    ink: '#211832',
    accent: '#c247e7',
    accentDark: '#5f1d6c',
    line: 'rgba(95, 29, 108, 0.18)',
    art: ['#00e6ff', '#c247e7', '#fff06a'],
  },
  {
    id: 'festive',
    label: 'Festive red',
    keywords: ['festival', 'holiday', 'party', 'red', 'new year', 'celebrate'],
    background: 'radial-gradient(circle at 16% 18%, rgba(255, 218, 125, 0.46), transparent 24%), radial-gradient(circle at 84% 28%, rgba(255, 143, 119, 0.5), transparent 28%), linear-gradient(135deg, #fff0ce 0%, #ffb49a 50%, #c74343 100%)',
    paper: '#fff9ed',
    ink: '#3f2320',
    accent: '#d94d3f',
    accentDark: '#8f2f2a',
    line: 'rgba(63, 35, 32, 0.18)',
    art: ['#c74343', '#ffcf69', '#fff2bb'],
  },
];

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

function normalizeDigestHex(inputDigest) {
  const raw = String(inputDigest || '').trim().replace(/^sha256:/i, '');
  if (/^[a-f0-9]{64}$/i.test(raw)) return raw.toLowerCase();
  return createHash('sha256').update(String(inputDigest || ''), 'utf8').digest('hex');
}

function digestBytes(inputDigest) {
  const hex = normalizeDigestHex(inputDigest);
  const bytes = [];
  for (let index = 0; index < hex.length; index += 2) {
    bytes.push(Number.parseInt(hex.slice(index, index + 2), 16));
  }
  return { hex, bytes };
}

function pickPalette(theme, bytes) {
  const lowerTheme = String(theme || '').toLowerCase();
  const explicit = PALETTES.find((palette) => palette.keywords.some((keyword) => lowerTheme.includes(keyword)));
  return explicit || PALETTES[bytes[0] % PALETTES.length];
}

function percent(byte, min, max) {
  return min + ((byte / 255) * (max - min));
}

function buildFingerprintCells(hex) {
  return Array.from({ length: 64 }, (_, index) => {
    const value = Number.parseInt(hex[index], 16);
    const active = value % 2 === 1;
    const opacity = active ? (0.44 + (value / 16) * 0.48).toFixed(2) : '0.12';
    return `<span style="opacity:${opacity}" class="${active ? 'on' : ''}"></span>`;
  }).join('');
}

function buildArtShapes(bytes, palette) {
  const shapes = [];
  for (let index = 0; index < 14; index += 1) {
    const cursor = index * 4;
    const size = Math.round(percent(bytes[cursor % bytes.length], 34, 154));
    const left = Math.round(percent(bytes[(cursor + 1) % bytes.length], -8, 92));
    const top = Math.round(percent(bytes[(cursor + 2) % bytes.length], -10, 88));
    const color = palette.art[bytes[(cursor + 3) % bytes.length] % palette.art.length];
    const radius = bytes[(cursor + 2) % bytes.length] % 3 === 0 ? '28%' : '999px';
    const blur = bytes[(cursor + 1) % bytes.length] % 4 === 0 ? ' blur(1px)' : '';
    shapes.push(`<span class="art-shape" style="--x:${left}%;--y:${top}%;--s:${size}px;--c:${color};--r:${radius};--b:${blur};"></span>`);
  }
  return shapes.join('');
}

function buildVisualSpec(inputDigest, theme) {
  const { hex, bytes } = digestBytes(inputDigest);
  const palette = pickPalette(theme, bytes);
  const digestShort = `${hex.slice(0, 8)}.${hex.slice(8, 14)}`;
  const serial = `CP-${hex.slice(0, 4).toUpperCase()}-${hex.slice(4, 8).toUpperCase()}`;
  const rotation = Math.round(percent(bytes[8], -7, 7));
  const artAngle = Math.round(percent(bytes[9], 118, 168));
  const bodyStyle = [
    `--page-bg:${palette.background}`,
    `--paper:${palette.paper}`,
    `--ink:${palette.ink}`,
    `--accent:${palette.accent}`,
    `--accent-dark:${palette.accentDark}`,
    `--line:${palette.line}`,
    `--art-gradient:linear-gradient(${artAngle}deg, ${palette.art.join(', ')})`,
  ].join(';');

  return {
    palette,
    bodyStyle,
    artShapes: buildArtShapes(bytes, palette),
    digestShort,
    fingerprintCells: buildFingerprintCells(hex),
    rotation,
    serial,
  };
}

function loadLogoDataUri(repoPath) {
  const logoPath = path.join(repoPath, 'templates', 'assets', 'creamlon-logo.png');
  const bytes = readFileSync(logoPath);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

function fillTemplate(template, spec, logoSrc, visual) {
  return template
    .replaceAll('{{headline}}', escapeHtml(spec.headline))
    .replaceAll('{{message}}', escapeHtml(spec.message))
    .replaceAll('{{signature}}', escapeHtml(spec.signature))
    .replaceAll('{{theme}}', escapeHtml(spec.theme))
    .replaceAll('{{logo_src}}', logoSrc)
    .replaceAll('{{body_style}}', visual.bodyStyle)
    .replaceAll('{{palette_label}}', escapeHtml(visual.palette.label))
    .replaceAll('{{art_shapes}}', visual.artShapes)
    .replaceAll('{{fingerprint_cells}}', visual.fingerprintCells)
    .replaceAll('{{digest_short}}', escapeHtml(visual.digestShort))
    .replaceAll('{{stamp_rotation}}', String(visual.rotation))
    .replaceAll('{{serial}}', escapeHtml(visual.serial));
}

function publicBaseUrl(publicRepo) {
  const envUrl = process.env.POSTCARD_PUBLIC_SITE_BASE_URL;
  if (envUrl) return envUrl.replace(/\/+$/, '');
  if (!publicRepo || publicRepo === DEFAULT_PUBLIC_REPO) return DEFAULT_PUBLIC_SITE_BASE_URL;
  const [owner, repo] = publicRepo.split('/');
  if (!owner || !repo) return DEFAULT_PUBLIC_SITE_BASE_URL;
  return `https://${owner}.github.io/${repo}`;
}

function publicShareInfo(repoPath, publicRepo, issueNumber) {
  const route = `postcards/issue-${issueNumber}`;
  const outDir = path.join(repoPath, 'site', 'src', route);
  const url = `${publicBaseUrl(publicRepo)}/${route}/`;
  return {
    outDir,
    route,
    url,
    indexPath: path.join(outDir, 'index.html'),
    cardPath: path.join(repoPath, '.data', 'auto-deliver', `issue-${issueNumber}`, 'share-card.html'),
    imagePath: path.join(outDir, 'share.png'),
  };
}

function buildPublicSharePage({
  issueNumber,
  requestId,
  inputDigest,
  generatedAt,
  publicRepo,
  shareUrl,
  visual,
}) {
  const proofUrl = `https://github.com/${publicRepo}/blob/main/.creamlon/trust/proofs.log`;
  const repoUrl = `https://github.com/${publicRepo}`;
  const title = `Verified Creamlon Postcard #${issueNumber}`;
  const escapedTitle = escapeHtml(title);
  const escapedDigest = escapeHtml(inputDigest);
  const escapedRequestId = escapeHtml(requestId);
  const escapedGeneratedAt = escapeHtml(generatedAt);
  const escapedShareUrl = escapeHtml(shareUrl);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapedTitle}</title>
    <meta name="description" content="A public verification card for a private Creamlon Postcard delivery.">
    <meta property="og:title" content="${escapedTitle}">
    <meta property="og:description" content="Private postcard content stays in the buyer inbox. The public proof verifies the signed delivery.">
    <meta property="og:image" content="${escapedShareUrl}share.png">
    <meta property="og:url" content="${escapedShareUrl}">
    <style>
      :root {
        color-scheme: light;
        --bg: #f7f3ea;
        --surface: #fffaf1;
        --ink: ${visual.palette.ink};
        --muted: rgba(32, 32, 32, 0.62);
        --accent: ${visual.palette.accent};
        --accent-dark: ${visual.palette.accentDark};
        --line: ${visual.palette.line};
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
        color: var(--ink);
        background: ${visual.palette.background};
      }
      .page { width: min(1040px, calc(100% - 36px)); margin: 0 auto; padding: 42px 0 56px; }
      .hero {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(320px, 460px);
        gap: 28px;
        align-items: center;
      }
      .panel {
        border: 1px solid rgba(255, 255, 255, 0.76);
        border-radius: 28px;
        background: rgba(255, 250, 241, 0.9);
        box-shadow: 0 24px 70px rgba(40, 25, 20, 0.18);
      }
      .copy { padding: 34px; }
      .eyebrow {
        display: inline-flex;
        margin: 0 0 16px;
        padding: 7px 11px;
        border-radius: 999px;
        color: var(--accent-dark);
        background: rgba(255, 255, 255, 0.72);
        font-weight: 800;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      h1 { margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: clamp(42px, 8vw, 78px); line-height: 0.96; color: var(--accent-dark); }
      .lede { max-width: 660px; margin: 22px 0 0; color: var(--muted); font-size: 20px; line-height: 1.62; }
      .card { overflow: hidden; padding: 16px; }
      .card img { display: block; width: 100%; border-radius: 18px; box-shadow: 0 16px 38px rgba(40, 25, 20, 0.16); }
      .facts { display: grid; gap: 12px; margin-top: 24px; }
      .fact { display: grid; gap: 5px; padding: 15px 0; border-top: 1px solid var(--line); }
      .fact span { color: var(--muted); font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; }
      code { overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }
      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 44px;
        padding: 11px 16px;
        border: 1px solid var(--accent-dark);
        border-radius: 999px;
        color: var(--accent-dark);
        background: rgba(255, 255, 255, 0.72);
        font-weight: 800;
        text-decoration: none;
      }
      .button.primary { color: #fff; background: var(--accent-dark); }
      @media (max-width: 820px) { .hero { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="hero">
        <div class="panel copy">
          <p class="eyebrow">Verified private delivery</p>
          <h1>${escapedTitle}</h1>
          <p class="lede">The message and final postcard stay private in the buyer inbox. This public card exposes only the signed delivery identity, proof location, and a deterministic visual fingerprint.</p>
          <div class="facts" aria-label="Public verification data">
            <div class="fact"><span>Issue</span><code>#${issueNumber}</code></div>
            <div class="fact"><span>Request ID</span><code>${escapedRequestId}</code></div>
            <div class="fact"><span>Input digest</span><code>${escapedDigest}</code></div>
            <div class="fact"><span>Generated</span><code>${escapedGeneratedAt}</code></div>
          </div>
          <div class="actions">
            <a class="button primary" href="${proofUrl}">View public proof log</a>
            <a class="button" href="${repoUrl}">Inspect Creamlon node</a>
          </div>
        </div>
        <aside class="panel card" aria-label="Share image preview">
          <img src="./share.png" alt="Verified Creamlon Postcard share card">
        </aside>
      </section>
    </main>
  </body>
</html>
`;
}

function buildShareCardPage({ issueNumber, visual }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        width: 1200px;
        height: 630px;
        overflow: hidden;
        color: ${visual.palette.ink};
        background: ${visual.palette.background};
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .card {
        position: relative;
        width: 1120px;
        height: 550px;
        margin: 40px;
        padding: 52px;
        border: 1px solid rgba(255, 255, 255, 0.8);
        border-radius: 34px;
        background: ${visual.palette.paper};
        box-shadow: 0 28px 70px rgba(40, 25, 20, 0.22);
        overflow: hidden;
      }
      .art {
        position: absolute;
        inset: 0;
        background: var(--art-gradient);
        opacity: 0.88;
      }
      .art-shape {
        position: absolute;
        left: var(--x);
        top: var(--y);
        width: var(--s);
        height: var(--s);
        border-radius: var(--r);
        background: var(--c);
        filter: var(--b);
        opacity: 0.48;
        mix-blend-mode: screen;
      }
      .veil {
        position: absolute;
        inset: 0;
        background: linear-gradient(90deg, rgba(255,255,255,0.92), rgba(255,255,255,0.62) 48%, rgba(255,255,255,0.18));
      }
      .content {
        position: relative;
        z-index: 1;
        max-width: 680px;
      }
      .eyebrow {
        margin: 0 0 20px;
        color: ${visual.palette.accentDark};
        font-size: 24px;
        font-weight: 900;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }
      h1 {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        font-size: 82px;
        line-height: 0.94;
        color: ${visual.palette.accentDark};
      }
      .sub {
        margin: 24px 0 0;
        max-width: 600px;
        font-size: 30px;
        line-height: 1.28;
      }
      .fingerprint {
        position: absolute;
        right: 58px;
        bottom: 52px;
        display: grid;
        grid-template-columns: repeat(8, 13px);
        gap: 7px;
        padding: 22px;
        border-radius: 24px;
        background: rgba(255,255,255,0.76);
        transform: rotate(${visual.rotation}deg);
      }
      .fingerprint span {
        width: 13px;
        height: 13px;
        border-radius: 4px;
        background: ${visual.palette.accentDark};
      }
      .digest {
        position: absolute;
        right: 60px;
        top: 54px;
        padding: 12px 16px;
        border-radius: 999px;
        background: rgba(255,255,255,0.74);
        color: ${visual.palette.accentDark};
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 22px;
        font-weight: 800;
      }
    </style>
  </head>
  <body style="${visual.bodyStyle}">
    <main class="card">
      <div class="art">${visual.artShapes}</div>
      <div class="veil"></div>
      <section class="content">
        <p class="eyebrow">Creamlon Postcard #${issueNumber}</p>
        <h1>Private message. Public proof.</h1>
        <p class="sub">A signed delivery card with a deterministic visual fingerprint.</p>
      </section>
      <div class="digest">${escapeHtml(visual.digestShort)}</div>
      <div class="fingerprint" aria-hidden="true">${visual.fingerprintCells}</div>
    </main>
  </body>
</html>
`;
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
  publicRepo = DEFAULT_PUBLIC_REPO,
  timeoutMs = 120_000,
}) {
  const outDir = path.join(repoPath, '.data', 'auto-deliver', `issue-${issueNumber}`);
  mkdirSync(outDir, { recursive: true });

  const templatePath = path.join(repoPath, 'templates', 'postcard.html');
  const template = readFileSync(templatePath, 'utf8');
  const spec = buildPostcardSpec(inputText);
  const visual = buildVisualSpec(inputDigest, spec.theme);
  const logoSrc = loadLogoDataUri(repoPath);
  const html = fillTemplate(template, spec, logoSrc, visual);
  const htmlPath = path.join(outDir, 'postcard.html');
  const pngPath = path.join(outDir, 'postcard.png');
  writeFileSync(htmlPath, html, 'utf8');

  const generatedAt = new Date().toISOString();
  const share = publicShareInfo(repoPath, publicRepo, issueNumber);
  mkdirSync(share.outDir, { recursive: true });
  const publicHtml = buildPublicSharePage({
    issueNumber,
    requestId,
    inputDigest,
    generatedAt,
    publicRepo,
    shareUrl: share.url,
    visual,
  });
  const shareCardHtml = buildShareCardPage({ issueNumber, visual });
  writeFileSync(share.indexPath, publicHtml, 'utf8');
  writeFileSync(share.cardPath, shareCardHtml, 'utf8');

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
    await page.setViewportSize({ width: 1200, height: 630 });
    await page.goto(`file://${share.cardPath.replace(/\\/g, '/')}`, { waitUntil: 'load', timeout: timeoutMs });
    await page.screenshot({ path: share.imagePath, type: 'png', timeout: timeoutMs });
  } finally {
    await browser.close();
  }

  const pngBytes = readFileSync(pngPath);
  const sharePngBytes = readFileSync(share.imagePath);
  const htmlDigest = hashText(html);
  const pngDigest = hashBuffer(pngBytes);
  const publicHtmlDigest = hashText(publicHtml);
  const publicSharePngDigest = hashBuffer(sharePngBytes);
  const delivery = {
    version: '1',
    type: 'postcard_delivery',
    request_id: requestId,
    issue_number: issueNumber,
    capability_id: capabilityId,
    credential_id: credentialId,
    input_digest: inputDigest,
    renderer: POSTCARD_RENDERER_VERSION,
    generated_at: generatedAt,
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
    public_share: {
      url: share.url,
      page: {
        path: `${share.route}/index.html`,
        media_type: 'text/html',
        digest: publicHtmlDigest,
      },
      image: {
        path: `${share.route}/share.png`,
        media_type: 'image/png',
        digest: publicSharePngDigest,
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
    publicShareDir: share.outDir,
    publicShareUrl: share.url,
    publicShareImagePath: share.imagePath,
  };
}
