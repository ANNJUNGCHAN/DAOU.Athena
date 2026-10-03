const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const crypto = require('crypto');
const root = path.resolve(__dirname, '../../../../..');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const dir = path.join(root, 'backend/ref/card-surface-templates/133H-2');
const registry = require(path.join(root, 'app/lib/board-template-registry'));
const contract = registry.contractFor('133H-2');
const matches = [];
function inspect(name, text) {
  const tag = text.match(/<[^>]*\bdata-node=["']14UQ-2["'][^>]*>/)?.[0];
  if (tag) matches.push({ source: name, ownerNode: '14UQ-2', ownerTrait: /\bbs-r-scroll-table\b/.test(tag), sourceSha256: sha(Buffer.from(text)) });
}
for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.html'))) inspect('backend/ref/card-surface-templates/133H-2/' + name, fs.readFileSync(path.join(dir, name), 'utf8'));
for (const [key, value] of Object.entries(contract)) if (typeof value === 'string' && value.includes('<')) inspect('registry.contractFor(133H-2).' + key, value);
console.log(JSON.stringify({ referenceBoard: '133H-2', contractKeys: Object.keys(contract), matches }));
assert.ok(matches.some(m => m.ownerTrait), 'public 133H-2 contract owns the legacy scroll-table node');
fs.writeFileSync(path.join(__dirname, 'contract-owner-result.json'), JSON.stringify({ status: 'PUBLIC_REFERENCE_OWNER_CONFIRMED', referenceBoard: '133H-2', actualNativeTemplateId: null, matches }, null, 2) + '\n');
