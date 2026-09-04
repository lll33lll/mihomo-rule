'use strict';

/**
 * 一次性补丁：把「全部节点」组从列表末尾移到「节点选择」后面。
 * 跑完就会连同自己一起被删除，不留在仓库里。
 */

const fs = require('fs');

const FILE = 'Script/override.js';
const OLD = [
  '  const ordered = [mainGroup].concat(',
  '    serviceGroups,',
  '    utilGroups,',
  '    homeGroup ? [homeGroup] : [],',
  '    regionGroups,',
  '    [allGroup, fallbackGroup],',
  '  );',
].join('\n');
const NEW = [
  '  // 「全部节点」紧跟「节点选择」，手动挑节点时不用划到列表最下面',
  '  const ordered = [mainGroup, allGroup].concat(',
  '    serviceGroups,',
  '    utilGroups,',
  '    homeGroup ? [homeGroup] : [],',
  '    regionGroups,',
  '    [fallbackGroup],',
  '  );',
].join('\n');

const src = fs.readFileSync(FILE, 'utf8');
if (src.indexOf(NEW) >= 0) {
  console.log('已经是新顺序，无需改动');
  process.exit(0);
}
if (src.indexOf(OLD) < 0) {
  console.error('✗ 找不到要替换的片段，放弃修改');
  process.exit(1);
}
fs.writeFileSync(FILE, src.replace(OLD, NEW));
console.log('✓ 已把「全部节点」移到「节点选择」后面');
