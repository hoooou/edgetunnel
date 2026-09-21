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

const context = { Set, Map, String, Number, Math, Date, console, log: () => {} };
vm.createContext(context);
vm.runInContext([
  extractFunction('解析国家代码白名单'),
  extractFunction('解析反代国家过滤配置'),
  extractFunction('筛选反代国家候选'),
  extractFunction('应用反代国家过滤'),
  'this.解析反代国家过滤配置 = 解析反代国家过滤配置;',
  'this.应用反代国家过滤 = 应用反代国家过滤;'
].join('\n'), context);

const disabled = context.解析反代国家过滤配置({});
assert.equal(disabled.允许国家.size, 0);
assert.equal(disabled.查询API, 'https://api.country.is/');
assert.equal(disabled.查询失败放行, false);
assert.equal(disabled.缓存毫秒, 86_400_000);

const configured = context.解析反代国家过滤配置({
  PROXYIP_COUNTRY_ALLOW: 'SG,JP,TW,US,CA',
  PROXYIP_COUNTRY_API: 'https://geo.example/',
  PROXYIP_COUNTRY_CACHE_TTL: '3600',
  PROXYIP_COUNTRY_FAIL_OPEN: 'true'
});
assert.deepEqual([...configured.允许国家], ['SG', 'JP', 'TW', 'US', 'CA']);
assert.equal(configured.查询API, 'https://geo.example/');
assert.equal(configured.缓存毫秒, 3_600_000);
assert.equal(configured.查询失败放行, true);

(async () => {
  const candidates = [['1.1.1.1', 443], ['2.2.2.2', 443], ['3.3.3.3', 443]];
  let lookups = 0;
  const filtered = await context.应用反代国家过滤(candidates, {
    允许国家: new Set(['SG', 'JP']),
    查询API: 'https://geo.example/',
    缓存毫秒: 1000,
    查询失败放行: false
  }, async ips => {
    lookups++;
    assert.deepEqual(JSON.parse(JSON.stringify(ips)), ['1.1.1.1', '2.2.2.2', '3.3.3.3']);
    return new Map([['1.1.1.1', 'SG'], ['2.2.2.2', 'HK'], ['3.3.3.3', 'JP']]);
  });
  assert.deepEqual(JSON.parse(JSON.stringify(filtered)), [['1.1.1.1', 443], ['3.3.3.3', 443]]);
  assert.equal(lookups, 1);

  const untouched = await context.应用反代国家过滤(candidates, disabled, async () => {
    throw new Error('disabled filter must not query GeoIP');
  });
  assert.deepEqual(JSON.parse(JSON.stringify(untouched)), candidates);

  const sortAt = source.indexOf('const 排序后数组 = 所有反代数组.sort');
  const filterAt = source.indexOf('所有反代数组 = await 应用反代国家过滤');
  assert(filterAt !== -1 && filterAt < sortAt, 'country filtering must occur before sort/shuffle/slice');

  console.log('proxyip country integration tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
