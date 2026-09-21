const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(new URL('../_worker.js', `file://${__filename}`).pathname, 'utf8');

function extractFunction(name) {
  const asyncSignature = `async function ${name}`;
  const plainSignature = `function ${name}`;
  let start = source.indexOf(asyncSignature);
  if (start === -1) start = source.indexOf(plainSignature);
  assert.notEqual(start, -1, `missing production function: ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = null, escaped = false;
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

const context = { Map, Set, JSON, String, Math, Promise, console, log: () => {} };
vm.createContext(context);
vm.runInContext([
  'const 反代国家查询缓存 = new Map();',
  extractFunction('查询反代IP国家'),
  'this.查询反代IP国家 = 查询反代IP国家;'
].join('\n'), context);

(async () => {
  let calls = 0;
  const fetcher = async (_url, options) => {
    calls++;
    const ips = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ips.map(ip => ({ ip, country: ip.endsWith('.1') ? 'SG' : 'HK' }))
    };
  };

  const first = await context.查询反代IP国家(
    ['10.0.0.1', '10.0.0.2', '10.0.0.1'],
    'https://geo.example/',
    60_000,
    fetcher,
    1_000
  );
  assert.equal(first.get('10.0.0.1'), 'SG');
  assert.equal(first.get('10.0.0.2'), 'HK');
  assert.equal(calls, 1, 'duplicates should be removed before lookup');

  const cached = await context.查询反代IP国家(
    ['10.0.0.1', '10.0.0.2'],
    'https://geo.example/',
    60_000,
    fetcher,
    2_000
  );
  assert.equal(cached.get('10.0.0.1'), 'SG');
  assert.equal(calls, 1, 'valid cached results should avoid another API request');

  const many = Array.from({ length: 201 }, (_, i) => `192.0.2.${i + 1}`);
  await context.查询反代IP国家(many, 'https://geo.example/', 60_000, fetcher, 3_000);
  assert.equal(calls, 4, '201 uncached addresses should use three batches of at most 100');

  const failed = await context.查询反代IP国家(
    ['203.0.113.9'],
    'https://geo.example/',
    60_000,
    async () => { throw new Error('offline'); },
    4_000
  );
  assert.equal(failed.has('203.0.113.9'), false, 'lookup failure should remain unknown');

  console.log('proxyip country lookup tests passed');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
