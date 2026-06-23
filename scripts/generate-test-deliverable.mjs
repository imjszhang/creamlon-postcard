import { renderPostcard, hashText } from './lib/postcard-renderer.mjs';
import path from 'node:path';

const repoPath = path.resolve(process.argv[2] || process.cwd());

const inputText = [
  'to: Helix',
  'from: Creamlon Postcard Demo',
  'title: 测试交付物',
  'style: warm sunset over cream paper',
  'message: 这是一张用于预览效果的测试明信片。',
  'Creamlon 会读取你的私密 prompt，生成 postcard.png，',
  '并在 delivery.json 里记录签名与 digest 绑定。',
  '',
  '祝你今天心情像奶油色晚霞一样温柔。',
].join('\n');

const inputDigest = hashText(inputText);
const result = await renderPostcard({
  repoPath,
  issueNumber: 0,
  requestId: 'test-preview-001',
  inputText,
  inputDigest,
  credentialId: 'crv1_test_preview',
  capabilityId: 'postcard',
  deliveryBasePath: '.creamlon-inbox/deliveries/issue-0',
});

console.log(JSON.stringify({
  html: result.htmlPath,
  png: result.pngPath,
  delivery: result.deliveryPath,
  spec: result.delivery,
}, null, 2));
