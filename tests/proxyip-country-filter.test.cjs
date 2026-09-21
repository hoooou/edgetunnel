const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(new URL('../_worker.js', `file://${__filename}`).pathname, 'utf8');

function extractFunction(name) {
  const signature = `function ${name}`;
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing production function: ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated function: ${name}`);
}

const context = {};
vm.createContext(context);
vm.runInContext([
  extractFunction('解析国家代码白名单'),
  extractFunction('筛选反代国家候选'),
  'this.解析国家代码白名单 = 解析国家代码白名单;',
  'this.筛选反代国家候选 = 筛选反代国家候选;'
].join('\n'), context);

const allowed = context.解析国家代码白名单(' sg,JP, tw,us,CA,sg ');
assert.deepEqual([...allowed], ['SG', 'JP', 'TW', 'US', 'CA']);

const candidates = [
  ['1.1.1.1', 443],
  ['2.2.2.2', 443],
  ['3.3.3.3', 2053],
  ['[2001:db8::1]', 443],
  ['unresolved.example', 443]
];
const countries = new Map([
  ['1.1.1.1', 'SG'],
  ['2.2.2.2', 'HK'],
  ['3.3.3.3', 'JP'],
  ['2001:db8::1', 'US']
]);

assert.deepEqual(
  context.筛选反代国家候选(candidates, countries, allowed, false),
  [
    ['1.1.1.1', 443],
    ['3.3.3.3', 2053],
    ['[2001:db8::1]', 443]
  ],
  'fail-closed filtering should keep only explicitly allowed countries'
);

assert.deepEqual(
  context.筛选反代国家候选(candidates, countries, allowed, true),
  [
    ['1.1.1.1', 443],
    ['3.3.3.3', 2053],
    ['[2001:db8::1]', 443],
    ['unresolved.example', 443]
  ],
  'fail-open filtering should preserve candidates with no country result'
);

console.log('proxyip country filter tests passed');
