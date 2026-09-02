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

/** 载入脚本并暴露内部符号，可选地在执行前改写源码（用于翻转开关） */
function load(transform) {
  let code = fs.readFileSync(SCRIPT, 'utf8');
  if (transform) code = transform(code);
  code += `
;module.exports = { main, options, enableGroups, prepareProxies, applyHosts, isPublicDns, dnsHost, hostMatch, services, regions };`;
  const sandbox = { module: { exports: {} }, console, require };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'override.js' });
  return sandbox.module.exports;
}

/** 一份贴近真实机场订阅的输入：含假节点、私有 DNS、hosts 映射 */
function fixture() {
  return {
    proxies: [
      { name: '🇭🇰 香港 01', type: 'vmess', server: 'hk1.airport.example', port: 443, uuid: 'u1' },
      { name: '香港 02 x2', type: 'trojan', server: 'hk2.airport.example', port: 443, password: 'p' },
      { name: 'JP 东京 IEPL', type: 'vmess', server: 'jp1.airport.example', port: 443, uuid: 'u2' },
      { name: '🇺🇸 US 洛杉矶 0.5x', type: 'ss', server: '1.2.3.4', port: 8388, cipher: 'aes-128-gcm', password: 'p' },
      { name: 'Singapore-01', type: 'vless', server: 'sg1.airport.example', port: 443, uuid: 'u3', tls: true },
      { name: '🇰🇷 韩国 首尔', type: 'vmess', server: 'kr1.airport.example', port: 443, uuid: 'u4' },
      { name: '剩余流量：188.88 GB', type: 'ss', server: 'sub.airport.example', port: 1, cipher: 'aes-128-gcm', password: 'x' },
      { name: '距离下次重置剩余：15 天', type: 'ss', server: 'sub.airport.example', port: 2, cipher: 'aes-128-gcm', password: 'x' },
      { name: '官网 https://airport.example', type: 'ss', server: 'sub.airport.example', port: 3, cipher: 'aes-128-gcm', password: 'x' },
      { name: '🇭🇰 香港 01', type: 'vmess', server: 'hk1.airport.example', port: 443, uuid: 'dup' },
      { name: '直连', type: 'direct' },
    ],
    dns: {
      enable: true,
      listen: '0.0.0.0:1053',
      nameserver: ['https://doh.airport.example/dns-query', '223.5.5.5'],
      'proxy-server-nameserver': ['https://doh.airport.example/dns-query'],
    },
    hosts: {
      'hk1.airport.example': '5.5.5.5',
      '+.airport.example': ['6.6.6.6'],
    },
    'proxy-groups': [{ name: '机场自带组', type: 'select', proxies: ['🇭🇰 香港 01'] }],
    rules: ['MATCH,机场自带组'],
  };
}

const BUILTIN = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE', 'GLOBAL']);

console.log('\n覆写脚本自检\n');

// ---------------------------------------------------------------- 基础产出
const api = load();
const cfg = api.main(fixture());

console.log('  ▸ 结构完整性');
t('返回对象包含核心字段', () => {
  for (const k of ['dns', 'hosts', 'proxies', 'proxy-groups', 'rule-providers', 'rules', 'tun', 'sniffer']) {
    ok(cfg[k] !== undefined, `缺少 ${k}`);
  }
});
t('规则数量合理（>40 条）', () => ok(cfg.rules.length > 40, `实际 ${cfg.rules.length} 条`));
t('策略组数量 >= 20', () => ok(cfg['proxy-groups'].length >= 20, `实际 ${cfg['proxy-groups'].length} 组`));
t('最后一条是 MATCH 兜底', () => ok(/^MATCH,/.test(cfg.rules[cfg.rules.length - 1])));
t('机场自带的组和规则已被丢弃', () => {
  ok(!cfg['proxy-groups'].some((g) => g.name === '机场自带组'), '机场组仍在');
  ok(!cfg.rules.some((r) => r.indexOf('机场自带组') >= 0), '机场规则仍在');
});

console.log('\n  ▸ 节点过滤与命名');
const proxyNames = cfg.proxies.map((p) => p.name);
t('假节点（流量/重置/官网）被剔除', () => {
  for (const kw of ['剩余流量', '下次重置', '官网']) {
    ok(!proxyNames.some((n) => n.indexOf(kw) >= 0), `${kw} 未被过滤`);
  }
});
t('重名节点去重', () => {
  const dup = proxyNames.filter((n) => n === '🇭🇰 香港 01');
  ok(dup.length === 1, `出现 ${dup.length} 次`);
});
t('无国旗的节点被补上国旗', () => {
  ok(proxyNames.some((n) => n === '🇯🇵 JP 东京 IEPL'), `实际节点：${proxyNames.join(' | ')}`);
  ok(proxyNames.some((n) => n === '🇸🇬 Singapore-01'));
});
t('订阅里的 direct 类型节点不会混进来', () => {
  const fromSub = cfg.proxies.filter((p) => p.type === 'direct' && p.name.indexOf('直连 · ') !== 0);
  ok(fromSub.length === 0, `残留 ${fromSub.map((p) => p.name).join(',')}`);
});
t('内置直连节点已附加', () => ok(proxyNames.some((n) => n === '直连 · 双栈')));

console.log('\n  ▸ 地区组');
const groupNames = cfg['proxy-groups'].map((g) => g.name);
t('香港/日本/美国/新加坡 四个地区组都在', () => {
  for (const r of ['香港', '日本', '美国', '新加坡']) ok(groupNames.indexOf(r) >= 0, `缺 ${r}`);
});
t('未定义的地区（韩国）不会生成组', () => ok(groupNames.indexOf('韩国') < 0));
t('未匹配地区的节点进入「其他节点」', () => {
  const other = cfg['proxy-groups'].find((g) => g.name === '其他节点');
  ok(!!other, '缺少其他节点组');
  ok(other.proxies.indexOf('🇰🇷 韩国 首尔') >= 0, `韩国节点未归入：${other.proxies.join(',')}`);
});
t('地区组带自动选择子组', () => ok(groupNames.indexOf('香港 · 自动') >= 0));
t('香港组包含两个香港节点', () => {
  const hk = cfg['proxy-groups'].find((g) => g.name === '香港');
  const nodes = hk.proxies.filter((n) => n.indexOf(' · 自动') < 0);
  ok(nodes.length === 2, hk.proxies.join(','));
  ok(nodes.every((n) => n.indexOf('香港') >= 0), hk.proxies.join(','));
});

console.log('\n  ▸ 引用自洽（最容易出错的地方）');
const known = new Set(groupNames.concat(proxyNames));
t('每个策略组引用的成员都存在', () => {
  for (const g of cfg['proxy-groups']) {
    for (const m of g.proxies || []) {
      ok(known.has(m) || BUILTIN.has(m), `${g.name} 引用了不存在的 ${m}`);
    }
  }
});
t('每条规则的目标策略组都存在', () => {
  for (const r of cfg.rules) {
    const parts = r.split(',');
    const target = parts[parts.length - 1] === 'no-resolve' ? parts[parts.length - 2] : parts[parts.length - 1];
    ok(known.has(target) || BUILTIN.has(target), `规则目标不存在：${r}`);
  }
});
t('规则里用到的 rule-set 都已定义', () => {
  const defined = new Set(Object.keys(cfg['rule-providers']));
  for (const r of cfg.rules) {
    const m = r.match(/RULE-SET,([^,)]+)/g) || [];
    for (const one of m) {
      const key = one.split(',')[1];
      ok(defined.has(key), `规则引用了未定义的规则集 ${key}（来自 ${r}）`);
    }
  }
});
t('dns 里引用的 rule-set 都已定义', () => {
  const defined = new Set(Object.keys(cfg['rule-providers']));
  const refs = [].concat(cfg.dns['fake-ip-filter'], Object.keys(cfg.dns['nameserver-policy']));
  for (const item of refs) {
    const str = String(item);
    if (str.indexOf('rule-set:') !== 0) continue;
    for (const key of str.slice(9).split(',')) ok(defined.has(key), `dns 引用了未定义的规则集 ${key}`);
  }
});
t('没有定义了却没人用的规则集', () => {
  const used = new Set();
  for (const r of cfg.rules) for (const one of r.match(/RULE-SET,([^,)]+)/g) || []) used.add(one.split(',')[1]);
  const dnsRefs = [].concat(cfg.dns['fake-ip-filter'], Object.keys(cfg.dns['nameserver-policy']));
  for (const item of dnsRefs) {
    const str = String(item);
    if (str.indexOf('rule-set:') !== 0) continue;
    for (const key of str.slice(9).split(',')) used.add(key);
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
    ok(/^https:\/\//.test(p.url), `${k} URL 非 https`);
    ok(/\.mrs$/.test(p.url), `${k} 不是 mrs`);
    ok(p.format === 'mrs', `${k} format 错误`);
  }
});

console.log('\n  ▸ DNS 防泄露');
t('国外 DNS 全部走代理', () => {
  for (const n of cfg.dns.nameserver) ok(n.indexOf('#默认代理') > 0, `${n} 没有绑定策略组`);
});
t('国外 DoH 域名在 hosts 里被固定，避免解析死循环', () => {
  ok(!!cfg.hosts['cloudflare-dns.com'], '缺 cloudflare-dns.com');
  ok(!!cfg.hosts['dns.google'], '缺 dns.google');
});
t('节点域名默认用明文国内 DNS 解析（DoH 容易让节点全部超时）', () => {
  const ns = cfg.dns['proxy-server-nameserver'];
  ok(ns.indexOf('223.5.5.5') >= 0, `实际 ${ns.join(',')}`);
  ok(!ns.some((n) => n.indexOf('https://') === 0), '默认不该用 DoH');
});
t('打开加密开关后节点域名走 DoH 且强制直连', () => {
  const c = load((code) => code.replace('节点域名用加密DNS: false', '节点域名用加密DNS: true')).main(fixture());
  for (const n of c.dns['proxy-server-nameserver']) ok(n.indexOf('#DIRECT') > 0, `${n} 未强制直连`);
});
t('国内域名走国内 DNS', () => {
  const pol = cfg.dns['nameserver-policy'];
  const key = Object.keys(pol).find((k) => k.indexOf('cn_site') >= 0);
  ok(!!key, '缺少国内域名策略');
  ok(pol[key].indexOf('223.5.5.5') >= 0);
});
t('fake-ip-filter 覆盖内网、国内域名与国内 App', () => {
  const f = cfg.dns['fake-ip-filter'].join('|');
  for (const k of ['geolocation-cn', 'private', 'douyin', 'bytedance', 'cdn_cn', 'bilibili']) {
    ok(f.indexOf(k) >= 0, `缺 ${k}`);
  }
  ok(f.indexOf('+.lan') >= 0);
});

console.log('\n  ▸ 机场私有 DNS / hosts 兼容');
t('默认不改写节点 server，改把机场 hosts 条目保留下来解析', () => {
  const hk = cfg.proxies.find((p) => p.name === '🇭🇰 香港 01');
  ok(hk.server === 'hk1.airport.example', `server 被改成了 ${hk.server}`);
  ok(cfg.hosts['hk1.airport.example'] !== undefined, '机场 hosts 条目没有保留');
  ok(cfg.hosts['+.airport.example'] !== undefined, '通配 hosts 条目没有保留');
});
t('打开写死IP 后节点 server 变成 IP，且原域名留给 SNI', () => {
  const c = load((code) => code.replace('写死节点IP: false', '写死节点IP: true')).main(fixture());
  const hk = c.proxies.find((p) => p.name === '🇭🇰 香港 01');
  ok(hk.server === '5.5.5.5', `实际 ${hk.server}`);
  const jp = c.proxies.find((p) => p.name === '🇯🇵 JP 东京 IEPL');
  ok(jp.server === '6.6.6.6', `通配 hosts 未生效，实际 ${jp.server}`);
  const sg = c.proxies.find((p) => p.name === '🇸🇬 Singapore-01');
  ok(sg.servername === 'sg1.airport.example', `vless 的 SNI 丢了：${sg.servername}`);
  const tj = c.proxies.find((p) => p.name === '🇭🇰 香港 02 x2');
  ok(tj.server === '6.6.6.6', `实际 ${tj.server}`);
  ok(tj.sni === 'hk2.airport.example', `trojan 该用 sni 字段留域名，实际 ${tj.sni}`);
});
t('已经是 IP 的节点不动', () => {
  const us = cfg.proxies.find((p) => p.name.indexOf('洛杉矶') >= 0);
  ok(us.server === '1.2.3.4', `实际 ${us.server}`);
});
t('机场私有 DNS 不会进入全局 nameserver', () => {
  const all = JSON.stringify([cfg.dns.nameserver, cfg.dns['nameserver-policy'], cfg.dns['direct-nameserver']]);
  ok(all.indexOf('doh.airport.example') < 0, '私有 DNS 泄漏到全局');
});
t('公共 DNS 识别正确', () => {
  ok(api.isPublicDns('223.5.5.5'));
  ok(api.isPublicDns('https://dns.google/dns-query#代理'));
  ok(api.isPublicDns('system'));
  ok(!api.isPublicDns('https://doh.airport.example/dns-query'));
});
t('机场只给私有 DNS 时，策略只作用于节点域名', () => {
  const input = fixture();
  delete input.hosts;
  const c = api.main(input);
  const pol = c.dns['proxy-server-nameserver-policy'];
  ok(!!pol, '未生成 proxy-server-nameserver-policy');
  const keys = Object.keys(pol);
  ok(keys.indexOf('hk1.airport.example') >= 0, `实际 ${keys.join(',')}`);
  ok(pol['hk1.airport.example'][0] === 'https://doh.airport.example/dns-query');
  for (const k of keys) ok(k.indexOf('airport.example') >= 0, `策略作用到了无关域名 ${k}`);
});

console.log('\n  ▸ 回归：节点全部超时 / 国内流量误走代理');
t('测速地址不是 https、且域名交给国内 DNS（否则测速与代理互锁）', () => {
  const groups = cfg['proxy-groups'].filter((g) => g.url);
  ok(groups.length > 0);
  const keys = Object.keys(cfg.dns['nameserver-policy']).join('|');
  for (const g of groups) {
    const host = g.url.replace(/^https?:\/\//, '').split('/')[0];
    ok(keys.indexOf(host) >= 0, `${g.name} 的测速域名 ${host} 没有指定国内 DNS`);
    ok(g.url.indexOf('http://') === 0, `${g.name} 的测速地址还是 https`);
  }
});
t('测速域名的 DNS 策略指向国内明文 DNS', () => {
  const pol = cfg.dns['nameserver-policy'];
  const key = Object.keys(pol).find((k) => k.indexOf('cp.cloudflare.com') >= 0);
  ok(!!key, '缺少测速域名策略');
  ok(pol[key].indexOf('223.5.5.5') >= 0);
});
t('国外 DNS 绑定的策略组真实存在', () => {
  const names = new Set(cfg['proxy-groups'].map((g) => g.name));
  for (const n of cfg.dns.nameserver) {
    const at = n.indexOf('#');
    if (at < 0) continue;
    const target = n.slice(at + 1);
    ok(names.has(target) || target === 'DIRECT', `DNS 绑定了不存在的组 ${target}`);
  }
});
t('抖音、字节、国内 CDN、B 站都有直连规则', () => {
  for (const k of ['douyin', 'bytedance', 'cdn_cn', 'bilibili']) {
    ok(cfg.rules.indexOf(`RULE-SET,${k},直连`) >= 0, `缺 ${k} 直连规则`);
  }
});
t('字节海外域名走 TikTok，且排在 bytedance 直连之前', () => {
  const notCn = cfg.rules.indexOf('RULE-SET,bytedance_notcn,TikTok');
  const bd = cfg.rules.indexOf('RULE-SET,bytedance,直连');
  const tk = cfg.rules.indexOf('RULE-SET,tiktok,TikTok');
  ok(notCn > 0, '缺少字节海外域名规则');
  ok(tk >= 0 && tk < notCn, 'tiktok 规则应排在最前');
  ok(notCn < bd, '顺序反了：bytedance 直连会把 TikTok 一起吃掉');
});
t('国内直连规则排在兜底之前', () => {
  const last = cfg.rules.indexOf('RULE-SET,geolocation-!cn,默认代理');
  for (const k of ['douyin', 'bytedance', 'cdn_cn', 'bilibili']) {
    ok(cfg.rules.indexOf(`RULE-SET,${k},直连`) < last, `${k} 排在兜底之后了`);
  }
});
t('默认不产生 QUIC 拦截规则', () => {
  ok(!cfg.rules.some((r) => r.indexOf('NETWORK,UDP') >= 0), 'QUIC 规则默认应关闭');
});
t('打开 QUIC 屏蔽时国内 App 在放行名单里', () => {
  const c = load((code) => code.replace('屏蔽国外QUIC: false', '屏蔽国外QUIC: true')).main(fixture());
  const r = c.rules.find((x) => x.indexOf('NETWORK,UDP') >= 0);
  ok(!!r, '没生成 QUIC 规则');
  for (const k of ['cn_site', 'douyin', 'bytedance', 'cdn_cn', 'bilibili', 'cn_ip']) {
    ok(r.indexOf(`RULE-SET,${k}`) >= 0, `QUIC 放行名单缺 ${k}`);
  }
});
t('订阅节点补上 udp: true', () => {
  const subs = cfg.proxies.filter((p) => p.type !== 'direct');
  ok(subs.length > 0 && subs.every((p) => p.udp === true), '有节点没有 udp: true');
});
t('故障转移组存在且被默认代理引用', () => {
  const g = cfg['proxy-groups'].find((x) => x.name === '故障转移');
  ok(!!g, '缺少故障转移组');
  ok(g.type === 'fallback', `类型应为 fallback，实际 ${g.type}`);
  ok(cfg['proxy-groups'].find((x) => x.name === '默认代理').proxies.indexOf('故障转移') >= 0);
});
t('sniffer 跳过微信 / 腾讯图片 / 向日葵等易出问题的域名', () => {
  const sk = cfg.sniffer['skip-domain'].join('|');
  for (const d of ['+.wechat.com', '+.qq.com', '+.qpic.cn', '+.oray.com']) ok(sk.indexOf(d) >= 0, `缺 ${d}`);
});
t('TUN 用 gvisor 栈（兼容性最好）', () => ok(cfg.tun.stack === 'gvisor', `实际 ${cfg.tun.stack}`));

console.log('\n  ▸ 开关');
t('关掉某个分流组后，组和它的规则一起消失', () => {
  const c = load((code) => code.replace('  Netflix: true,', '  Netflix: false,')).main(fixture());
  ok(!c['proxy-groups'].some((g) => g.name === 'Netflix'), 'Netflix 组仍在');
  ok(!c.rules.some((r) => r.indexOf('Netflix') >= 0), 'Netflix 规则仍在');
  ok(c['rule-providers'].netflix === undefined, 'Netflix 规则集仍在');
});
t('关掉 TUN 后不输出 tun 段', () => {
  const c = load((code) => code.replace('启用TUN: true', '启用TUN: false')).main(fixture());
  ok(c.tun === undefined, 'tun 仍存在');
});
t('关掉进程匹配后不产生 PROCESS-NAME 规则', () => {
  const c = load((code) => code.replace('进程匹配: true', '进程匹配: false')).main(fixture());
  ok(!c.rules.some((r) => r.indexOf('PROCESS-NAME') === 0), '进程规则仍在');
  ok(c['find-process-mode'] === 'off');
});
t('开启平铺后分流组能直接点到单个节点', () => {
  const c = load((code) => code.replace('分流组平铺全部节点: false', '分流组平铺全部节点: true')).main(fixture());
  const g = c['proxy-groups'].find((x) => x.name === 'AI');
  ok(g.proxies.indexOf('🇭🇰 香港 01') >= 0);
});
t('IPv4/IPv6 优先同时开启时互相抵消', () => {
  const c = load((code) =>
    code.replace('代理IPv4优先: false', '代理IPv4优先: true').replace('代理IPv6优先: false', '代理IPv6优先: true'),
  ).main(fixture());
  ok(!c.proxies.some((p) => p.type !== 'direct' && p['ip-version']), '不该写入 ip-version');
});
t('仅开 IPv4 优先时所有订阅节点带 ip-version', () => {
  const c = load((code) => code.replace('代理IPv4优先: false', '代理IPv4优先: true')).main(fixture());
  const subs = c.proxies.filter((p) => p.type !== 'direct');
  ok(subs.length > 0 && subs.every((p) => p['ip-version'] === 'ipv4-prefer'));
});
t('pick 生效：AI 默认选中美国、Apple 默认直连', () => {
  ok(cfg['proxy-groups'].find((g) => g.name === 'AI').proxies[0] === '美国');
  ok(cfg['proxy-groups'].find((g) => g.name === 'Apple').proxies[0] === '直连');
});
t('地区组不存在时 pick 不会造成悬空引用', () => {
  const input = fixture();
  input.proxies = input.proxies.filter((p) => !/US|洛杉矶/.test(p.name));
  const c = api.main(input);
  const ai = c['proxy-groups'].find((g) => g.name === 'AI');
  ok(ai.proxies.indexOf('美国') < 0, '美国组已不存在却仍被引用');
  ok(ai.proxies[0] === '默认代理', `实际首项 ${ai.proxies[0]}`);
});

console.log('\n  ▸ 异常输入');
t('空节点列表给出明确报错', () => {
  let msg = '';
  try {
    api.main({ proxies: [] });
  } catch (e) {
    msg = e.message;
  }
  ok(msg.indexOf('没有可用节点') >= 0, `实际报错：${msg}`);
});
t('缺少 dns / hosts 字段也能正常生成', () => {
  const c = api.main({ proxies: [{ name: 'HK-01', type: 'ss', server: '1.1.1.2', port: 1, cipher: 'aes-128-gcm', password: 'p' }] });
  ok(c['proxy-groups'].length > 10);
});
t('全是假节点时报错而不是产出空配置', () => {
  let msg = '';
  try {
    api.main({ proxies: [{ name: '官网 https://a.com', type: 'ss', server: 'a.com', port: 1, cipher: 'aes-128-gcm', password: 'p' }] });
  } catch (e) {
    msg = e.message;
  }
  ok(msg.indexOf('没有可用节点') >= 0, `实际：${msg}`);
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
    [/\.at\(/, 'Array.at'],
    [/structuredClone\(/, 'structuredClone'],
    [/\bawait\b/, 'await'],
    [/\d_\d/, '数字分隔符'],
  ];
  for (const pair of banned) ok(!pair[0].test(src), `用到了 ${pair[1]}`);
});
t('没有 require / import / 浏览器 API', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  for (const bad of ['require(', 'import ', 'fetch(', 'document.', 'window.', 'process.']) {
    ok(src.indexOf(bad) < 0, `用到了 ${bad}`);
  }
});
t('main 是唯一入口且接收 config', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  ok(/function main\(config\)/.test(src));
});

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
process.exit(fail ? 1 : 0);
