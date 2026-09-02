'use strict';
/**
 * 覆写脚本自检：在沙箱里跑 main()，校验产出的配置自身是否自洽。
 * 用法：node test/run.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SCRIPT = path.resolve(__dirname, '..', 'Script', 'override.js');

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
t('规则条数与上游一致（96 条）', () => ok(cfg.rules.length === 96, `实际 ${cfg.rules.length} 条`));
t('规则集数量 >= 90', () => ok(Object.keys(cfg['rule-providers']).length >= 90));
t('最后一条是 MATCH,Final', () => ok(cfg.rules[cfg.rules.length - 1] === 'MATCH,Final'));
t('机场自带的组和规则已被丢弃', () => {
  ok(!groupNames.some((n) => n === '机场自带组'));
  ok(!cfg.rules.some((r) => r.indexOf('机场自带组') >= 0));
});

console.log('\n  ▸ 分流规则与上游 configfull.yaml 对齐');
t('规则顺序与上游逐条一致', () => {
  ok(cfg.rules.length === api.ruleList.length, '条数不一致');
  for (let i = 0; i < api.ruleList.length; i++) ok(cfg.rules[i] === api.ruleList[i], `第 ${i + 1} 条不一致`);
});
t('广告拦截排在最前，兜底排在最后', () => {
  ok(cfg.rules[0] === 'RULE-SET,banAd_domain,隐私拦截');
  const tail = cfg.rules.slice(-5);
  ok(tail[0] === 'RULE-SET,geolocation-!cn,节点选择');
  ok(tail[1] === 'RULE-SET,cn_domain,全球直连');
  ok(tail[2] === 'RULE-SET,private_ip,全球直连,no-resolve');
  ok(tail[3] === 'RULE-SET,cn_ip,全球直连,no-resolve');
});
t('国内直连规则排在代理兜底之前', () => {
  const proxyFallback = cfg.rules.indexOf('RULE-SET,geolocation-!cn,节点选择');
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
t('四个地区组都在', () => {
  for (const r of ['香港节点', '日本节点', '美国节点', '新加坡节点']) ok(groupNames.indexOf(r) >= 0, `缺 ${r}`);
});
t('未定义的地区（韩国/台湾）不会生成组', () => {
  ok(groupNames.indexOf('韩国节点') < 0);
  ok(groupNames.indexOf('台湾节点') < 0);
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
t('没有定义了却没人用的规则集', () => {
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
t('规则集 URL 全为 https 且指向 .mrs', () => {
  for (const k of Object.keys(cfg['rule-providers'])) {
    const p = cfg['rule-providers'][k];
    ok(/^https:\/\//.test(p.url), `${k} 非 https`);
    ok(/\.mrs$/.test(p.url), `${k} 不是 mrs`);
    ok(p.format === 'mrs' && p.type === 'http');
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

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
process.exit(fail ? 1 : 0);
