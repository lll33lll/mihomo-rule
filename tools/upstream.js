'use strict';

/**
 * 上游解析器
 * ------------------------------------------------------------------
 * 把 Lanlan13-14/Rules 的 configfull.yaml 解析成覆写脚本要用的数据层：
 *   providerDefs  规则集定义
 *   ruleList      路由规则（顺序原样保留）
 *   fakeIpSets    fake-ip 白名单用到的规则集
 *   groupDefs     分流策略组（划分 + 成员模板 + 图标）
 *
 * 上游是 flow 风格的单行写法（`- {name: X, <<: *Proxy_first, icon: "..."}`），
 * 这里按行做针对性解析，而不是引入 YAML 依赖：
 *   1. 需要看见 `<<: *Proxy_first` 这种 alias 名字本身，通用 YAML 解析器会把它展开掉；
 *   2. 生成器与自检都要零依赖，CI 里不用装包。
 * 上游若换成块状写法，这里会解析不出东西，调用方的断言会拦住（宁可报错也不产出半残脚本）。
 */

const META_PREFIXES = [
  'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/refs/heads/meta/',
  'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/',
  'https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/',
  'https://github.com/MetaCubeX/meta-rules-dat/raw/meta/',
  'https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/',
  'https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/',
];
const LAN_PREFIXES = [
  'https://raw.githubusercontent.com/Lanlan13-14/Rules/refs/heads/main/',
  'https://raw.githubusercontent.com/Lanlan13-14/Rules/main/',
  'https://github.com/Lanlan13-14/Rules/raw/refs/heads/main/',
  'https://github.com/Lanlan13-14/Rules/raw/main/',
  'https://cdn.jsdelivr.net/gh/Lanlan13-14/Rules@main/',
  'https://fastly.jsdelivr.net/gh/Lanlan13-14/Rules@main/',
];

/** 由覆写脚本自己动态生成的组，不进 groupDefs */
const DYNAMIC_GROUPS = new Set([
  '节点选择',
  '全部节点',
  '故障转移',
  'GLOBAL',
  '自建/家宽节点',
  '🔗 代理',
  '🚫 拒绝',
  '⚪ 丢弃',
]);

/** 地区选择组：分流组引用它们时要转成 prefer，而不是写死成员 */
const REGION_GROUP_RE = /^(.+)节点$/;

// ------------------------------------------------------------------ 小工具

/** 按分隔符切分，跳过 [] {} '' "" 内部 */
function splitTop(s, sep) {
  const out = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') depth--;
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== '') out.push(cur);
  return out;
}

function unquote(v) {
  const s = String(v).trim();
  if (s.length >= 2 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0]) {
    return s.slice(1, -1);
  }
  return s;
}

/** `a: 1, <<: *X, b: [p, q]` → { a: '1', '<<': '*X', b: '[p, q]' }（重复键保留最后一个） */
function parseFlowMap(body) {
  const map = {};
  for (const part of splitTop(body, ',')) {
    const seg = part.trim();
    if (!seg) continue;
    const at = seg.indexOf(':');
    if (at < 0) continue;
    const key = seg.slice(0, at).trim();
    map[key] = seg.slice(at + 1).trim();
  }
  return map;
}

/** `[a, b, c]` → ['a','b','c'] */
function parseFlowList(v) {
  const s = String(v).trim().replace(/^\[/, '').replace(/\]$/, '');
  return splitTop(s, ',')
    .map((x) => unquote(x))
    .filter((x) => x !== '');
}

/**
 * 取顶层 key 下的缩进块（到下一个顶层键为止），返回去掉注释的行数组。
 * 注意上游在 proxy-groups 中间插了顶格注释（`# 功能型代理组默认隐藏 start`），
 * 所以必须先滤掉注释行再判断「是否到了下一个顶层键」。
 */
function blockLines(text, key) {
  const lines = text.split(/\r?\n/);
  const head = new RegExp('^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\s*$');
  let i = lines.findIndex((l) => head.test(l));
  if (i < 0) return [];
  const out = [];
  for (i += 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue; // 空行与注释（含顶格注释）
    if (/^\S/.test(line)) break; // 下一个顶层键
    out.push(line);
  }
  return out;
}

/** 顶层的策略组模板 anchor：`Urltest_Base: &Urltest_Base {type: url-test, ...}` */
function parseGroupAnchors(text) {
  const anchors = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*&([A-Za-z0-9_]+)\s*\{(.*)\}\s*$/);
    if (!m) continue;
    const kv = parseFlowMap(m[3]);
    anchors[m[2]] = {
      type: unquote(kv.type || 'select'),
      includeAll: /true/i.test(kv['include-all'] || ''),
      proxies: kv.proxies ? parseFlowList(kv.proxies) : null,
    };
  }
  return anchors;
}

/** 把 URL 归一化成 [前缀标记, 路径]；认不出的域名保留整条 URL */
function shortenUrl(url) {
  for (const p of META_PREFIXES) if (url.startsWith(p)) return ['M', url.slice(p.length)];
  for (const p of LAN_PREFIXES) if (url.startsWith(p)) return ['L', url.slice(p.length)];
  return ['U', url];
}

// ------------------------------------------------------------------ 各段解析

/** rule-anchor: `  ip: &ip {type: http, ..., behavior: ipcidr, format: mrs}` */
function parseAnchors(text) {
  const anchors = {};
  for (const line of blockLines(text, 'rule-anchor')) {
    const m = line.match(/^\s*([A-Za-z0-9_]+):\s*&([A-Za-z0-9_]+)\s*\{(.*)\}\s*$/);
    if (!m) continue;
    const kv = parseFlowMap(m[3]);
    anchors[m[2]] = {
      behavior: unquote(kv.behavior || 'domain'),
      format: unquote(kv.format || 'mrs'),
    };
  }
  return anchors;
}

/** rule-providers: `  NAME: { <<: *domain, url: "..." }` */
function parseProviders(text, anchors) {
  const defs = [];
  const seen = new Set();
  for (const line of blockLines(text, 'rule-providers')) {
    const m = line.match(/^\s*([^\s:]+):\s*\{(.*)\}\s*,?\s*$/);
    if (!m) continue;
    const name = unquote(m[1]);
    const kv = parseFlowMap(m[2]);
    const url = unquote(kv.url || '');
    if (!url) continue;

    const alias = (kv['<<'] || '').replace(/^\*/, '').trim();
    const base = anchors[alias] || {};
    const behavior = unquote(kv.behavior || base.behavior || 'domain');
    const format = unquote(kv.format || base.format || 'mrs');
    const [tag, path] = shortenUrl(url);

    if (seen.has(name)) continue; // 上游偶有重复键，YAML 取后者，这里保留首个位置
    seen.add(name);
    defs.push({ name, behavior, format, tag, path, url });
  }
  return defs;
}

/** rules: `  - RULE-SET,xxx,组名` */
function parseRules(text) {
  const out = [];
  for (const line of blockLines(text, 'rules')) {
    const m = line.match(/^\s*-\s*(.+?)\s*$/);
    if (!m) continue;
    out.push(unquote(m[1]).replace(/\s*#.*$/, '').trim());
  }
  return out;
}

/** dns.fake-ip-filter 里的 `rule-set:a,b,c` */
function parseFakeIpSets(text) {
  const sets = [];
  const lines = text.split(/\r?\n/);
  let inDns = false;
  let inFilter = false;
  for (const line of lines) {
    if (/^dns:\s*$/.test(line)) {
      inDns = true;
      continue;
    }
    if (inDns && /^\S/.test(line)) break;
    if (!inDns) continue;
    if (/^\s{2}fake-ip-filter:\s*$/.test(line)) {
      inFilter = true;
      continue;
    }
    if (inFilter && /^\s{2}\S/.test(line)) inFilter = false;
    if (!inFilter) continue;
    const m = line.match(/rule-set:\s*([^"']+)/);
    if (m) for (const n of m[1].split(',')) if (n.trim()) sets.push(n.trim());
  }
  return sets;
}

/**
 * proxy-groups: `  - {name: X, <<: *Proxy_first, icon: "..."}`
 * 分三类：
 *   dynamic  节点筛选组 / 功能组 → 交给覆写脚本按实际节点生成
 *   tpl      套用上游三个成员模板之一（Proxy_first / Direct_first / Include_all）
 *   fixed    上游写死的成员列表（如 全球直连、隐私拦截）
 */
function parseGroups(text) {
  const anchors = parseGroupAnchors(text);
  const rows = [];

  for (const line of blockLines(text, 'proxy-groups')) {
    const m = line.match(/^\s*-\s*\{(.*)\}\s*$/);
    if (!m) continue;
    const kv = parseFlowMap(m[1]);
    const name = unquote(kv.name || '');
    if (!name) continue;

    const alias = (kv['<<'] || '').replace(/^\*/, '').trim();
    const base = anchors[alias] || {};
    const type = unquote(kv.type || base.type || 'select');
    const includeAll = kv['include-all'] !== undefined ? /true/i.test(kv['include-all']) : !!base.includeAll;
    const iconUrl = unquote(kv.icon || '');
    rows.push({
      name,
      alias,
      type,
      includeAll,
      hasFilter: kv.filter !== undefined,
      filter: unquote(kv.filter || ''),
      proxies: kv.proxies ? parseFlowList(kv.proxies) : null,
      icon: iconUrl ? iconUrl.replace(/^.*\//, '').replace(/\.[a-z0-9]+$/i, '') : '',
    });
  }

  // 第一遍：判定哪些组由覆写脚本自己按节点生成
  const dynamic = [];
  const regionGroups = [];
  for (const r of rows) {
    // 带 filter 的筛选组、测速/均衡/兜底组、以及固定的功能组
    const isPicker = r.hasFilter && (r.includeAll || r.type !== 'select');
    const isAuto = r.type === 'url-test' || r.type === 'load-balance' || r.type === 'fallback';
    r.dynamic = isPicker || isAuto || DYNAMIC_GROUPS.has(r.name);
    if (!r.dynamic) continue;
    dynamic.push(r.name);
    if (r.type === 'select' && r.hasFilter && REGION_GROUP_RE.test(r.name) && r.name !== '自建/家宽节点') {
      regionGroups.push({ name: r.name, icon: r.icon, filter: r.filter });
    }
  }
  const dynamicSet = new Set(dynamic);

  // 第二遍：分流组的成员模板
  const defs = [];
  for (const r of rows) {
    if (r.dynamic) continue;
    const def = { name: r.name, icon: r.icon };
    if (r.alias === 'Proxy_first') def.tpl = 'proxy';
    else if (r.alias === 'Direct_first') def.tpl = 'direct';
    else if (r.alias === 'Include_all') def.tpl = 'all';
    else if (r.proxies) {
      // 上游把地区组写进了成员：转成「模板 + 优先地区」，
      // 这样订阅里没有该地区时不会留下悬空引用。
      const picks = r.proxies.filter((x) => dynamicSet.has(x) && REGION_GROUP_RE.test(x) && x !== '全部节点' && x !== '自建/家宽节点');
      if (picks.length) {
        def.tpl = r.proxies[0] === '全球直连' ? 'direct' : 'proxy';
        def.prefer = picks;
      } else {
        def.fixed = r.proxies.slice();
      }
      if (r.includeAll) def.tpl = 'all';
    } else if (r.includeAll) {
      def.tpl = 'all';
    } else {
      def.tpl = 'proxy';
    }
    defs.push(def);
  }

  return { defs, dynamic, regionGroups };
}

// ------------------------------------------------------------------ 出口

function parse(text) {
  const anchors = parseAnchors(text);
  const providerDefs = parseProviders(text, anchors);
  const ruleList = parseRules(text);
  const fakeIpSets = parseFakeIpSets(text);
  const groups = parseGroups(text);
  return {
    anchors,
    providerDefs,
    ruleList,
    fakeIpSets,
    groupDefs: groups.defs,
    dynamicGroups: groups.dynamic,
    upstreamRegions: groups.regionGroups,
  };
}

/**
 * 完整性校验：宁可让同步失败，也不要把半残的数据写进客户端天天拉取的脚本。
 * 返回错误数组，空数组表示通过。
 */
function validate(data, opts) {
  const o = opts || {};
  const errs = [];
  const minProviders = o.minProviders || 60;
  const minRules = o.minRules || 60;
  const minGroups = o.minGroups || 20;

  if (data.providerDefs.length < minProviders) {
    errs.push(`规则集只解析出 ${data.providerDefs.length} 个（期望 ≥ ${minProviders}），上游格式可能变了`);
  }
  if (data.ruleList.length < minRules) {
    errs.push(`路由规则只解析出 ${data.ruleList.length} 条（期望 ≥ ${minRules}）`);
  }
  if (data.groupDefs.length < minGroups) {
    errs.push(`分流组只解析出 ${data.groupDefs.length} 个（期望 ≥ ${minGroups}）`);
  }
  if (data.fakeIpSets.length < 5) {
    errs.push(`fake-ip 白名单只解析出 ${data.fakeIpSets.length} 个规则集`);
  }
  if (data.ruleList.length && !/^MATCH,/.test(data.ruleList[data.ruleList.length - 1])) {
    errs.push('最后一条规则不是 MATCH，规则顺序可能截断');
  }

  const providerNames = new Set(data.providerDefs.map((p) => p.name));
  for (const p of data.providerDefs) {
    if (p.tag === 'U') errs.push(`规则集 ${p.name} 的 URL 前缀无法归一化：${p.path}`);
    if (!/^https:\/\//.test(p.tag === 'U' ? p.path : 'https://x/')) errs.push(`规则集 ${p.name} 不是 https`);
  }

  // 规则引用的规则集必须存在
  for (const r of data.ruleList) {
    const seg = r.split(',');
    if (seg[0] === 'RULE-SET' && !providerNames.has(seg[1])) {
      errs.push(`规则引用了未定义的规则集：${r}`);
    }
  }
  for (const n of data.fakeIpSets) {
    if (!providerNames.has(n)) errs.push(`fake-ip 白名单引用了未定义的规则集：${n}`);
  }

  // 规则的目标策略组必须是分流组、动态组或内置动作
  const builtin = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE']);
  const known = new Set(
    data.groupDefs
      .map((g) => g.name)
      .concat(data.dynamicGroups)
      .concat(Array.from(builtin)),
  );
  for (const r of data.ruleList) {
    const seg = r.split(',');
    const target = seg[0] === 'MATCH' ? seg[1] : seg[seg.length - 1] === 'no-resolve' ? seg[seg.length - 2] : seg[seg.length - 1];
    if (target && !known.has(target)) errs.push(`规则指向了不存在的策略组：${r}`);
  }

  // 写死成员的组，其成员也必须存在
  for (const g of data.groupDefs) {
    for (const m of g.fixed || []) {
      if (!known.has(m) && m !== '🟢 直连') errs.push(`组 ${g.name} 引用了不存在的成员：${m}`);
    }
  }
  return errs;
}

/**
 * 本地差异：明确记录「我们和上游不一样的地方」。
 * 上游改动不会覆盖这些决定，同步后依然生效。
 */
const LOCAL_PATCH = {
  // 上游把巴哈姆特写死成台湾节点；订阅里没台湾节点时回落香港，避免悬空引用
  巴哈姆特: { prefer: ['台湾节点', '香港节点'] },
};

/** 就地把本地差异合并进解析结果 */
function applyLocalPatch(data) {
  for (const g of data.groupDefs) {
    const patch = LOCAL_PATCH[g.name];
    if (patch) Object.assign(g, patch);
  }
  return data;
}

module.exports = {
  parse,
  validate,
  applyLocalPatch,
  LOCAL_PATCH,
  shortenUrl,
  blockLines,
  parseFlowMap,
  parseFlowList,
  splitTop,
  DYNAMIC_GROUPS,
};
