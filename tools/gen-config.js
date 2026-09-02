'use strict';
/**
 * 生成 Config/config.yaml。
 *
 * 做法是直接调用覆写脚本的 main()，喂给它一组「探针节点」（每个地区一个），
 * 拿到完整配置后只替换与节点有关的部分：
 *   - proxies        -> proxy-providers（填订阅链接）+ 内置直连节点
 *   - 地区/基础组    -> include-all + filter，由内核按正则自己挑节点
 * 这样 dns、hosts、规则、规则集、sniffer、tun 全部与脚本一致，改脚本即同步。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
let code = fs.readFileSync(path.join(root, 'Script', 'override.js'), 'utf8');
code += `
;module.exports = { main, regions, junkRe, directProxies, otherRegionName, healthCheckUrl, icon };`;
const sandbox = { module: { exports: {} }, console };
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'override.js' });
const S = sandbox.module.exports;

// ------------------------------------------------------------------ YAML 输出
const needQuote = (s) =>
  s === '' || /^[\s]|[\s]$|[:#{}\[\],&*?|<>=!%@`'"\\]|^(true|false|null|yes|no|on|off|~|-?\d+(\.\d+)?)$/i.test(s);
const q = (s) => (needQuote(s) ? `'${String(s).replace(/'/g, "''")}'` : String(s));
const scalar = (v) =>
  v === null || v === undefined ? 'null' : typeof v === 'boolean' || typeof v === 'number' ? String(v) : q(String(v));

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
      if (item && typeof item === 'object') lines.push(`${pad}- ${block(item, indent + 2).replace(/^\s+/, '')}`);
      else lines.push(`${pad}- ${scalar(item)}`);
    }
    return lines.join('\n');
  }
  for (const k of Object.keys(v)) {
    const val = v[k];
    if (val && typeof val === 'object') {
      const oneLine = `${pad}${q(k)}: ${flow(val)}`;
      if (oneLine.length <= 118 || (Array.isArray(val) && !val.length)) lines.push(oneLine);
      else lines.push(`${pad}${q(k)}:`, block(val, indent + 2));
    } else {
      lines.push(`${pad}${q(k)}: ${scalar(val)}`);
    }
  }
  return lines.join('\n');
}

// ------------------------------------------------------------------ 跑一遍脚本
/** 每个地区一个探针节点，外加一个不属于任何地区的，逼出全部策略组 */
const probes = S.regions
  .map((r, i) => ({
    name: `${r.flag} probe-${i}`,
    type: 'ss',
    server: `10.0.0.${i + 1}`,
    port: 8388,
    cipher: 'aes-128-gcm',
    password: 'probe',
  }))
  .concat([{ name: 'probe-other', type: 'ss', server: '10.0.1.1', port: 8388, cipher: 'aes-128-gcm', password: 'p' }]);

const probeNames = new Set(probes.map((p) => p.name));
const cfg = S.main({ proxies: probes });

const reSrc = (re) => re.source;
const junk = reSrc(S.junkRe);
const regionByName = {};
for (const r of S.regions) regionByName[r.name] = r;
const excludeAllRegions = S.regions.map((r) => reSrc(r.re)).join('|');

/** 把策略组里的探针节点换成 include-all + 正则过滤 */
const groups = cfg['proxy-groups'].map((g) => {
  const out = Object.assign({}, g);
  const members = (g.proxies || []).filter((n) => !probeNames.has(n));
  const hadProbe = (g.proxies || []).length !== members.length;
  out.proxies = members;

  if (!hadProbe) {
    if (!members.length) delete out.proxies;
    return out;
  }

  out['include-all'] = true;
  // include-all 会把上面 proxies 里的直连节点也拉进来，必须排掉
  out['exclude-type'] = 'DIRECT';
  const bare = g.name.replace(' · 自动', '');
  if (regionByName[bare]) {
    out.filter = reSrc(regionByName[bare].re);
    out['exclude-filter'] = junk;
    out['empty-fallback'] = 'REJECT';
  } else if (bare === S.otherRegionName) {
    out['exclude-filter'] = `${excludeAllRegions}|${junk}`;
    out['empty-fallback'] = 'REJECT';
  } else {
    // 手动选择 / 自动选择 / 负载均衡 / 故障转移：全部节点
    out['exclude-filter'] = junk;
  }
  if (!out.proxies.length) delete out.proxies;
  return out;
});

// ------------------------------------------------------------------ 拼文件
const L = [];
L.push('# ==================================================================');
L.push('#  mihomo 分流配置（配置文件版）');
L.push('#  由 tools/gen-config.js 从 Script/override.js 生成，别直接改这里；');
L.push('#  改完脚本重跑一次生成即可，两份产物的规则永远一致。');
L.push('#');
L.push('#  用之前只要做一件事：把机场订阅链接填进下面 proxy-providers 的 url。');
L.push('#  想改策略组 / 地区 / 开关，用覆写脚本版，功能更全。');
L.push('# ==================================================================');
L.push('');
L.push('# --- 机场订阅：url 填在单引号里，可整段复制来添加第二、第三个机场 ---');
L.push('proxy-providers:');
L.push('  机场一:');
L.push('    type: http');
L.push("    url: '' # ← 订阅链接填这里");
L.push('    interval: 86400');
L.push('    proxy: DIRECT # 更新订阅走直连，避免节点全挂时更不了');
L.push('    path: ./providers/sub1.yaml');
L.push("    exclude-type: 'direct|reject|rematch'");
L.push(`    exclude-filter: ${q(junk)} # 过滤机场塞的广告 / 到期提示假节点`);
L.push(`    health-check: { enable: true, url: ${S.healthCheckUrl}, interval: 600, lazy: true }`);
L.push("    override: { udp: true, additional-prefix: 'A | ' } # udp 补上，多机场时防重名");
L.push('');
L.push('#  机场二:');
L.push('#    type: http');
L.push("#    url: ''");
L.push('#    interval: 86400');
L.push('#    proxy: DIRECT');
L.push('#    path: ./providers/sub2.yaml');
L.push("#    exclude-type: 'direct|reject|rematch'");
L.push(`#    health-check: { enable: true, url: ${S.healthCheckUrl}, interval: 600, lazy: true }`);
L.push("#    override: { udp: true, additional-prefix: 'B | ' }");
L.push('');
L.push('# --- 直连节点，供「直连」组切换 IP 栈 ---');
L.push('proxies:');
L.push(block(S.directProxies, 2));
L.push('');

const skip = new Set([
  'proxies',
  'proxy-groups',
  'rule-providers',
  'rules',
  'dns',
  'hosts',
  'sniffer',
  'tun',
  'ntp',
  'profile',
]);
const general = {};
for (const k of Object.keys(cfg)) if (!skip.has(k)) general[k] = cfg[k];

L.push('# --- 基础设置 ---');
L.push(block(general, 0));
L.push('');
L.push(`profile: ${flow(cfg.profile)}`);
L.push('');
L.push(`ntp: ${flow(cfg.ntp)}`);
L.push('');
L.push('# --- 域名嗅探：修正走 IP 直连时拿不到域名的连接 ---');
L.push('sniffer:');
L.push(block(cfg.sniffer, 2));
L.push('');
if (cfg.tun) {
  L.push('# --- TUN：路由器 / OpenWrt 透明代理场景把 enable 改成 false ---');
  L.push('tun:');
  L.push(block(cfg.tun, 2));
  L.push('');
}
L.push('# --- DNS：国外域名只经代理用 DoH 解析，国内域名交给国内 DNS ---');
L.push('#  机场必须用私有 DNS 才能解析节点域名时，把它填进 proxy-server-nameserver');
L.push('dns:');
L.push(block(cfg.dns, 2));
L.push('');
L.push('hosts:');
L.push(block(cfg.hosts, 2));
L.push('');
L.push('# --- 规则集：mrs 二进制格式，按需下载，内存占用远低于 geodata ---');
L.push('rule-providers:');
for (const k of Object.keys(cfg['rule-providers'])) {
  L.push(`  ${q(k)}:`);
  L.push(block(cfg['rule-providers'][k], 4));
}
L.push('');
L.push('# --- 策略组：地区组用正则过滤，匹配不到节点时回退 REJECT ---');
L.push('proxy-groups:');
L.push(block(groups, 2));
L.push('');
L.push('# --- 规则：从上往下匹配，命中即停 ---');
L.push('rules:');
for (const r of cfg.rules) L.push(`  - ${q(r)}`);
L.push('');

const outPath = path.join(root, 'Config', 'config.yaml');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, L.join('\n'), 'utf8');
console.log(`written ${outPath}`);
console.log(`groups=${groups.length} rules=${cfg.rules.length} providers=${Object.keys(cfg['rule-providers']).length}`);
