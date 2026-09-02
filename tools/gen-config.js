'use strict';
/**
 * 从 Script/override.js 的定义生成 Config/config.yaml。
 * 两份产物共用同一套地区 / 服务 / 规则集定义，改脚本即可同步配置文件，不会跑偏。
 *
 * 与脚本版的差异（配置文件拿不到节点列表，只能交给内核做正则过滤）：
 *   - 地区组用 include-all + filter，匹配不到节点时回退 REJECT
 *   - 无法剔除机场塞的假节点名之外的东西，也无法把 hosts 里的映射写进节点 server
 *   - 机场私有 DNS 需要自己填到 proxy-server-nameserver
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
let code = fs.readFileSync(path.join(root, 'Script', 'override.js'), 'utf8');
code += `
;module.exports = { services, regions, enableGroups, options, baseProviders, cnDns, cnDoh, fgDoh,
  directProxies, junkRe, quicRule, icon, selectBase, autoBase, balanceBase, otherRegionName, customRules, RULES_BASE };`;
const sandbox = { module: { exports: {} }, console };
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'override.js' });
const S = sandbox.module.exports;

// ------------------------------------------------------------------ YAML 输出
const needQuote = (s) =>
  s === '' ||
  /^[\s]|[\s]$|[:#{}\[\],&*?|<>=!%@`'"\\]|^(true|false|null|yes|no|on|off|~|-?\d+(\.\d+)?)$/i.test(s);
const q = (s) => (needQuote(s) ? `'${String(s).replace(/'/g, "''")}'` : String(s));

function scalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  return q(String(v));
}
/** 数组/对象一行流式输出，用于节点、规则集这类短结构 */
function flow(v) {
  if (Array.isArray(v)) return `[${v.map(flow).join(', ')}]`;
  if (v && typeof v === 'object') {
    return `{ ${Object.keys(v)
      .map((k) => `${q(k)}: ${flow(v[k])}`)
      .join(', ')} }`;
  }
  return scalar(v);
}
function block(v, indent) {
  const pad = ' '.repeat(indent);
  const lines = [];
  if (Array.isArray(v)) {
    for (const item of v) {
      if (item && typeof item === 'object') {
        const inner = block(item, indent + 2).replace(/^\s+/, '');
        lines.push(`${pad}- ${inner}`);
      } else {
        lines.push(`${pad}- ${scalar(item)}`);
      }
    }
    return lines.join('\n');
  }
  for (const k of Object.keys(v)) {
    const val = v[k];
    if (Array.isArray(val)) {
      const oneLine = `${pad}${q(k)}: ${flow(val)}`;
      if (oneLine.length <= 118 || !val.length) lines.push(oneLine);
      else lines.push(`${pad}${q(k)}:`, block(val, indent + 2));
    } else if (val && typeof val === 'object') {
      const oneLine = `${pad}${q(k)}: ${flow(val)}`;
      if (oneLine.length <= 118) lines.push(oneLine);
      else lines.push(`${pad}${q(k)}:`, block(val, indent + 2));
    } else {
      lines.push(`${pad}${q(k)}: ${scalar(val)}`);
    }
  }
  return lines.join('\n');
}

// ------------------------------------------------------------------ 组装
const regionNames = S.regions.map((r) => r.name).concat([S.otherRegionName]);
const baseNames = ['手动选择', '自动选择', '负载均衡'].filter((n) => S.enableGroups[n]);
const svcList = S.services.filter((s) => S.enableGroups[s.key]);

/** 正则里的 / 与换行要还原成 yaml 单引号字符串 */
const reSrc = (re) => re.source;

const providers = Object.assign({}, S.baseProviders);
for (const s of svcList) Object.assign(providers, s.sets || {});

const rules = S.customRules
  .concat([
    'RULE-SET,private,直连',
    'RULE-SET,games_cn,直连',
    'RULE-SET,epicgames,直连',
    'RULE-SET,nvidia_cn,直连',
    'RULE-SET,apple_cn,直连',
    'RULE-SET,microsoft_cn,直连',
  ])
  .concat(S.options.屏蔽国外QUIC ? [S.quicRule] : []);
for (const s of svcList) {
  for (const r of s.rules || []) {
    if (typeof r === 'string') rules.push(r);
    else if (r && r.rule && (!r.process || S.options.进程匹配)) rules.push(r.rule);
  }
}
rules.push(
  'RULE-SET,geolocation-!cn,默认代理',
  'RULE-SET,geolocation-cn,直连',
  'RULE-SET,cn_ip,直连',
  'RULE-SET,private_ip,直连',
  'MATCH,漏网之鱼',
);

/** 去掉脚本专用字段，配置文件里用不到 */
const clean = (o) => {
  const c = Object.assign({}, o);
  delete c.hidden;
  return c;
};

const groups = [];
const emptyFallback = { 'empty-fallback': 'REJECT' };

groups.push(
  Object.assign({ name: '默认代理' }, clean(S.selectBase), {
    proxies: regionNames.concat(baseNames),
    icon: S.icon('Proxy'),
  }),
);
if (S.enableGroups.手动选择)
  groups.push(
    Object.assign({ name: '手动选择' }, clean(S.selectBase), {
      'include-all': true,
      'exclude-type': 'DIRECT',
      'exclude-filter': reSrc(S.junkRe),
      icon: S.icon('Static'),
    }),
  );
if (S.enableGroups.自动选择)
  groups.push(
    Object.assign({ name: '自动选择' }, clean(S.autoBase), {
      'include-all': true,
      'exclude-filter': reSrc(S.junkRe),
      icon: S.icon('Auto'),
    }),
  );
if (S.enableGroups.负载均衡)
  groups.push(
    Object.assign({ name: '负载均衡' }, clean(S.balanceBase), {
      'include-all': true,
      'exclude-filter': reSrc(S.junkRe),
    }),
  );

for (const s of svcList) {
  let members = ['默认代理'].concat(baseNames, regionNames);
  if (s.direct) members.push('直连');
  if (s.pick) {
    const i = members.indexOf(s.pick);
    if (i > 0) {
      members = members.slice();
      members.splice(i, 1);
      members.unshift(s.pick);
    }
  }
  groups.push(Object.assign({ name: s.name }, clean(S.selectBase), { proxies: members, icon: s.icon }));
}

groups.push(
  Object.assign({ name: '漏网之鱼' }, clean(S.selectBase), {
    proxies: ['默认代理', '直连'].concat(baseNames, regionNames),
    icon: S.icon('Final'),
  }),
);
groups.push(
  Object.assign({ name: '直连' }, clean(S.selectBase), {
    proxies: S.directProxies.map((p) => p.name),
    url: 'https://connectivitycheck.platform.hicloud.com/generate_204',
    icon: S.icon('China_Map'),
  }),
);

// 地区组：配置文件里靠 filter 让内核自己挑节点
for (const r of S.regions) {
  const autoName = `${r.name} · 自动`;
  groups.push(
    Object.assign({ name: autoName }, clean(S.autoBase), emptyFallback, {
      'include-all': true,
      filter: reSrc(r.re),
      'exclude-filter': reSrc(S.junkRe),
    }),
  );
  groups.push(
    Object.assign({ name: r.name }, clean(S.selectBase), emptyFallback, {
      'include-all': true,
      filter: reSrc(r.re),
      'exclude-filter': reSrc(S.junkRe),
      proxies: [autoName],
      icon: S.icon(r.icon),
    }),
  );
}
// 其他节点：排除掉所有已定义地区
const excludeAll = S.regions.map((r) => reSrc(r.re)).join('|');
groups.push(
  Object.assign({ name: `${S.otherRegionName} · 自动` }, clean(S.autoBase), emptyFallback, {
    'include-all': true,
    'exclude-filter': `${excludeAll}|${reSrc(S.junkRe)}`,
  }),
);
groups.push(
  Object.assign({ name: S.otherRegionName }, clean(S.selectBase), emptyFallback, {
    'include-all': true,
    'exclude-type': 'DIRECT',
    'exclude-filter': `${excludeAll}|${reSrc(S.junkRe)}`,
    proxies: [`${S.otherRegionName} · 自动`],
    icon: S.icon('World_Map'),
  }),
);

const dns = {
  enable: true,
  ipv6: S.options.启用IPv6,
  'use-hosts': true,
  'use-system-hosts': true,
  'cache-algorithm': 'arc',
  'enhanced-mode': 'fake-ip',
  'fake-ip-range': '198.18.0.1/15',
  'fake-ip-filter': ['rule-set:private', 'rule-set:fakeip_filter', 'rule-set:geolocation-cn', '+.lan', '+.local'],
  'default-nameserver': S.cnDns,
  'proxy-server-nameserver': S.cnDoh,
  nameserver: S.fgDoh,
  'nameserver-policy': { 'rule-set:cn_site,private': S.cnDns, '+.jsdelivr.net': S.cnDns },
  'direct-nameserver': ['system'].concat(S.cnDns),
};

const hosts = {
  'cloudflare-dns.com': ['1.1.1.1', '1.0.0.1'],
  'dns.google': ['8.8.8.8', '8.8.4.4'],
  'services.googleapis.cn': 'services.googleapis.com',
  '+.mcdn.bilivideo.com': ['0.0.0.0'],
  '+.mcdn.bilivideo.cn': ['0.0.0.0'],
  '+.szbdyd.com': ['0.0.0.0'],
};

const general = {
  'mixed-port': 7890,
  'allow-lan': true,
  'bind-address': '*',
  mode: 'rule',
  'log-level': 'info',
  ipv6: S.options.启用IPv6,
  'unified-delay': true,
  'tcp-concurrent': true,
  'keep-alive-interval': 30,
  'find-process-mode': S.options.进程匹配 ? 'strict' : 'off',
  'external-controller': '127.0.0.1:9090',
  'external-ui': 'ui',
  'external-ui-url': 'https://github.com/Zephyruso/zashboard/releases/latest/download/dist.zip',
};

const sniffer = {
  enable: true,
  'force-dns-mapping': true,
  'parse-pure-ip': true,
  'override-destination': false,
  sniff: {
    HTTP: { ports: [80, '8080-8880'], 'override-destination': true },
    TLS: { ports: [443, 8443] },
    QUIC: { ports: [443, 8443] },
  },
  'skip-domain': ['+.push.apple.com', '+.apple.com', 'Mijia Cloud', 'dlg.io.mi.com'],
};

const tun = {
  enable: S.options.启用TUN,
  stack: 'mixed',
  'auto-route': true,
  'strict-route': true,
  'auto-redirect': true,
  'auto-detect-interface': true,
  'dns-hijack': ['any:53', 'tcp://any:53'],
  mtu: 1500,
};

// ------------------------------------------------------------------ 拼文件
const L = [];
L.push('# ==================================================================');
L.push('#  mihomo 分流配置（配置文件版）');
L.push('#  由 tools/gen-config.js 从 Script/override.js 生成，不要直接改这里，');
L.push('#  改完脚本重新跑一次生成即可，两份产物的规则永远一致。');
L.push('#');
L.push('#  用之前只要做一件事：把机场订阅链接填进下面 proxy-providers 的 url。');
L.push('#  想改策略组 / 地区 / 开关，建议直接用覆写脚本版，功能更全。');
L.push('# ==================================================================');
L.push('');
L.push('# --- 机场订阅：url 填在单引号里，可复制整段来添加第二、第三个机场 ---');
L.push('proxy-providers:');
L.push('  机场一:');
L.push('    type: http');
L.push("    url: '' # ← 订阅链接填这里");
L.push('    interval: 86400');
L.push('    proxy: DIRECT # 更新订阅走直连，避免节点全挂时更不了');
L.push('    path: ./providers/sub1.yaml');
L.push("    exclude-type: 'direct|reject|rematch'");
L.push(`    exclude-filter: ${q(reSrc(S.junkRe))} # 过滤机场塞的广告 / 到期提示假节点`);
L.push('    health-check: { enable: true, url: https://cp.cloudflare.com/generate_204, interval: 600, lazy: true }');
L.push("    override: { additional-prefix: 'A | ' } # 多机场时防止节点重名");
L.push('');
L.push('#  机场二:');
L.push('#    type: http');
L.push("#    url: ''");
L.push('#    interval: 86400');
L.push('#    proxy: DIRECT');
L.push('#    path: ./providers/sub2.yaml');
L.push("#    exclude-type: 'direct|reject|rematch'");
L.push('#    health-check: { enable: true, url: https://cp.cloudflare.com/generate_204, interval: 600, lazy: true }');
L.push("#    override: { additional-prefix: 'B | ' }");
L.push('');
L.push('# --- 直连节点，供「直连」组切换 IP 栈 ---');
L.push('proxies:');
L.push(block(S.directProxies, 2));
L.push('');
L.push('# --- 基础设置 ---');
L.push(block(general, 0));
L.push('');
L.push('profile: { store-selected: true, store-fake-ip: true }');
L.push('');
L.push('ntp: { enable: true, write-to-system: false, server: ntp.aliyun.com, port: 123, interval: 60 }');
L.push('');
L.push('# --- 域名嗅探：修正走 IP 直连时拿不到域名的连接 ---');
L.push('sniffer:');
L.push(block(sniffer, 2));
L.push('');
L.push('# --- TUN：手机客户端与路由器透明代理场景可把 enable 改成 false ---');
L.push('tun:');
L.push(block(tun, 2));
L.push('');
L.push('# --- DNS：国外域名只经代理用 DoH 解析，国内域名交给国内 DNS，无泄露 ---');
L.push('#  机场用私有 DNS 才能解析节点域名时，把它填进 proxy-server-nameserver');
L.push('dns:');
L.push(block(dns, 2));
L.push('');
L.push('hosts:');
L.push(block(hosts, 2));
L.push('');
L.push('# --- 规则集：mrs 二进制格式，按需下载，内存占用远低于 geodata ---');
L.push('rule-providers:');
for (const k of Object.keys(providers)) {
  L.push(`  ${q(k)}:`);
  L.push(block(providers[k], 4));
}
L.push('');
L.push('# --- 策略组 ---');
L.push('proxy-groups:');
L.push(block(groups, 2));
L.push('');
L.push('# --- 规则：从上往下匹配，命中即停 ---');
L.push('rules:');
for (const r of rules) L.push(`  - ${q(r)}`);
L.push('');

const outPath = path.join(root, 'Config', 'config.yaml');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, L.join('\n'), 'utf8');
console.log(`written ${outPath}`);
console.log(`groups=${groups.length} rules=${rules.length} providers=${Object.keys(providers).length}`);
