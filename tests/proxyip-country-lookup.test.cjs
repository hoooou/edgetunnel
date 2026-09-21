const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(new URL('../_worker.js', `file://${__filename}`).pathname, 'utf8');

function extractFunction(name) {
  const signatures = [`async function ${name}`, `function ${name}`];
  let start = -1;
  for (const signature of signatures) { start = source.indexOf(signature); if (start !== -1) break; }
  assert.notEqual(start, -1, `missing production function: ${name}`);
  const signatureEnd = source.indexOf(') {', start);
  const brace = signatureEnd + 2;
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
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function: ${name}`);
}

const context = { Map, Set, JSON, String, Number, Math, Promise, console, encodeURIComponent, log: () => {} };
vm.createContext(context);
vm.runInContext([
  'const 反代国家查询缓存 = new Map();',
  extractFunction('查询单个反代国家服务'),
  extractFunction('查询反代IP国家'),
  'this.查询反代IP国家 = 查询反代IP国家;'
].join('\n'), context);

(async () => {
  const calls = [];
  const fetcher = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === 'https://api.country.is/') {
      const ips = JSON.parse(options.body);
      return { ok: true, json: async () => ips.filter(ip => ip.endsWith('.1')).map(ip => ({ ip, country: 'SG' })) };
    }
    if (url.startsWith('http://ip-api.com/batch')) {
      const ips = JSON.parse(options.body).map(item => item.query);
      return { ok: true, json: async () => ips.filter(ip => ip.endsWith('.2')).map(ip => ({ status: 'success', query: ip, countryCode: 'HK' })) };
    }
    if (url.startsWith('https://ipwho.is/')) {
      const ip = decodeURIComponent(url.split('/').pop().split('?')[0]);
      return { ok: true, json: async () => ({ success: true, ip, country_code: 'US' }) };
    }
    throw new Error(`unexpected URL: ${url}`);
  };

  const providers = ['country-is', 'ip-api', 'ipwho-is'];
  const first = await context.查询反代IP国家(
    ['10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.1'],
    providers,
    60_000,
    fetcher,
    1_000
  );
  assert.equal(first.get('10.0.0.1'), 'SG');
  assert.equal(first.get('10.0.0.2'), 'HK');
  assert.equal(first.get('10.0.0.3'), 'US');
  assert.equal(calls.length, 3, 'each fallback provider should receive only unresolved addresses');
  assert.deepEqual(JSON.parse(calls[0].options.body), ['10.0.0.1', '10.0.0.2', '10.0.0.3']);
  assert.deepEqual(JSON.parse(calls[1].options.body).map(x => x.query), ['10.0.0.2', '10.0.0.3']);
  assert(calls[2].url.includes('10.0.0.3'));

  await context.查询反代IP国家(
    ['10.0.0.1', '10.0.0.2', '10.0.0.3'],
    providers,
    60_000,
    fetcher,
    2_000
  );
  assert.equal(calls.length, 3, 'valid cached results should avoid all provider requests');

  let batchCalls = 0;
  const batchFetcher = async (url, options = {}) => {
    assert.equal(url, 'https://api.country.is/');
    batchCalls++;
    const ips = JSON.parse(options.body);
    assert(ips.length <= 100, 'provider batch must not exceed 100 addresses');
    return { ok: true, json: async () => ips.map(ip => ({ ip, country: 'US' })) };
  };
  const many = Array.from({ length: 201 }, (_, i) => `192.0.2.${i + 1}`);
  await context.查询反代IP国家(many, ['country-is'], 60_000, batchFetcher, 3_000);
  assert.equal(batchCalls, 3, '201 uncached addresses should use three country-is batches');

  const failed = await context.查询反代IP国家(
    ['203.0.113.9'],
    providers,
    60_000,
    async () => { throw new Error('offline'); },
    4_000
  );
  assert.equal(failed.has('203.0.113.9'), false, 'all-provider failure should remain unknown');

  console.log('proxyip country provider-chain tests passed');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
