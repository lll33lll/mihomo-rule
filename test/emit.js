'use strict';
/**
 * 把覆写脚本的产出 dump 成配置文件，交给 mihomo 内核做真实校验。
 * JSON 是 YAML 的子集，直接写成 .yaml 即可被内核解析。
 * 用法：node test/emit.js [输出路径] [规则集CDN前缀]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const out = process.argv[2] || '/tmp/mihomo-check/config.yaml';
const cdn = process.argv[3] || '';

let code = fs.readFileSync(path.resolve(__dirname, '..', 'Script', 'override.js'), 'utf8');
if (cdn) code = code.replace('https://fastly.jsdelivr.net/gh/appshubcc/bett-rules@meta', cdn);
code += '\n;module.exports = { main };';

const sandbox = { module: { exports: {} }, console };
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'override.js' });

// 参数都用内核能通过校验的合法值
const input = {
  proxies: [
    { name: '🇭🇰 香港 01 IEPL', type: 'vmess', server: 'hk1.example.com', port: 443, uuid: '11111111-1111-1111-1111-111111111111', alterId: 0, cipher: 'auto', tls: true, servername: 'hk1.example.com', network: 'ws', 'ws-opts': { path: '/ws' } },
    { name: '香港 02 x2', type: 'trojan', server: 'hk2.example.com', port: 443, password: 'pwd-hk2', sni: 'hk2.example.com' },
    { name: 'JP 东京 01', type: 'vless', server: 'jp1.example.com', port: 443, uuid: '22222222-2222-2222-2222-222222222222', tls: true, servername: 'jp1.example.com', flow: 'xtls-rprx-vision', 'client-fingerprint': 'chrome' },
    { name: '🇺🇸 US 洛杉矶 0.5x', type: 'ss', server: '1.2.3.4', port: 8388, cipher: 'aes-128-gcm', password: 'pwd-us' },
    { name: 'Singapore-01', type: 'hysteria2', server: 'sg1.example.com', port: 443, password: 'pwd-sg', sni: 'sg1.example.com' },
    { name: '🇰🇷 韩国 首尔', type: 'ss', server: 'kr1.example.com', port: 8388, cipher: 'chacha20-ietf-poly1305', password: 'pwd-kr' },
    { name: '剩余流量：188.88 GB', type: 'ss', server: 'sub.example.com', port: 1, cipher: 'aes-128-gcm', password: 'x' },
    { name: '官网 https://airport.example', type: 'ss', server: 'sub.example.com', port: 2, cipher: 'aes-128-gcm', password: 'x' },
  ],
  dns: {
    listen: '0.0.0.0:1053',
    nameserver: ['https://doh.airport.example/dns-query'],
    'proxy-server-nameserver': ['https://doh.airport.example/dns-query'],
  },
  hosts: { 'hk1.example.com': '5.5.5.5' },
};

const cfg = sandbox.module.exports.main(input);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(cfg, null, 2), 'utf8');
console.log(`written ${out}`);
console.log(`groups=${cfg['proxy-groups'].length} rules=${cfg.rules.length} providers=${Object.keys(cfg['rule-providers']).length} proxies=${cfg.proxies.length}`);
