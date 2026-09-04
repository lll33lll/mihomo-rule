#!/usr/bin/env node
'use strict';

/**
 * 同步上游规则
 * ------------------------------------------------------------------
 * 从 Lanlan13-14/Rules 抓最新的 configfull.yaml，把里面的
 * 规则集 / 规则顺序 / fake-ip 白名单 / 分流组划分 翻译进
 * Script/override.js 的 AUTO-GENERATED 区，并留一份快照供自检和下次比对。
 *
 * 节点相关的部分（地区组、自动/均衡子组、家宽组、DNS 本地化）不受影响，
 * 那些由覆写脚本按订阅里实际有的节点动态生成。
 *
 * 用法：
 *   node tools/sync-upstream.js                # 抓上游并写入
 *   node tools/sync-upstream.js --check        # 只报告差异，不改文件（有更新时退出码 3）
 *   node tools/sync-upstream.js --file a.yaml  # 用本地文件当上游（离线调试）
 *   node tools/sync-upstream.js --offline      # 用仓库里的快照当上游（验证解析器）
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const up = require('./upstream.js');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'Script', 'override.js');
const SNAPSHOT = path.join(ROOT, 'test', 'upstream-snapshot.yaml');

const BEGIN = '// >>> AUTO-GENERATED BEGIN';
const END = '// <<< AUTO-GENERATED END';

const SOURCES = [
  'https://raw.githubusercontent.com/Lanlan13-14/Rules/main/configfull.yaml',
  'https://testingcf.jsdelivr.net/gh/Lanlan13-14/Rules@main/configfull.yaml',
  'https://ghfast.top/https://raw.githubusercontent.com/Lanlan13-14/Rules/main/configfull.yaml',
];

/**
 * 本地差异（哪些地方故意和上游不一样）定义在 tools/upstream.js 的 LOCAL_PATCH，
 * 自检也用同一份，避免两处各写一遍。
 */

// ------------------------------------------------------------------ 工具

function arg(name) {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : process.argv[i + 1] || '';
}
const has = (name) => process.argv.indexOf(name) >= 0;

function get(url, redirects) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'mihomo-rule-sync', Accept: '*/*' }, timeout: 30000 },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if ((redirects || 0) > 5) return reject(new Error('重定向过多'));
          return get(res.headers.location, (redirects || 0) + 1).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      },
    );
    req.on('timeout', () => req.destroy(new Error('超时')));
    req.on('error', reject);
  });
}

async function fetchUpstream() {
  const errors = [];
  for (const url of SOURCES) {
    try {
      const text = await get(url);
      if (text.length < 10000) throw new Error(`内容过短（${text.length} 字节）`);
      console.log(`  取自 ${url}（${text.length} 字节）`);
      return text;
    } catch (e) {
      errors.push(`${url} → ${e.message}`);
    }
  }
  throw new Error('所有上游镜像都取不到：\n    ' + errors.join('\n    '));
}

async function fetchCommit() {
  try {
    const raw = await get(
      'https://api.github.com/repos/Lanlan13-14/Rules/commits?path=configfull.yaml&per_page=1',
    );
    const j = JSON.parse(raw);
    if (Array.isArray(j) && j[0]) {
      return { commit: String(j[0].sha).slice(0, 10), date: (j[0].commit.committer || {}).date || 'unknown' };
    }
  } catch (e) {
    console.log(`  （取上游 commit 失败，不影响同步：${e.message}）`);
  }
  return { commit: 'unknown', date: 'unknown' };
}

/** JS 字符串字面量 */
function js(s) {
  return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

const BEH = { domain: 'd', ipcidr: 'i', classical: 'c' };

// ------------------------------------------------------------------ 代码生成

function renderBlock(data, meta) {
  const L = [];
  L.push(BEGIN + ' — 由 tools/sync-upstream.js 从上游写入，勿手改');
  L.push('// 这一整块（规则集 / 规则 / fake-ip 白名单 / 分流组）是上游');
  L.push('// Lanlan13-14/Rules 的 configfull.yaml 的机器翻译结果。');
  L.push('// 要同步上游更新：GitHub → Actions → 「同步上游规则」→ Run workflow。');
  L.push('// ==================================================================');
  L.push('');
  L.push('/** 本块对应的上游版本 */');
  L.push('const upstream = {');
  L.push(`  repo: ${js('Lanlan13-14/Rules')},`);
  L.push(`  file: ${js('configfull.yaml')},`);
  L.push(`  commit: ${js(meta.commit)},`);
  L.push(`  date: ${js(meta.date)},`);
  L.push('};');
  L.push('');
  L.push('/**');
  L.push(' * 规则集定义，与上游 configfull.yaml 一一对应。');
  L.push(' * 每项：[名称, 行为(d=domain / i=ipcidr / c=classical), 前缀(M=meta-rules-dat / L=Lanlan / U=完整URL), 路径, 格式?]');
  L.push(' */');
  L.push('const providerDefs = [');
  for (const p of data.providerDefs) {
    const cells = [js(p.name), js(BEH[p.behavior] || 'd'), js(p.tag), js(p.path)];
    if (p.format !== 'mrs') cells.push(js(p.format));
    L.push('  [' + cells.join(', ') + '],');
  }
  L.push('];');
  L.push('');
  L.push('/** 路由规则，顺序与上游 configfull.yaml 完全一致 */');
  L.push('const ruleList = [');
  for (const r of data.ruleList) L.push('  ' + js(r) + ',');
  L.push('];');
  L.push('');
  L.push('/** fake-ip 白名单用到的规则集，与上游一致 */');
  L.push('const fakeIpSets = [');
  for (const n of data.fakeIpSets) L.push('  ' + js(n) + ',');
  L.push('];');
  L.push('');
  L.push('/**');
  L.push(' * 分流策略组，与上游 configfull.yaml 的划分一致。');
  L.push(" *   tpl: 'proxy'  代理优先（上游 Proxy_first）");
  L.push(" *        'direct' 直连优先（上游 Direct_first）");
  L.push(" *        'all'    代理优先并平铺全部节点（上游 Include_all）");
  L.push(' *   fixed:  上游写死的成员，用它就不套模板');
  L.push(' *   prefer: 上游把某个地区组写进了成员，存在时提到最前');
  L.push(' */');
  L.push('const groupDefs = [');
  for (const g of data.groupDefs) {
    const parts = [`name: ${js(g.name)}`];
    if (g.fixed) parts.push(`fixed: [${g.fixed.map(js).join(', ')}]`);
    else parts.push(`tpl: ${js(g.tpl)}`);
    if (g.prefer) parts.push(`prefer: [${g.prefer.map(js).join(', ')}]`);
    if (g.icon) parts.push(`icon: ${js(g.icon)}`);
    L.push('  { ' + parts.join(', ') + ' },');
  }
  L.push('];');
  L.push('');
  L.push('// ==================================================================');
  L.push(END);
  return L.join('\n');
}

// ------------------------------------------------------------------ 差异报告

function summarize(oldData, data) {
  if (!oldData) return ['首次同步'];
  const lines = [];
  const names = (a) => a.map((x) => x.name);
  const diff = (a, b) => ({ added: b.filter((x) => !a.includes(x)), removed: a.filter((x) => !b.includes(x)) });

  const p = diff(names(oldData.providerDefs), names(data.providerDefs));
  if (p.added.length) lines.push(`规则集 +${p.added.length}：${p.added.join(', ')}`);
  if (p.removed.length) lines.push(`规则集 -${p.removed.length}：${p.removed.join(', ')}`);
  const oldP = new Map(oldData.providerDefs.map((x) => [x.name, x]));
  for (const n of data.providerDefs) {
    const o = oldP.get(n.name);
    if (o && (o.path !== n.path || o.behavior !== n.behavior || o.tag !== n.tag || o.format !== n.format)) {
      lines.push(`规则集 ~ ${n.name}：${o.tag}/${o.path} → ${n.tag}/${n.path}`);
    }
  }

  const r = diff(oldData.ruleList, data.ruleList);
  if (r.added.length) lines.push(`规则 +${r.added.length}：${r.added.join(' / ')}`);
  if (r.removed.length) lines.push(`规则 -${r.removed.length}：${r.removed.join(' / ')}`);
  if (!r.added.length && !r.removed.length && oldData.ruleList.join('\n') !== data.ruleList.join('\n')) {
    lines.push('规则顺序有调整');
  }

  const f = diff(oldData.fakeIpSets, data.fakeIpSets);
  if (f.added.length) lines.push(`fake-ip 白名单 +${f.added.join(', ')}`);
  if (f.removed.length) lines.push(`fake-ip 白名单 -${f.removed.join(', ')}`);

  const g = diff(names(oldData.groupDefs), names(data.groupDefs));
  if (g.added.length) lines.push(`分流组 +${g.added.length}：${g.added.join(', ')}`);
  if (g.removed.length) lines.push(`分流组 -${g.removed.length}：${g.removed.join(', ')}`);
  const oldG = new Map(oldData.groupDefs.map((x) => [x.name, x]));
  for (const n of data.groupDefs) {
    const o = oldG.get(n.name);
    if (!o) continue;
    const a = JSON.stringify({ t: o.tpl, f: o.fixed, p: o.prefer });
    const b = JSON.stringify({ t: n.tpl, f: n.fixed, p: n.prefer });
    if (a !== b) lines.push(`分流组 ~ ${n.name}：${a} → ${b}`);
  }

  const gd = diff(oldData.dynamicGroups, data.dynamicGroups);
  if (gd.added.length) lines.push(`上游新增节点/功能组 ${gd.added.join(', ')}（由脚本动态生成，不必照搬）`);
  if (gd.removed.length) lines.push(`上游移除节点/功能组 ${gd.removed.join(', ')}`);

  return lines;
}

/** 上游有、但脚本 regions 里没有定义正则的地区，需要人工补 */
function regionWarnings(script, data) {
  const defined = [];
  const block = script.match(/const regions = \[[\s\S]*?\n\];/);
  if (block) for (const m of block[0].matchAll(/name:\s*'([^']+)'/g)) defined.push(m[1]);
  return data.upstreamRegions.filter((r) => !defined.includes(r.name)).map((r) => r.name);
}

/** 读脚本里已记录的上游版本，离线模式下沿用它，避免把版本号抹成 unknown */
function readCurrentMeta(script) {
  const block = script.match(/const upstream = \{[\s\S]*?\n\};/);
  if (!block) return null;
  const commit = (block[0].match(/commit:\s*'([^']*)'/) || [])[1];
  const date = (block[0].match(/date:\s*'([^']*)'/) || [])[1];
  return commit ? { commit, date: date || 'unknown' } : null;
}

// ------------------------------------------------------------------ 主流程

async function main() {
  const check = has('--check');
  const file = arg('--file');
  const offline = has('--offline');

  let text;
  let meta = { commit: 'unknown', date: 'unknown' };
  if (file) {
    text = fs.readFileSync(file, 'utf8');
    console.log(`  取自本地文件 ${file}（${text.length} 字节）`);
  } else if (offline) {
    text = fs.readFileSync(SNAPSHOT, 'utf8');
    console.log(`  取自仓库快照（${text.length} 字节）`);
  } else {
    text = await fetchUpstream();
    meta = await fetchCommit();
    console.log(`  上游 commit ${meta.commit}（${meta.date}）`);
  }

  const data = up.parse(text);
  console.log(
    `  解析结果：规则集 ${data.providerDefs.length} / 规则 ${data.ruleList.length} / ` +
      `fake-ip 白名单 ${data.fakeIpSets.length} / 分流组 ${data.groupDefs.length}`,
  );

  const errs = up.validate(data);
  if (errs.length) {
    console.error('\n✗ 上游解析结果没通过校验，已放弃写入：');
    for (const e of errs) console.error('  - ' + e);
    process.exit(1);
  }

  // 应用本地差异
  up.applyLocalPatch(data);

  const oldSnapshot = fs.existsSync(SNAPSHOT) ? fs.readFileSync(SNAPSHOT, 'utf8') : null;
  const oldData = oldSnapshot ? up.applyLocalPatch(up.parse(oldSnapshot)) : null;

  const script = fs.readFileSync(SCRIPT, 'utf8');
  const bi = script.indexOf(BEGIN);
  const ei = script.indexOf(END);
  if (bi < 0 || ei < 0) {
    console.error('✗ override.js 里找不到 AUTO-GENERATED 哨兵注释');
    process.exit(1);
  }
  const head = script.slice(0, bi);
  const tail = script.slice(ei + END.length);
  // 离线/本地文件模式拿不到真实 commit，沿用脚本里已记录的版本号
  if (meta.commit === 'unknown') {
    const current = readCurrentMeta(script);
    if (current) meta = current;
  }
  const nextScript = head + renderBlock(data, meta) + tail;

  const changes = summarize(oldData, data);
  const scriptChanged = nextScript !== script;
  const snapshotChanged = oldSnapshot !== text;

  console.log('\n  上游变更：');
  if (changes.length) for (const c of changes) console.log('    • ' + c);
  else console.log('    （规则层面无变化）');

  const warn = regionWarnings(script, data);
  if (warn.length) {
    console.log(`\n  ⚠ 上游有这些地区组，但脚本的 regions 里没定义匹配规则：${warn.join(', ')}`);
    console.log('    分流组引用它们时会被自动跳过，不影响可用性；要启用就在 override.js 的 regions 里加一条。');
  }

  if (check) {
    if (scriptChanged || snapshotChanged) {
      console.log('\n  有更新可同步（--check 模式未写入）');
      process.exit(3);
    }
    console.log('\n  已是最新');
    return;
  }

  if (!scriptChanged && !snapshotChanged) {
    console.log('\n  已是最新，未改动文件');
    return;
  }

  fs.writeFileSync(SCRIPT, nextScript);
  fs.writeFileSync(SNAPSHOT, text);
  console.log(`\n✓ 已更新 Script/override.js${snapshotChanged ? ' 与 test/upstream-snapshot.yaml' : ''}`);

  if (process.env.GITHUB_OUTPUT) {
    const title = changes.length ? changes[0] : '规则无变化';
    const body = changes.map((c) => '- ' + c).join('\n');
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `changed=true\ncommit=${meta.commit}\ntitle=${title.replace(/\n/g, ' ').slice(0, 120)}\n`,
    );
    // commit message 落成文件，workflow 用 -F 读，避免把上游内容插进 shell
    const msgFile = path.join(process.env.RUNNER_TEMP || '/tmp', 'sync-msg.txt');
    fs.writeFileSync(
      msgFile,
      `chore: 同步上游规则 ${meta.commit}\n\n来源：Lanlan13-14/Rules @ configfull.yaml（${meta.date}）\n\n${body}\n`,
    );
    console.log(`  commit message 已写入 ${msgFile}`);
  }
}

main().catch((e) => {
  console.error('✗ ' + e.message);
  process.exit(1);
});
