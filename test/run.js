'use strict';
/**
 * 覆写脚本自检：在沙箱里跑 main()，校验产出的配置自身是否自洽，
 * 并与 test/upstream-snapshot.yaml（上游 configfull.yaml 的快照）逐项对齐。
 *
 * 期望值一律从快照现算，不写死数字，这样同步上游后自检会跟着变，
 * 只有「脚本没跟上快照」才会报错。
 * 用法：node test/run.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const up = require('../tools/upstream.js');

const SCRIPT = path.resolve(__dirname, '..', 'Script', 'override.js');
const SNAPSHOT = path.resolve(__dirname, 'upstream-snapshot.yaml');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fail++;
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}
function ok(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}

/** 只提醒、不算失败：上游正常演进就可能触发的非致命问题 */
let warns = 0;
function w(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    warns++;
    console.log(`  ! ${name}\n      ${e.message}`);
  }
}

function load(transform) {
  let code = fs.readFileSync(SCRIPT, 'utf8');
  if (transform) code = transform(code);
  code += `
;module.exports = { main, options, regions, groupDefs, providerDefs, ruleList, fakeIpSets, isPublicDns, hostMatch };`;
  const sandbox = { module: { exports: {} }, console, require };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'override.js' });
  return sandbox.module.exports;
}

/** 一份贴近真实机场订阅的输入：含假节点、家宽节点、私有 DNS、hosts 映射 */
function fixture() {
  return {
    proxies: [
      { name: '🇭🇰 香港 01 IEPL', type: 'vmess', server: 'hk1.airport.example', port: 443, uuid: 'u1' },
      { name: '香港 02 家宽', type: 'trojan', server: 'hk2.airport.example', port: 443, password: 'p' },
      { name: 'JP 东京 01', type: 'vmess', server: 'jp1.airport.example', port: 443, uuid: 'u2' },
      { name: '🇺🇸 US 洛杉矶 0.5x', type: 'ss', server: '1.2.3.4', port: 8388, cipher: 'aes-128-gcm', password: 'p' },
      { name: 'Singapore-01', type: 'vless', server: 'sg1.airport.example', port: 443, uuid: 'u3', tls: true },
      { name: '🇰🇷 韩国 首尔', type: 'ss', server: 'kr1.airport.example', port: 8388, cipher: 'aes-128-gcm', password: 'p' },
      { name: '剩余流量：188.88 GB', type: 'ss', server: 'sub.airport.example', port: 1, cipher: 'aes-128-gcm', password: 'x' },
      { name: '官网 https://airport.example', type: 'ss', server: 'sub.airport.example', port: 2, cipher: 'aes-128-gcm', password: 'x' },
      { name: '🇭🇰 香港 01 IEPL', type: 'vmess', server: 'hk1.airport.example', port: 443, uuid: 'dup' },
      { name: '直连', type: 'direct' },
    ],
    dns: {
      listen: '0.0.0.0:1053',
      nameserver: ['https://doh.airport.example/dns-query', '223.5.5.5'],
      'proxy-server-nameserver': ['https://doh.airport.example/dns-query'],
    },
    hosts: { 'hk1.airport.example': '5.5.5.5' },
    'proxy-groups': [{ name: '机场自带组', type: 'select', proxies: ['🇭🇰 香港 01 IEPL'] }],
    rules: ['MATCH,机场自带组'],
  };
}

const BUILTIN = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE', 'GLOBAL']);

console.log('\n覆写脚本自检\n');

const api = load();
/** 上游快照的解析结果（含本地差异），作为一切「与上游一致」断言的期望值 */
const SNAP = up.applyLocalPatch(up.parse(fs.readFileSync(SNAPSHOT, 'utf8')));
const cfg = api.main(fixture());
const groupNames = cfg['proxy-groups'].map((g) => g.name);
const proxyNames = cfg.proxies.map((p) => p.name);
const known = new Set(groupNames.concat(proxyNames));

console.log('  ▸ 结构完整性');
t('返回对象包含核心字段', () => {
  for (const k of ['dns', 'hosts', 'proxies', 'proxy-groups', 'rule-providers', 'rules', 'tun', 'sniffer']) {
    ok(cfg[k] !== undefined, `缺少 ${k}`);
  }
});
t('规则条数与上游快照一致', () =>
  ok(cfg.rules.length === SNAP.ruleList.length, `脚本 ${cfg.rules.length} 条，快照 ${SNAP.ruleList.length} 条`));
t('规则集数量与上游快照一致', () =>
  ok(
    Object.keys(cfg['rule-providers']).length === SNAP.providerDefs.length,
    `脚本 ${Object.keys(cfg['rule-providers']).length} 个，快照 ${SNAP.providerDefs.length} 个`,
  ));
t('最后一条是 MATCH,Final', () => ok(cfg.rules[cfg.rules.length - 1] === 'MATCH,Final'));
t('机场自带的组和规则已被丢弃', () => {
  ok(!groupNames.some((n) => n === '机场自带组'));
  ok(!cfg.rules.some((r) => r.indexOf('机场自带组') >= 0));
});

console.log('\n  ▸ 与上游快照 1:1 对齐');
t('快照本身通过完整性校验', () => {
  const errs = up.validate(SNAP);
  ok(errs.length === 0, errs.join('; '));
});
t('规则集定义与快照逐条一致', () => {
  const BEH = { d: 'domain', i: 'ipcidr', c: 'classical' };
  ok(
    api.providerDefs.length === SNAP.providerDefs.length,
    `脚本 ${api.providerDefs.length} 个 / 快照 ${SNAP.providerDefs.length} 个`,
  );
  for (let i = 0; i < SNAP.providerDefs.length; i++) {
    const s = SNAP.providerDefs[i];
    const d = api.providerDefs[i];
    ok(d[0] === s.name, `第 ${i + 1} 个：${d[0]} ≠ ${s.name}`);
    ok(BEH[d[1]] === s.behavior, `${s.name} 的 behavior 不一致`);
    ok(d[2] === s.tag, `${s.name} 的前缀不一致`);
    ok(d[3] === s.path, `${s.name} 的路径不一致`);
    ok((d[4] || 'mrs') === s.format, `${s.name} 的格式不一致`);
  }
});
t('规则集 URL 拼回去与上游原始 URL 等价', () => {
  // 上游同一份文件有 refs/heads 与短写两种写法，归一化后再比
  const norm = (u) =>
    String(u)
      .replace('https://github.com/', 'https://raw.githubusercontent.com/')
      .replace('/raw/refs/heads/', '/')
      .replace('/raw/', '/')
      .replace('/refs/heads/', '/');
  for (const s of SNAP.providerDefs) {
    const mine = cfg['rule-providers'][s.name];
    ok(!!mine, `缺少规则集 ${s.name}`);
    ok(norm(mine.url) === norm(s.url), `${s.name}\n        脚本 ${mine.url}\n        上游 ${s.url}`);
  }
});
t('路由规则与快照逐条一致', () => {
  ok(api.ruleList.length === SNAP.ruleList.length, `脚本 ${api.ruleList.length} 条 / 快照 ${SNAP.ruleList.length} 条`);
  for (let i = 0; i < SNAP.ruleList.length; i++) {
    ok(api.ruleList[i] === SNAP.ruleList[i], `第 ${i + 1} 条：\n        ${api.ruleList[i]}\n        ${SNAP.ruleList[i]}`);
  }
});
t('fake-ip 白名单与快照一致', () => {
  ok(api.fakeIpSets.join(',') === SNAP.fakeIpSets.join(','), `\n      脚本 ${api.fakeIpSets.join(',')}\n      快照 ${SNAP.fakeIpSets.join(',')}`);
});
t('分流组划分与快照一致（含本地差异）', () => {
  ok(api.groupDefs.length === SNAP.groupDefs.length, `脚本 ${api.groupDefs.length} 个 / 快照 ${SNAP.groupDefs.length} 个`);
  for (let i = 0; i < SNAP.groupDefs.length; i++) {
    const s = SNAP.groupDefs[i];
    const d = api.groupDefs[i];
    const key = (g) => JSON.stringify({ name: g.name, tpl: g.tpl, fixed: g.fixed, prefer: g.prefer, icon: g.icon });
    ok(key(d) === key(s), `第 ${i + 1} 个：\n        ${key(d)}\n        ${key(s)}`);
  }
});
t('上游的节点/功能组都由脚本动态生成，没有漏', () => {
  // 快照里被判为「动态」的组，除地区相关的以外都应该真的出现在产物里
  const skip = new Set(SNAP.upstreamRegions.map((r) => r.name));
  for (const n of SNAP.dynamicGroups) {
    if (skip.has(n) || /自动$|均衡$/.test(n)) continue;
    ok(groupNames.indexOf(n) >= 0, `缺少动态组 ${n}`);
  }
});

console.log('\n  ▸ 分流规则与上游 configfull.yaml 对齐');
t('规则顺序与上游逐条一致', () => {
  ok(cfg.rules.length === api.ruleList.length, '条数不一致');
  for (let i = 0; i < api.ruleList.length; i++) ok(cfg.rules[i] === api.ruleList[i], `第 ${i + 1} 条不一致`);
});
t('广告拦截排在最前，国内兜底与 MATCH 收尾', () => {
  // 只校验语义顺序，不写死具体条目，免得上游微调就误报
  ok(/^RULE-SET,banAd_domain,/.test(cfg.rules[0]), `首条是 ${cfg.rules[0]}`);
  ok(/^MATCH,/.test(cfg.rules[cfg.rules.length - 1]), '末条不是 MATCH');
  const at = (re) => cfg.rules.findIndex((r) => re.test(r));
  const proxyFallback = at(/^RULE-SET,geolocation-!cn,/);
  ok(proxyFallback > 0, '缺少 geolocation-!cn 兜底');
  for (const re of [/^RULE-SET,cn_domain,全球直连/, /^RULE-SET,private_ip,全球直连/, /^RULE-SET,cn_ip,全球直连/]) {
    const i = at(re);
    ok(i > proxyFallback, `${re} 应排在代理兜底之后`);
  }
});
t('国内直连规则排在代理兜底之前', () => {
  const proxyFallback = cfg.rules.findIndex((r) => /^RULE-SET,geolocation-!cn,/.test(r));
  for (const k of ['direct_domain', 'wechat_domain', 'tencent_domain', 'alibaba_domain', 'apple_cn_domain']) {
    const at = cfg.rules.findIndex((r) => r.indexOf(`RULE-SET,${k},`) === 0);
    ok(at >= 0 && at < proxyFallback, `${k} 没有排在代理兜底之前`);
  }
});
t('抖音图集用到的直连规则集都在', () => {
  // 上游把 byteimg.com 收进了自维护的 direct_domain，配合 cn_domain 兜底
  ok(cfg.rules.indexOf('RULE-SET,direct_domain,全球直连') >= 0);
  ok(cfg.rules.indexOf('RULE-SET,cn_domain,全球直连') >= 0);
  ok(cfg['rule-providers'].direct_domain !== undefined);
});
t('TikTok 与国内字节流量分属不同组', () => {
  ok(cfg.rules.indexOf('RULE-SET,tiktok_domain,TikTok') >= 0);
  const tk = cfg.rules.indexOf('RULE-SET,tiktok_domain,TikTok');
  const cn = cfg.rules.indexOf('RULE-SET,cn_domain,全球直连');
  ok(tk < cn, 'tiktok 应排在国内兜底之前');
});

console.log('\n  ▸ 节点过滤与命名');
t('假节点被剔除', () => {
  for (const kw of ['剩余流量', '官网']) ok(!proxyNames.some((n) => n.indexOf(kw) >= 0), `${kw} 未被过滤`);
});
t('重名节点去重', () => ok(proxyNames.filter((n) => n === '🇭🇰 香港 01 IEPL').length === 1));
t('无国旗的节点被补上国旗', () => {
  ok(proxyNames.some((n) => n === '🇯🇵 JP 东京 01'), proxyNames.join(' | '));
  ok(proxyNames.some((n) => n === '🇸🇬 Singapore-01'));
});
t('订阅里的 direct 节点不会混进来', () => {
  ok(cfg.proxies.filter((p) => p.type === 'direct').length === 1, '只应保留内置的 🟢 直连');
});
t('订阅节点补上 udp: true', () => {
  const subs = cfg.proxies.filter((p) => p.type !== 'direct');
  ok(subs.length > 0 && subs.every((p) => p.udp === true));
});

console.log('\n  ▸ 地区组（动态生成）');
t('订阅里有的地区都生成了组', () => {
  for (const r of ['香港节点', '日本节点', '美国节点', '新加坡节点']) ok(groupNames.indexOf(r) >= 0, `缺 ${r}`);
});
t('没有对应节点的地区不生成组（台湾/欧洲）', () => {
  ok(groupNames.indexOf('台湾节点') < 0);
  ok(groupNames.indexOf('欧洲节点') < 0);
});
t('regions 里没定义的地区（韩国）不会单独成组', () => {
  ok(groupNames.indexOf('韩国节点') < 0);
});
t('台湾与欧洲节点能被识别，巴哈姆特随即优先台湾', () => {
  const cfg2 = api.main({
    proxies: [
      { name: '🇭🇰 香港 01', type: 'ss', server: 'a', port: 1, cipher: 'aes-128-gcm', password: 'p' },
      { name: '台湾 台北 01', type: 'ss', server: 'b', port: 1, cipher: 'aes-128-gcm', password: 'p' },
      { name: 'TW-02 HiNet', type: 'ss', server: 'c', port: 1, cipher: 'aes-128-gcm', password: 'p' },
      { name: '德国 法兰克福', type: 'ss', server: 'd', port: 1, cipher: 'aes-128-gcm', password: 'p' },
      { name: '🇬🇧 London 01', type: 'ss', server: 'e', port: 1, cipher: 'aes-128-gcm', password: 'p' },
    ],
  });
  const g2 = cfg2['proxy-groups'];
  const tw = g2.find((g) => g.name === '台湾节点');
  const eu = g2.find((g) => g.name === '欧洲节点');
  ok(!!tw && tw.proxies.length >= 3, '台湾组缺失或成员不足'); // 含自动/均衡子组
  ok(!!eu, '欧洲组缺失');
  ok(g2.find((g) => g.name === '巴哈姆特').proxies[0] === '台湾节点', '巴哈姆特首项应为台湾节点');
  ok(!g2.some((g) => g.name === '其他节点'), '这批节点应该都能归类');
});
t('流量单位 GB / 到期信息不会被当成节点', () => {
  const cfg3 = api.main({
    proxies: [
      { name: '🇭🇰 香港 01', type: 'ss', server: 'a', port: 1, cipher: 'aes-128-gcm', password: 'p' },
      { name: '剩余流量：188.88 GB', type: 'ss', server: 'x', port: 1, cipher: 'aes-128-gcm', password: 'p' },
      { name: '距离下次重置剩余：25 天', type: 'ss', server: 'y', port: 1, cipher: 'aes-128-gcm', password: 'p' },
      { name: '套餐到期：2026-12-31', type: 'ss', server: 'z', port: 1, cipher: 'aes-128-gcm', password: 'p' },
    ],
  });
  ok(cfg3.proxies.filter((p) => p.type !== 'direct').length === 1, cfg3.proxies.map((p) => p.name).join(' | '));
  ok(!cfg3['proxy-groups'].some((g) => g.name === '欧洲节点'), 'GB 被误判成英国');
});
t('未匹配地区的节点进入「其他节点」', () => {
  const g = cfg['proxy-groups'].find((x) => x.name === '其他节点');
  ok(!!g, '缺少其他节点组');
  ok(g.proxies.indexOf('🇰🇷 韩国 首尔') >= 0, g.proxies.join(','));
});
t('每个地区带自动与均衡子组', () => {
  for (const n of ['香港节点自动', '香港节点均衡', '日本节点自动', '日本节点均衡']) {
    ok(groupNames.indexOf(n) >= 0, `缺 ${n}`);
  }
});
t('自动组是 url-test、均衡组是 load-balance 且都隐藏', () => {
  const a = cfg['proxy-groups'].find((g) => g.name === '香港节点自动');
  const b = cfg['proxy-groups'].find((g) => g.name === '香港节点均衡');
  ok(a.type === 'url-test' && a.hidden === true);
  ok(b.type === 'load-balance' && b.hidden === true);
});
t('家宽节点被单独归组', () => {
  const g = cfg['proxy-groups'].find((x) => x.name === '自建/家宽节点');
  ok(!!g, '缺少自建/家宽节点组');
  ok(g.proxies.some((n) => n.indexOf('家宽') >= 0), g.proxies.join(','));
});
t('没有家宽节点时不生成该组', () => {
  const input = fixture();
  input.proxies = input.proxies.filter((p) => p.name.indexOf('家宽') < 0);
  const c = api.main(input);
  ok(!c['proxy-groups'].some((g) => g.name === '自建/家宽节点'));
  for (const g of c['proxy-groups']) ok((g.proxies || []).indexOf('自建/家宽节点') < 0, `${g.name} 仍引用该组`);
});

console.log('\n  ▸ 引用自洽');
t('每个策略组引用的成员都存在', () => {
  for (const g of cfg['proxy-groups']) {
    for (const m of g.proxies || []) ok(known.has(m) || BUILTIN.has(m), `${g.name} 引用了不存在的 ${m}`);
  }
});
t('每条规则的目标策略组都存在', () => {
  for (const r of cfg.rules) {
    const p = r.split(',');
    const target = p[p.length - 1] === 'no-resolve' ? p[p.length - 2] : p[p.length - 1];
    ok(known.has(target) || BUILTIN.has(target), `规则目标不存在：${r}`);
  }
});
t('规则里用到的 rule-set 都已定义', () => {
  const def = new Set(Object.keys(cfg['rule-providers']));
  for (const r of cfg.rules) {
    for (const one of r.match(/RULE-SET,([^,)]+)/g) || []) {
      const k = one.split(',')[1];
      ok(def.has(k), `未定义的规则集 ${k}`);
    }
  }
});
t('fake-ip-filter 引用的 rule-set 都已定义', () => {
  const def = new Set(Object.keys(cfg['rule-providers']));
  for (const item of cfg.dns['fake-ip-filter']) {
    const s = String(item);
    if (s.indexOf('rule-set:') !== 0) continue;
    for (const k of s.slice(9).split(',')) ok(def.has(k), `fake-ip 引用了未定义的 ${k}`);
  }
});
w('没有定义了却没人用的规则集', () => {
  // 上游偶尔会删了规则却留着定义，只是白下载一份，不影响分流，所以只提醒
  const used = new Set();
  for (const r of cfg.rules) for (const one of r.match(/RULE-SET,([^,)]+)/g) || []) used.add(one.split(',')[1]);
  for (const item of cfg.dns['fake-ip-filter']) {
    const s = String(item);
    if (s.indexOf('rule-set:') === 0) for (const k of s.slice(9).split(',')) used.add(k);
  }
  const unused = Object.keys(cfg['rule-providers']).filter((k) => !used.has(k));
  ok(unused.length === 0, `未使用：${unused.join(', ')}`);
});
t('策略组不重名', () => {
  const seen = new Set();
  for (const n of groupNames) {
    ok(!seen.has(n), `重复组名 ${n}`);
    seen.add(n);
  }
});
t('规则集 URL 全为 https，扩展名与 format 相符', () => {
  const ext = { mrs: /\.mrs$/, yaml: /\.(ya?ml)$/, text: /\.(txt|list|conf)$/ };
  for (const k of Object.keys(cfg['rule-providers'])) {
    const p = cfg['rule-providers'][k];
    ok(/^https:\/\//.test(p.url), `${k} 非 https`);
    ok(p.type === 'http', `${k} 不是 http 类型`);
    ok(ext[p.format] !== undefined, `${k} 的 format=${p.format} 不认识`);
    ok(ext[p.format].test(p.url), `${k} 的 URL 与 format=${p.format} 不符：${p.url}`);
  }
});
t('上游定义的分流组一个都不少', () => {
  for (const def of api.groupDefs) ok(groupNames.indexOf(def.name) >= 0, `缺组 ${def.name}`);
});
t('隐藏功能组齐全，供全球直连与隐私拦截引用', () => {
  for (const n of ['🔗 代理', '🚫 拒绝', '⚪ 丢弃']) ok(groupNames.indexOf(n) >= 0, `缺 ${n}`);
  const block = cfg['proxy-groups'].find((g) => g.name === '隐私拦截');
  ok(block.proxies[0] === '🚫 拒绝');
  const direct = cfg['proxy-groups'].find((g) => g.name === '全球直连');
  ok(direct.proxies[0] === '🟢 直连');
});
t('巴哈姆特在没有台湾节点时不留悬空引用', () => {
  const g = cfg['proxy-groups'].find((x) => x.name === '巴哈姆特');
  ok(g.proxies.indexOf('台湾节点') < 0, '台湾组不存在却被引用');
  ok(g.proxies[0] === '香港节点', `应回落到香港，实际 ${g.proxies[0]}`);
});
t('哔哩东南亚优先新加坡', () => {
  ok(cfg['proxy-groups'].find((g) => g.name === '哔哩东南亚').proxies[0] === '新加坡节点');
});
t('直连优先的组把「全球直连」放在首位', () => {
  for (const n of ['Apple', '哔哩哔哩', '国内媒体']) {
    ok(cfg['proxy-groups'].find((g) => g.name === n).proxies[0] === '全球直连', `${n} 首项不是全球直连`);
  }
});
t('代理优先的组把「节点选择」放在首位', () => {
  for (const n of ['YouTube', 'Telegram', 'NETFLIX']) {
    ok(cfg['proxy-groups'].find((g) => g.name === n).proxies[0] === '节点选择', `${n} 首项不是节点选择`);
  }
});
t('Include_all 型的组能直接点到单个节点', () => {
  for (const n of ['AI', 'Emby', 'Final', 'STEAM']) {
    const g = cfg['proxy-groups'].find((x) => x.name === n);
    ok(g.proxies.indexOf('🇭🇰 香港 01 IEPL') >= 0, `${n} 没有平铺节点`);
  }
});

console.log('\n  ▸ DNS');
t('国外域名走国外 DoH', () => {
  ok(cfg.dns.nameserver.some((n) => n.indexOf('dns.google') >= 0));
  ok(cfg.dns.nameserver.some((n) => n.indexOf('dns.cloudflare.com') >= 0));
});
t('国外 DoH 域名在 hosts 里固定成 IP', () => {
  ok(!!cfg.hosts['dns.google']);
  ok(!!cfg.hosts['dns.cloudflare.com']);
});
t('节点域名与直连域名用明文国内 DNS，并有 system 兜底', () => {
  ok(cfg.dns['proxy-server-nameserver'].indexOf('223.5.5.5') >= 0);
  ok(cfg.dns['proxy-server-nameserver'].indexOf('system') >= 0);
  ok(cfg.dns['direct-nameserver'].indexOf('system') >= 0);
});
t('测速域名固定走国内 DNS（防测速与代理互锁）', () => {
  const pol = cfg.dns['nameserver-policy'];
  ok(!!pol, '缺少 nameserver-policy');
  const key = Object.keys(pol).find((k) => k.indexOf('www.gstatic.com') >= 0);
  ok(!!key, `实际 key：${Object.keys(pol).join(' | ')}`);
  ok(pol[key].indexOf('223.5.5.5') >= 0);
});
t('所有策略组的测速地址用 http 且在 DNS 策略里', () => {
  const keys = Object.keys(cfg.dns['nameserver-policy']).join('|');
  for (const g of cfg['proxy-groups']) {
    if (!g.url) continue;
    ok(g.url.indexOf('http://') === 0, `${g.name} 测速地址是 https`);
    const host = g.url.replace(/^https?:\/\//, '').split('/')[0];
    ok(keys.indexOf(host) >= 0, `${g.name} 的测速域名 ${host} 未指定国内 DNS`);
  }
});
t('respect-rules 开启且 fake-ip 白名单覆盖国内域名', () => {
  ok(cfg.dns['respect-rules'] === true);
  const f = cfg.dns['fake-ip-filter'].join('|');
  for (const k of ['cn_domain', 'direct_domain', 'wechat_domain', 'private_domain']) ok(f.indexOf(k) >= 0, `缺 ${k}`);
});
t('机场私有 DNS 不进入全局，只作用于节点域名', () => {
  const all = JSON.stringify([cfg.dns.nameserver, cfg.dns['nameserver-policy'], cfg.dns['direct-nameserver']]);
  ok(all.indexOf('doh.airport.example') < 0, '私有 DNS 泄漏到全局');
  const pol = cfg.dns['proxy-server-nameserver-policy'];
  ok(!!pol, '未生成 proxy-server-nameserver-policy');
  for (const k of Object.keys(pol)) ok(k.indexOf('airport.example') >= 0, `作用到了无关域名 ${k}`);
});
t('机场 hosts 里的节点条目被保留', () => {
  ok(cfg.hosts['hk1.airport.example'] !== undefined);
  const hk = cfg.proxies.find((p) => p.name === '🇭🇰 香港 01 IEPL');
  ok(hk.server === 'hk1.airport.example', `server 被改写成了 ${hk.server}`);
});
t('公共 DNS 识别正确', () => {
  ok(api.isPublicDns('223.5.5.5'));
  ok(api.isPublicDns('https://dns.cloudflare.com/dns-query'));
  ok(!api.isPublicDns('https://doh.airport.example/dns-query'));
});

console.log('\n  ▸ 开关');
t('关掉 TUN 后不输出 tun 段', () => {
  const c = load((code) => code.replace('启用TUN: true', '启用TUN: false')).main(fixture());
  ok(c.tun === undefined);
});
t('关掉地区均衡组后不再生成均衡子组', () => {
  const c = load((code) => code.replace('地区负载均衡组: true', '地区负载均衡组: false')).main(fixture());
  ok(!c['proxy-groups'].some((g) => g.name.indexOf('均衡') >= 0));
  for (const g of c['proxy-groups']) for (const m of g.proxies || []) ok(m.indexOf('均衡') < 0, `${g.name} 仍引用 ${m}`);
});
t('关掉地区自动组后不再生成自动子组', () => {
  const c = load((code) => code.replace('地区自动选择组: true', '地区自动选择组: false')).main(fixture());
  ok(!c['proxy-groups'].some((g) => g.name.indexOf('节点自动') >= 0));
});
t('关掉进程匹配后 find-process-mode 为 off', () => {
  const c = load((code) => code.replace('进程匹配: true', '进程匹配: false')).main(fixture());
  ok(c['find-process-mode'] === 'off');
});
t('开启平铺后代理优先的组也能点到单个节点', () => {
  const c = load((code) => code.replace('分流组平铺节点: false', '分流组平铺节点: true')).main(fixture());
  ok(c['proxy-groups'].find((g) => g.name === 'YouTube').proxies.indexOf('🇭🇰 香港 01 IEPL') >= 0);
});
t('默认不监听 1053 端口', () => {
  ok(cfg.dns.listen === undefined);
  const c = load((code) => code.replace('DNS监听: false', 'DNS监听: true')).main(fixture());
  ok(c.dns.listen === '0.0.0.0:1053');
});
t('关掉 IPv6 后不输出 fake-ip-range6', () => {
  const c = load((code) => code.replace('启用IPv6: true', '启用IPv6: false')).main(fixture());
  ok(c.dns['fake-ip-range6'] === undefined);
  ok(c.ipv6 === false);
});

console.log('\n  ▸ 异常输入');
t('空节点列表给出明确报错', () => {
  let msg = '';
  try {
    api.main({ proxies: [] });
  } catch (e) {
    msg = e.message;
  }
  ok(msg.indexOf('没有可用节点') >= 0, `实际：${msg}`);
});
t('缺少 dns / hosts 字段也能正常生成', () => {
  const c = api.main({
    proxies: [{ name: 'HK-01', type: 'ss', server: '1.1.1.2', port: 1, cipher: 'aes-128-gcm', password: 'p' }],
  });
  ok(c['proxy-groups'].length > 30);
});
t('只有一个地区时其余地区组不出现且无悬空引用', () => {
  const c = api.main({
    proxies: [{ name: '🇭🇰 香港 01', type: 'ss', server: '1.1.1.2', port: 1, cipher: 'aes-128-gcm', password: 'p' }],
  });
  const names = new Set(c['proxy-groups'].map((g) => g.name).concat(c.proxies.map((p) => p.name)));
  ok(!names.has('日本节点'));
  for (const g of c['proxy-groups']) {
    for (const m of g.proxies || []) ok(names.has(m) || BUILTIN.has(m), `${g.name} 引用了不存在的 ${m}`);
  }
});

console.log('\n  ▸ 运行时兼容（mihomo 用 QuickJS，需 ES2020 以内）');
t('不含 ES2021+ 语法', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  const banned = [
    [/\?\?=/, '??='],
    [/\|\|=/, '||='],
    [/&&=/, '&&='],
    [/\.replaceAll\(/, 'String.replaceAll'],
    [/Object\.hasOwn\(/, 'Object.hasOwn'],
    [/structuredClone\(/, 'structuredClone'],
    [/\bawait\b/, 'await'],
  ];
  for (const p of banned) ok(!p[0].test(src), `用到了 ${p[1]}`);
});
t('没有 require / import / 浏览器 API', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  for (const bad of ['require(', 'import ', 'fetch(', 'document.', 'window.', 'process.']) {
    ok(src.indexOf(bad) < 0, `用到了 ${bad}`);
  }
});
t('main 是唯一入口且接收 config', () => {
  ok(/function main\(config\)/.test(fs.readFileSync(SCRIPT, 'utf8')));
});

console.log(`\n结果：${pass} 通过，${fail} 失败${warns ? `，${warns} 提醒` : ''}\n`);
process.exit(fail ? 1 : 0);
