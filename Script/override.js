/**
 * mihomo（Clash.Meta）订阅覆写脚本
 * ------------------------------------------------------------------
 * 用途：覆写「机场提供的订阅配置」，自动生成地区节点组、分流策略组、
 *       无泄露 DNS 与规则集，不要用它覆写自己手写的配置。
 *
 * 特性：
 *   1. 自动剔除机场塞进节点列表的广告 / 到期提示 / 官网入口等假节点
 *   2. 按节点名匹配地区，只为「真的有节点」的地区生成策略组
 *   3. 节点名自动补全国旗、折叠多余空格、去重，并补上漏掉的 udp
 *   4. 规则集全部使用 mrs 二进制格式，按需加载，内存占用远低于 geodata
 *   5. 国内的走国内、国外的走国外：抖音 / 字节 / B 站 / 国内 CDN 明确直连，
 *      字节的海外域名（CapCut、musical.ly 等）跟 TikTok 一起走代理
 *   6. DNS 采用 fake-ip + 国内外分流，国外域名只经代理用 DoH 解析；
 *      测速地址与规则集 CDN 的解析固定走国内 DNS，避免「测速等代理、代理等测速」互锁
 *   7. 兼容机场的私有 DNS / hosts 映射：默认保留 hosts 条目来解析节点域名，
 *      不改 server 也就不会丢掉 TLS 要用的 SNI
 *   8. 所有策略组、开关都在下方「用户配置区」里，改完即生效
 *
 * 用法：把本文件的 URL 或完整代码填进客户端的「覆写 / Override / 脚本」处即可。
 *       支持 mihomo 内核的客户端：Bettbox、FlClash、Clash Verge Rev、
 *       Mihomo Party、Clash Meta for Android 等。
 *
 * 致谢：规则集来自 appshubcc/bett-rules（上游 MetaCubeX/meta-rules-dat）；
 *       图标来自 Koolson/Qure。思路参考 AIsouler/MyClash、Lanlan13-14/Rules
 *       与 dahaha-365/YaNet。
 */

// ==================================================================
//                          用户配置区
// ==================================================================

/** 分流策略组开关：false = 不生成该组，对应规则也不会写入 */
const enableGroups = {
  // --- 基础组 ---
  手动选择: true, // 平铺全部节点，手动点
  自动选择: true, // 全部节点里自动选延迟最低的
  负载均衡: true, // 多节点轮流用，同一连接粘同一节点
  故障转移: true, // 按顺序用第一个可用节点，当前节点挂了自动顺延

  // --- 分流组 ---
  AI: true, // ChatGPT / Claude / Gemini / Copilot 等
  YouTube: true,
  Google: true,
  FCM: true, // 安卓推送，默认走直连，收不到推送就切代理
  GitHub: true,
  Telegram: true,
  Twitter: true, // 含 X
  Instagram: true,
  TikTok: true,
  Netflix: true,
  DisneyPlus: true,
  国际流媒体: true, // HBO / Twitch / Prime Video / Hulu / Abema / 巴哈姆特 / niconico
  Spotify: true,
  Emby: true,
  PikPak: true,
  Steam: true,
  Microsoft: true,
  Apple: true,
  Crypto: true, // 加密货币交易所与行情站
  EHentai: true,
  成人内容: false, // 默认关闭，打开后单独走一个组
};

/** 功能开关 */
const options = {
  生成地区自动选择组: true, // 每个地区额外生成一个 url-test 子组
  隐藏地区手动选择组: false, // 只想用自动选择时可设 true，界面更干净
  分流组平铺全部节点: false, // true = 每个分流组里都能直接点到单个节点（组会很长）
  过滤非地区节点: true, // 剔除名字里带广告/到期提示等信息的假节点
  屏蔽国外QUIC: false, // 默认关：这条规则会顺带拦掉国内 App 走 QUIC 的图片/视频 CDN
  节点域名用加密DNS: false, // 默认关（明文国内 DNS 解析节点域名，最不容易连不上）；开启更隐私但更容易解析失败
  写死节点IP: false, // 默认关。开启后把机场 hosts 里的映射直接写进节点 server，某些机场需要
  节点强制启用UDP: true, // 给订阅节点补 udp: true，修好 QUIC / 游戏 / 语音
  启用TUN: true, // 路由器 / OpenWrt 透明代理场景请设为 false
  启用IPv6: true, // 家里/手机没有 IPv6 出口时设为 false，可少一半无用的 AAAA 查询
  进程匹配: true, // 关闭可省电，但 Emby 等按进程分流的规则会失效（手机建议开）
  代理IPv4优先: false, // 节点统一走 IPv4（与下面同时开则都不生效）
  代理IPv6优先: false,
};

/** 地区节点组：想加地区就往数组里加一项，正则匹配不到节点时该组会自动跳过 */
const regions = [
  {
    name: '香港',
    flag: '🇭🇰',
    re: /🇭🇰|香港|港區|港区|(?<![A-Za-z])HKG?(?![A-Za-z])|hong\s*kong/i,
    icon: 'Hong_Kong',
  },
  {
    name: '日本',
    flag: '🇯🇵',
    re: /🇯🇵|日本|东京|東京|大阪|京都|埼玉|(?<![A-Za-z])JPN?(?![A-Za-z])|japan|tokyo|osaka/i,
    icon: 'Japan',
  },
  {
    name: '美国',
    flag: '🇺🇸',
    re: /🇺🇸|美国|美國|纽约|紐約|洛杉矶|洛杉磯|旧金山|舊金山|硅谷|芝加哥|休斯顿|迈阿密|邁阿密|西雅图|西雅圖|波士顿|波士頓|华盛顿|華盛頓|拉斯维加斯|圣何塞|聖何塞|圣地亚哥|达拉斯|凤凰城|阿什本|(?<![A-Za-z])USA?(?![A-Za-z])|america|united\s*states/i,
    icon: 'United_States',
  },
  {
    name: '新加坡',
    flag: '🇸🇬',
    re: /🇸🇬|新加坡|狮城|獅城|(?<![A-Za-z])SGP?(?![A-Za-z])|singapore/i,
    icon: 'Singapore',
  },
];

/** 没匹配到上面任何地区的节点会归到这里 */
const otherRegionName = '其他节点';

/** 假节点识别正则：机场常把广告、到期提示塞成节点名 */
const junkRe =
  /群|返利|循环|官网|客服|网站|网址|获取|订阅|流量|到期|机场|下次|版本|官址|备用|过期|已用|联系|邮箱|工单|贩卖|通知|倒卖|防止|地址|频道|电报|无法|说明|提示|访问|支持|教程|关注|更新|作者|加入|超时|收藏|优惠|福利|邀请|好友|失联|剩余|公益|发布|通路|登录|禁止|定时|渠道|牢记|永久|余额|阁下|本站|刷新|导航|建议|重置|以下|⚠️|@|t\.me\/\+|\bexpire\b|\bhttps?:\/\/|\.com|\btraffic\b/i;

/** 想额外直连/代理的域名写这里，会插在所有规则最前面 */
const customRules = [
  // 'DOMAIN-SUFFIX,example.com,直连',
  // 'DOMAIN-SUFFIX,example.org,默认代理',
];

/** 自建节点：填了会额外生成「自建节点」组，且不参与假节点过滤 */
const customProxies = [
  // {
  //   name: '自建-日本',
  //   type: 'vless',
  //   server: '1.2.3.4',
  //   port: 443,
  //   uuid: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
  //   tls: true,
  //   servername: 'example.com',
  //   network: 'tcp',
  // },
];

// ==================================================================
//                        以下一般不用改
// ==================================================================

/** 规则集 CDN。国内直连不通时可换成 https://testingcf.jsdelivr.net/... 或自建镜像 */
const RULES_BASE = 'https://fastly.jsdelivr.net/gh/appshubcc/bett-rules@meta';
const ICON_BASE = 'https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color';

/** 国内 DNS：明文，解析国内域名、节点域名与连通性检测域名 */
const cnDns = ['223.5.5.5', '119.29.29.29'];
/** 国内 DoH：更隐私，但首次连接慢、被干扰时会解析失败，所以只在开关打开时用 */
const cnDoh = ['https://223.5.5.5/dns-query#DIRECT', 'https://doh.pub/dns-query#DIRECT'];
/** 国外 DoH：走代理出去，国外域名的解析全部经此，避免 DNS 泄露 */
const fgDoh = ['https://cloudflare-dns.com/dns-query#默认代理', 'https://dns.google/dns-query#默认代理'];

/**
 * 连通性检测地址。用 HTTP 省一次 TLS 握手；域名固定交给国内 DNS 解析。
 * 这一点很关键：如果测速域名要靠「国外 DoH 经代理」来解析，就会变成
 * 「测速等解析、解析等代理、代理等测速」的死循环，表现是所有节点都超时。
 */
const healthCheckUrl = 'http://cp.cloudflare.com/generate_204';
const healthCheckDomains = ['cp.cloudflare.com', 'connectivitycheck.platform.hicloud.com'];

const icon = (n) => `${ICON_BASE}/${n}.png`;

/** 生成一条 rule-provider 定义 */
function ruleSet(file, behavior) {
  const dir = behavior === 'ipcidr' ? 'geo/geoip' : behavior === 'asn' ? 'asn' : 'geo/geosite';
  return {
    type: 'http',
    format: 'mrs',
    interval: 86400,
    behavior: behavior === 'asn' ? 'ipcidr' : behavior,
    url: `${RULES_BASE}/${dir}/${file}.mrs`,
    path: `./ruleset/${dir === 'asn' ? 'asn_' : dir.endsWith('geoip') ? 'ip_' : ''}${file}.mrs`,
  };
}

const site = (f) => ruleSet(f, 'domain');
const ip = (f) => ruleSet(f, 'ipcidr');
const asn = (f) => ruleSet(f, 'asn');

/** 直连与兜底一定会用到的规则集 */
const baseProviders = {
  private: site('private'),
  private_ip: ip('private'),
  cn_site: site('cn'),
  cn_ip: ip('cn'),
  'geolocation-cn': site('geolocation-cn'),
  'geolocation-!cn': site('geolocation-!cn'),
  fakeip_filter: site('fakeip-filter'),
  games_cn: site('category-games@cn'),
  epicgames: site('epicgames'),
  nvidia_cn: site('nvidia@cn'),
  apple_cn: site('apple@cn'),
  microsoft_cn: site('microsoft@cn'),
  // 下面几个是「国内的走国内」的关键补充：
  // geolocation-cn 里 byteimg.com 只收了 juejin/novel 几个子域，
  // 抖音图集图片走的 p*-sign.byteimg.com 不在里面，会被兜底规则送去代理，
  // 结果国内 CDN 拒绝海外 IP —— 视频能看、图集不显示就是这么来的。
  douyin: site('douyin'),
  bytedance: site('bytedance'),
  bytedance_notcn: site('bytedance@!cn'),
  cdn_cn: site('category-cdn-cn'),
  bilibili: site('bilibili'),
};

/** 国内直连规则集：放在服务分流之前，不会和任何分流组抢域名 */
const cnDirectEarly = ['private', 'games_cn', 'epicgames', 'nvidia_cn', 'apple_cn', 'microsoft_cn'];
/** 国内直连规则集：必须放在服务分流之后，否则 bytedance 会把 TikTok 一起吃掉 */
const cnDirectLate = ['douyin', 'bytedance', 'cdn_cn', 'bilibili'];
/** 上面两组的合集，用于 DNS 策略与 fake-ip 白名单 */
const cnAllSets = cnDirectEarly.concat(cnDirectLate);

/** 策略组公共参数 */
const groupBase = {
  url: healthCheckUrl,
  interval: 600,
  timeout: 5000,
  lazy: true,
  'max-failed-times': 5,
};
const selectBase = Object.assign({}, groupBase, { type: 'select' });
const autoBase = Object.assign({}, groupBase, {
  type: 'url-test',
  tolerance: 50,
  'exclude-type': 'DIRECT',
  icon: icon('Auto'),
  hidden: true,
});
const balanceBase = Object.assign({}, groupBase, {
  type: 'load-balance',
  strategy: 'sticky-sessions',
  'exclude-type': 'DIRECT',
  icon: icon('Round_Robin'),
});

/** 直连节点，供「直连」组切换 IP 栈 */
const directProxies = [
  { name: '直连 · 双栈', type: 'direct' },
  { name: '直连 · IPv4优先', type: 'direct', 'ip-version': 'ipv4-prefer' },
  { name: '直连 · IPv6优先', type: 'direct', 'ip-version': 'ipv6-prefer' },
  { name: '直连 · 仅IPv4', type: 'direct', 'ip-version': 'ipv4' },
];

/**
 * 分流服务定义。数组顺序 = 生成规则的顺序，越具体的服务要越靠前。
 *   key       对应 enableGroups 里的开关
 *   name      策略组显示名
 *   direct    true = 组内附带「直连」选项（默认仍是代理）
 *   pick      组的默认选中项（提到列表首位，客户端默认选中第一项）
 *   sets      该组需要的规则集
 *   rules     该组的路由规则；带 process:true 的会在关闭进程匹配时被跳过
 *   onlyRules 只贡献规则、不生成策略组（用于给已有组补充规则）
 */
const services = [
  {
    key: 'FCM',
    name: 'FCM',
    direct: true,
    pick: '直连',
    icon: icon('Google_Play_Store'),
    sets: { googlefcm: site('googlefcm') },
    rules: ['RULE-SET,googlefcm,FCM'],
  },
  {
    key: 'YouTube',
    name: 'YouTube',
    icon: icon('YouTube'),
    sets: { youtube: site('youtube') },
    rules: ['RULE-SET,youtube,YouTube'],
  },
  {
    key: 'AI',
    name: 'AI',
    pick: '美国',
    icon: icon('ChatGPT'),
    sets: { ai: site('category-ai-!cn') },
    rules: ['RULE-SET,ai,AI'],
  },
  {
    key: 'GitHub',
    name: 'GitHub',
    icon: icon('GitHub'),
    sets: { github: site('github') },
    rules: ['RULE-SET,github,GitHub'],
  },
  {
    key: 'Telegram',
    name: 'Telegram',
    icon: icon('Telegram'),
    sets: { telegram: site('telegram'), telegram_ip: ip('telegram') },
    rules: ['RULE-SET,telegram,Telegram', 'RULE-SET,telegram_ip,Telegram,no-resolve'],
  },
  {
    key: 'Twitter',
    name: 'Twitter',
    icon: icon('Twitter'),
    sets: { twitter: site('twitter'), twitter_ip: ip('twitter') },
    rules: ['RULE-SET,twitter,Twitter', 'RULE-SET,twitter_ip,Twitter,no-resolve'],
  },
  {
    key: 'Instagram',
    name: 'Instagram',
    icon: icon('Instagram'),
    sets: { instagram: site('instagram') },
    rules: ['RULE-SET,instagram,Instagram'],
  },
  {
    key: 'TikTok',
    name: 'TikTok',
    pick: '日本',
    icon: icon('TikTok'),
    sets: { tiktok: site('tiktok') },
    rules: ['RULE-SET,tiktok,TikTok'],
  },
  {
    // 字节的海外服务（CapCut / musical.ly / ibyteimg 等）走代理，
    // 剩下的字节域名在下面的国内规则里直连，两条顺序不能反。
    key: 'TikTok',
    name: 'TikTok',
    onlyRules: true,
    rules: ['RULE-SET,bytedance_notcn,TikTok'],
  },
  {
    key: 'Netflix',
    name: 'Netflix',
    icon: icon('Netflix'),
    sets: { netflix: site('netflix'), netflix_ip: ip('netflix') },
    rules: ['RULE-SET,netflix,Netflix', 'RULE-SET,netflix_ip,Netflix,no-resolve'],
  },
  {
    key: 'DisneyPlus',
    name: 'Disney+',
    icon: icon('Disney+'),
    sets: { disney: site('disney') },
    rules: ['RULE-SET,disney,Disney+'],
  },
  {
    key: '国际流媒体',
    name: '国际流媒体',
    icon: icon('Streaming'),
    sets: {
      hbo: site('hbo'),
      twitch: site('twitch'),
      primevideo: site('primevideo'),
      hulu: site('hulu'),
      abema: site('abema'),
      bahamut: site('bahamut'),
      niconico: site('niconico'),
    },
    rules: [
      'RULE-SET,hbo,国际流媒体',
      'RULE-SET,twitch,国际流媒体',
      'RULE-SET,primevideo,国际流媒体',
      'RULE-SET,hulu,国际流媒体',
      'RULE-SET,abema,国际流媒体',
      'RULE-SET,bahamut,国际流媒体',
      'RULE-SET,niconico,国际流媒体',
    ],
  },
  {
    key: 'Spotify',
    name: 'Spotify',
    direct: true,
    icon: icon('Spotify'),
    sets: { spotify: site('spotify') },
    rules: ['RULE-SET,spotify,Spotify'],
  },
  {
    key: 'Emby',
    name: 'Emby',
    direct: true,
    icon: icon('Emby'),
    sets: { emby: site('category-emby') },
    rules: [
      'RULE-SET,emby,Emby',
      'DOMAIN-KEYWORD,emby,Emby',
      'DOMAIN-SUFFIX,mb3admin.com,Emby',
      { rule: 'PROCESS-NAME,com.mb.android,Emby', process: true },
      { rule: 'PROCESS-NAME,tv.emby.embyatv,Emby', process: true },
      { rule: 'PROCESS-NAME,com.hush.yamby,Emby', process: true },
      { rule: 'PROCESS-NAME,com.jellycine.app,Emby', process: true },
      { rule: 'PROCESS-NAME,com.mountains.hills,Emby', process: true },
      { rule: 'PROCESS-NAME,Emby.exe,Emby', process: true },
    ],
  },
  {
    key: 'PikPak',
    name: 'PikPak',
    direct: true,
    icon: icon('PikPak'),
    sets: { pikpak: site('pikpak') },
    rules: ['RULE-SET,pikpak,PikPak'],
  },
  {
    key: 'Steam',
    name: 'Steam',
    direct: true,
    icon: icon('Steam'),
    sets: { steam: site('steam'), steam_asn: asn('AS32590') },
    rules: ['RULE-SET,steam,Steam', 'RULE-SET,steam_asn,Steam,no-resolve'],
  },
  {
    key: 'Crypto',
    name: 'Crypto',
    pick: '日本',
    icon: icon('Cryptocurrency'),
    sets: { crypto: site('category-cryptocurrency') },
    rules: ['RULE-SET,crypto,Crypto'],
  },
  {
    key: 'EHentai',
    name: 'EHentai',
    pick: '美国',
    icon: icon('Pornhub'),
    sets: { ehentai: site('ehentai') },
    rules: ['RULE-SET,ehentai,EHentai'],
  },
  {
    key: '成人内容',
    name: '成人内容',
    icon: icon('Pornhub'),
    sets: { porn: site('category-porn') },
    rules: ['RULE-SET,porn,成人内容'],
  },
  {
    key: 'Google',
    name: 'Google',
    icon: icon('Google_Search'),
    sets: { google: site('google'), google_ip: ip('google') },
    rules: ['RULE-SET,google,Google', 'RULE-SET,google_ip,Google,no-resolve'],
  },
  {
    key: 'Microsoft',
    name: 'Microsoft',
    direct: true,
    icon: icon('Microsoft'),
    sets: { microsoft: site('microsoft'), onedrive: site('onedrive') },
    rules: ['RULE-SET,onedrive,Microsoft', 'RULE-SET,microsoft,Microsoft'],
  },
  {
    key: 'Apple',
    name: 'Apple',
    direct: true,
    pick: '直连',
    icon: icon('Apple'),
    sets: { apple: site('apple') },
    rules: ['RULE-SET,apple,Apple'],
  },
];

/**
 * 屏蔽国外 QUIC：UDP/443 且不是国内目标就丢掉。
 * 「不是国内」的判定把国内 App 常用的规则集全列进来，否则抖音这类走 QUIC 的
 * 图片 CDN 会被一起拦掉（图集刷不出来就是这个原因）。
 */
const quicRule =
  'AND,((NETWORK,UDP),(DST-PORT,443),(NOT,((OR,(' +
  ['cn_site'].concat(cnAllSets).map((k) => `(RULE-SET,${k})`).join(',') +
  ',(RULE-SET,cn_ip,no-resolve)))))),REJECT';

// ==================================================================
//                          工具函数
// ==================================================================

const regionCache = new Map();
/** 取节点名匹配到的地区定义（结果缓存，避免重复跑正则） */
function matchRegions(name) {
  if (regionCache.has(name)) return regionCache.get(name);
  const hit = regions.filter((r) => r.re.test(name));
  regionCache.set(name, hit);
  return hit;
}

const flagRe = /[\u{1F1E6}-\u{1F1FF}]{2}/u;
/** 节点名标准化：折叠空格，缺国旗的按地区补上 */
function normalizeName(proxy) {
  const raw = String(proxy.name);
  const flag = (raw.match(flagRe) || [])[0];
  const body = (flag ? raw.replace(flag, '') : raw).replace(/\s+/g, ' ').trim();
  const hit = matchRegions(raw);
  const useFlag = flag || (hit.length ? hit[0].flag : '');
  const next = useFlag ? `${useFlag} ${body}` : body;
  if (next === raw) return proxy;
  regionCache.set(next, hit);
  return Object.assign({}, proxy, { name: next });
}

/** 同时开或同时关都返回空，避免互相打架 */
function ipVersionPref() {
  if (options.代理IPv4优先 && !options.代理IPv6优先) return 'ipv4-prefer';
  if (options.代理IPv6优先 && !options.代理IPv4优先) return 'ipv6-prefer';
  return '';
}

/**
 * 过滤 + 标准化订阅节点：
 * 剔除 direct/reject 类型与假节点，补国旗，按名字去重，修正 dialer-proxy 悬空引用
 */
function prepareProxies(config) {
  regionCache.clear();
  const src = Array.isArray(config.proxies) ? config.proxies : [];

  const kept = src.filter((p) => {
    if (!p || typeof p.name !== 'string') return false;
    const t = String(p.type || '').toLowerCase();
    if (t === 'direct' || t === 'reject' || t === 'reject-drop' || t === 'pass' || t === 'rematch') return false;
    if (!options.过滤非地区节点) return true;
    // 名字里能认出地区的一律保留，其余按假节点特征剔除
    return matchRegions(p.name).length > 0 || !junkRe.test(p.name);
  });

  const renamed = new Map();
  const seen = new Set();
  const out = [];
  for (const p of kept) {
    const n = normalizeName(p);
    if (n.name !== p.name) renamed.set(p.name, n.name);
    if (seen.has(n.name)) continue;
    seen.add(n.name);
    out.push(n);
  }

  const pref = ipVersionPref();
  const finalList = out.map((p) => {
    let next = p;
    const dialer = p['dialer-proxy'];
    if (dialer) {
      if (renamed.has(dialer)) {
        next = Object.assign({}, next, { 'dialer-proxy': renamed.get(dialer) });
      } else if (!seen.has(dialer)) {
        next = Object.assign({}, next);
        delete next['dialer-proxy'];
      }
    }
    if (pref && next['ip-version'] !== pref) next = Object.assign({}, next, { 'ip-version': pref });
    // 不少机场订阅漏了 udp 字段，补上之后 QUIC、游戏、语音才正常
    if (options.节点强制启用UDP && next.udp !== true) next = Object.assign({}, next, { udp: true });
    return next;
  });

  if (!finalList.length) {
    throw new Error('订阅里没有可用节点，请确认这份配置来自机场，而不是手写配置');
  }
  return finalList;
}

const ipv4Re = /^\d{1,3}(\.\d{1,3}){3}$/;
/** 粗判 server 是否已经是 IP，是的话不需要 DNS 解析 */
function isIp(v) {
  const s = String(v || '').trim();
  return ipv4Re.test(s) || s.indexOf(':') >= 0;
}

/** hosts 的 key 越具体优先级越高：精确域名 > 通配 */
function hostSpecificity(pattern) {
  const p = String(pattern);
  const wildcard = p.indexOf('+') === 0 || p.indexOf('*') >= 0;
  return (wildcard ? 0 : 1000) + p.split('.').length;
}

/** hosts 的 key 是否命中某个域名 */
function hostMatch(pattern, domain) {
  const p = String(pattern).toLowerCase();
  const d = String(domain).toLowerCase();
  if (p === d) return true;
  if (p.indexOf('+.') === 0) {
    const base = p.slice(2);
    return d === base || d.endsWith(`.${base}`);
  }
  if (p.indexOf('*.') === 0) {
    const base = p.slice(2);
    return d.endsWith(`.${base}`) && d.split('.').length === base.split('.').length + 1;
  }
  return false;
}

/** TLS 握手要用的域名字段：不同协议叫法不一样，改写 server 时必须把原域名留在这里 */
function sniFieldOf(proxy) {
  const type = String(proxy.type || '').toLowerCase();
  if (type === 'trojan' || type === 'hysteria' || type === 'hysteria2' || type === 'tuic' || type === 'anytls') {
    return 'sni';
  }
  return 'servername';
}

/**
 * 把订阅 hosts 里能定死的节点域名写进 proxy.server（仅在「写死节点IP」开启时执行）。
 *
 * 默认不做这件事：trojan / hysteria2 / vless-reality 这类协议不写 tls: true 也是 TLS，
 * 一旦 server 变成 IP 而 SNI 没跟上，握手就会失败，表现是所有节点测速超时。
 * 默认走的是另一条更安全的路——把机场 hosts 里跟节点有关的条目原样保留到输出的 hosts，
 * 由 use-hosts 完成解析，域名不变、SNI 不动。
 */
function applyHosts(proxies, hosts) {
  if (!hosts || typeof hosts !== 'object') return { proxies, used: false };
  const entries = Object.keys(hosts)
    .map((k) => ({ pattern: k, value: hosts[k], weight: hostSpecificity(k) }))
    .sort((a, b) => b.weight - a.weight);
  if (!entries.length) return { proxies, used: false };

  const firstValue = (v) => (Array.isArray(v) ? v.find((x) => !!x) : v);

  const resolve = (server, depth) => {
    if (depth > 5 || !server || isIp(server)) return '';
    for (const e of entries) {
      if (!hostMatch(e.pattern, server)) continue;
      const val = String(firstValue(e.value) || '').trim();
      if (!val || val === '0.0.0.0' || val === '::') return '';
      if (isIp(val)) return val;
      return resolve(val, depth + 1); // hosts 里写的是 CNAME，继续往下找
    }
    return '';
  };

  let used = false;
  const mapped = proxies.map((p) => {
    if (typeof p.server !== 'string' || isIp(p.server)) return p;
    const hit = resolve(p.server, 0);
    if (!hit) return p;
    used = true;
    const patch = { server: hit };
    // 原域名必须留给 TLS，否则证书校验过不去
    const field = sniFieldOf(p);
    if (!p.servername && !p.sni && !p.host) patch[field] = p.server;
    return Object.assign({}, p, patch);
  });
  return { proxies: mapped, used };
}

/** 常见公共 DNS，用来识别「机场自带的私有 DNS」 */
const publicDnsRe =
  /^(system|dhcp|223\.5\.5\.5|223\.6\.6\.6|119\.29\.29\.29|182\.254\.11[68]\.118|114\.114\.114\.114|1\.12\.12\.12|120\.53\.53\.53|180\.76\.76\.76|117\.50\.\d+\.\d+|8\.8\.[84]\.[84]|1\.1\.1\.1|1\.0\.0\.1|9\.9\.9\.\d+|149\.112\.112\.112|208\.67\.22[02]\.22[02]|94\.140\.1[45]\.1[45]|dns\.(google|alidns\.com|quad9\.net|adguard\.com|sb|twnic\.tw)|(cloudflare|adguard|opendns|mozilla\.cloudflare)-dns\.com|doh\.(pub|dns\.sb|opendns\.com)|.*\.doh\.pub|security\.cloudflare-dns\.com|unfiltered\.adguard-dns\.com)$/i;

/** 去掉 dns 条目上的 #策略 后缀与协议前缀，拿到主机名 */
function dnsHost(entry) {
  let s = String(entry || '').trim();
  const hash = s.indexOf('#');
  if (hash >= 0) s = s.slice(0, hash);
  s = s.replace(/^(https|tls|quic|udp|tcp|dhcp|h3|system):\/\//i, '');
  s = s.replace(/\/.*$/, '');
  s = s.replace(/^\[|\]$/g, '');
  s = s.replace(/:\d+$/, '');
  return s.toLowerCase();
}

/** 去掉 #策略 后缀，保留协议，作为可直接使用的 dns 条目 */
function stripPolicy(entry) {
  const s = String(entry || '').trim();
  const hash = s.indexOf('#');
  return (hash >= 0 ? s.slice(0, hash) : s).trim();
}

function isPublicDns(entry) {
  return publicDnsRe.test(dnsHost(entry));
}

/**
 * 生成 dns / hosts，并返回可能被改写过 server 的节点列表。
 *
 * 无泄露的关键：国外域名只由 nameserver 里的国外 DoH 解析，而这些 DoH 自身
 * 被固定在 hosts 里并强制走「默认代理」，所以查询内容不会经过本地运营商；
 * 国内域名由 nameserver-policy 交给国内 DNS，直连场景不绕路。
 */
function buildDns(config, proxies) {
  const orig = config.dns && typeof config.dns === 'object' ? config.dns : {};
  const applied = options.写死节点IP ? applyHosts(proxies, config.hosts) : { proxies, used: false };
  const mapped = applied.proxies;

  const proxyDomains = [];
  for (const p of mapped) {
    if (typeof p.server === 'string' && !isIp(p.server)) {
      const d = p.server.toLowerCase();
      if (proxyDomains.indexOf(d) < 0) proxyDomains.push(d);
    }
  }

  // 机场自带的私有 DNS：可能是解析节点域名的唯一途径，但指向本机的那种覆写后已失效
  const privateDns = [];
  const rawDnsEntries = (orig['proxy-server-nameserver'] || []).concat(orig.nameserver || []);
  for (const entry of rawDnsEntries) {
    if (isPublicDns(entry)) continue;
    const host = dnsHost(entry);
    if (!host || /^(127\.|0\.0\.0\.0$|::1$|localhost$)/.test(host)) continue;
    const clean = stripPolicy(entry);
    if (clean && privateDns.indexOf(clean) < 0) privateDns.push(clean);
  }

  // 只把「命中节点域名」的策略搬过来，避免机场的 DNS 策略污染其它域名
  const proxyPolicy = {};
  const origPolicies = Object.assign({}, orig['nameserver-policy'], orig['proxy-server-nameserver-policy']);
  for (const key of Object.keys(origPolicies)) {
    if (!proxyDomains.some((d) => hostMatch(key, d) || key.toLowerCase() === d)) continue;
    const val = origPolicies[key];
    const cleaned = (Array.isArray(val) ? val : [val]).map(stripPolicy).filter((v) => !!v);
    if (cleaned.length) proxyPolicy[key] = cleaned;
  }
  if (privateDns.length && !Object.keys(proxyPolicy).length) {
    for (const d of proxyDomains) proxyPolicy[d] = privateDns;
  }

  const dns = {
    enable: true,
    ipv6: options.启用IPv6,
    'use-hosts': true,
    'use-system-hosts': true,
    'cache-algorithm': 'arc',
    'enhanced-mode': 'fake-ip',
    'fake-ip-range': '198.18.0.1/15',
    'fake-ip-filter': [
      `rule-set:fakeip_filter,geolocation-cn,${cnAllSets.join(',')}`,
      '+.lan',
      '+.local',
    ].concat(proxyDomains),
    'default-nameserver': cnDns,
    // 节点域名默认用明文国内 DNS 解析：DoH 首次连接慢、被干扰时会直接导致全部节点超时
    'proxy-server-nameserver': options.节点域名用加密DNS ? cnDoh : cnDns,
    nameserver: fgDoh,
    // 一个 rule-set: 前缀后面用逗号并列多个规则集，写成 rule-set:a,rule-set:b 内核会解析失败
    'nameserver-policy': {
      [`rule-set:cn_site,${cnAllSets.join(',')}`]: cnDns,
      // 测速地址必须能不经代理就解析出来，否则「测速等解析、解析等代理、代理等测速」互相锁死
      [healthCheckDomains.join(',')]: cnDns,
      // 规则集 CDN 同理：拉规则集不该反过来依赖代理
      '+.jsdelivr.net': cnDns,
    },
    'direct-nameserver': ['system'].concat(cnDns),
  };
  if (Object.keys(proxyPolicy).length) dns['proxy-server-nameserver-policy'] = proxyPolicy;

  const hosts = {
    // 固定住国外 DoH 的 IP，否则「解析 DNS 服务器域名」本身会形成死循环
    'cloudflare-dns.com': ['1.1.1.1', '1.0.0.1'],
    'dns.google': ['8.8.8.8', '8.8.4.4'],
    // 让 Google Play 的下载域名可用
    'services.googleapis.cn': 'services.googleapis.com',
    // 掐掉 B 站 PCDN，解决看视频/直播卡顿和上传占满带宽
    '+.mcdn.bilivideo.com': ['0.0.0.0'],
    '+.mcdn.bilivideo.cn': ['0.0.0.0'],
  };
  // 订阅 hosts 里跟节点域名相关的条目一律保留：不改写 server 时，节点域名就靠它解析
  if (config.hosts && typeof config.hosts === 'object') {
    for (const key of Object.keys(config.hosts)) {
      if (hosts[key] !== undefined) continue;
      if (proxyDomains.some((d) => hostMatch(key, d) || key.toLowerCase() === d)) hosts[key] = config.hosts[key];
    }
  }

  return { dns, hosts, proxies: mapped };
}

// ==================================================================
//                          策略组构建
// ==================================================================

/** 地区组：一个 select（可点具体节点）+ 一个隐藏的 url-test 子组 */
function makeRegionGroup(name, iconName, members) {
  const groups = [];
  const autoName = `${name} · 自动`;
  if (options.生成地区自动选择组) {
    groups.push(Object.assign({}, autoBase, { name: autoName, proxies: members.slice() }));
  }
  groups.push(
    Object.assign({}, selectBase, {
      name,
      icon: typeof iconName === 'string' && iconName.indexOf('http') === 0 ? iconName : icon(iconName),
      proxies: (options.生成地区自动选择组 ? [autoName] : []).concat(members),
      hidden: !!options.隐藏地区手动选择组,
    }),
  );
  return groups;
}

/** 自建节点重名时加前缀，避免覆盖订阅节点 */
function prepareCustom(subNames) {
  const out = [];
  const used = new Set(subNames);
  for (const p of customProxies) {
    if (!p || typeof p.name !== 'string') continue;
    let name = p.name;
    while (used.has(name)) name = `自建-${name}`;
    used.add(name);
    out.push(name === p.name ? p : Object.assign({}, p, { name }));
  }
  return out;
}

/** 把 pick 指定的项提到列表最前面（mihomo 默认选中第一项，等效于设置默认值） */
function withPick(list, pick) {
  if (!pick) return list;
  const idx = list.indexOf(pick);
  if (idx <= 0) return list;
  const copy = list.slice();
  copy.splice(idx, 1);
  copy.unshift(pick);
  return copy;
}

function buildGroups(proxies, custom) {
  const subNames = proxies.map((p) => p.name);
  const customNames = custom.map((p) => p.name);
  const allNames = customNames.concat(subNames);

  // --- 地区归类 ---
  const buckets = {};
  for (const r of regions) buckets[r.name] = [];
  const others = [];
  for (const name of allNames) {
    const hit = matchRegions(name);
    if (hit.length) {
      for (const r of hit) buckets[r.name].push(name);
    } else {
      others.push(name);
    }
  }

  const regionGroups = [];
  for (const r of regions) {
    if (!buckets[r.name].length) continue;
    regionGroups.push.apply(regionGroups, makeRegionGroup(r.name, r.icon, buckets[r.name]));
  }
  if (others.length) {
    regionGroups.push.apply(regionGroups, makeRegionGroup(otherRegionName, 'World_Map', others));
  }
  const regionSelects = regionGroups.filter((g) => g.type === 'select').map((g) => g.name);

  // --- 基础组 ---
  const baseGroups = [];
  if (enableGroups.手动选择) {
    baseGroups.push(
      Object.assign({}, selectBase, {
        name: '手动选择',
        icon: icon('Static'),
        proxies: allNames.slice(),
      }),
    );
  }
  if (enableGroups.自动选择) {
    baseGroups.push(
      Object.assign({}, autoBase, { name: '自动选择', icon: icon('Auto'), hidden: false, proxies: allNames.slice() }),
    );
  }
  if (enableGroups.负载均衡) {
    baseGroups.push(Object.assign({}, balanceBase, { name: '负载均衡', proxies: allNames.slice() }));
  }
  if (enableGroups.故障转移) {
    baseGroups.push(
      Object.assign({}, groupBase, {
        type: 'fallback',
        name: '故障转移',
        'exclude-type': 'DIRECT',
        icon: icon('Bypass'),
        proxies: allNames.slice(),
      }),
    );
  }
  const baseNames = baseGroups.map((g) => g.name);

  const customGroup = customNames.length
    ? Object.assign({}, selectBase, {
        name: '自建节点',
        icon: icon('Server'),
        proxies: customNames.slice(),
      })
    : null;
  const customGroupNames = customGroup ? [customGroup.name] : [];

  // --- 默认代理：所有分流组的上游 ---
  const defaultGroup = Object.assign({}, selectBase, {
    name: '默认代理',
    icon: icon('Proxy'),
    proxies: regionSelects.concat(baseNames, customGroupNames),
  });

  // --- 分流组 ---
  const serviceGroups = [];
  const rules = [];
  const providers = Object.assign({}, baseProviders);

  for (const svc of services) {
    if (!enableGroups[svc.key]) continue;

    Object.assign(providers, svc.sets || {});
    for (const r of svc.rules || []) {
      if (typeof r === 'string') {
        rules.push(r);
      } else if (r && r.rule) {
        if (r.process && !options.进程匹配) continue;
        rules.push(r.rule);
      }
    }

    // onlyRules 的条目只贡献规则，不再重复生成同名策略组
    if (svc.onlyRules) continue;

    let members = ['默认代理'].concat(customGroupNames, baseNames, regionSelects);
    if (svc.direct) members.push('直连');
    if (options.分流组平铺全部节点) members = members.concat(allNames);

    serviceGroups.push(
      Object.assign({}, selectBase, {
        name: svc.name,
        icon: svc.icon,
        proxies: withPick(members, svc.pick),
      }),
    );
  }

  const fallbackGroup = Object.assign({}, selectBase, {
    name: '漏网之鱼',
    icon: icon('Final'),
    proxies: ['默认代理', '直连'].concat(baseNames, regionSelects),
  });

  const directGroup = Object.assign({}, selectBase, {
    name: '直连',
    icon: icon('China_Map'),
    url: 'http://connectivitycheck.platform.hicloud.com/generate_204',
    proxies: directProxies.map((p) => p.name),
  });

  const ordered = [defaultGroup]
    .concat(baseGroups, serviceGroups, [fallbackGroup])
    .concat(customGroup ? [customGroup] : [], [directGroup], regionGroups);

  const globalGroup = Object.assign({}, selectBase, {
    name: 'GLOBAL',
    icon: icon('Global'),
    proxies: ordered.map((g) => g.name),
  });

  return { groups: [globalGroup].concat(ordered), providers, rules };
}

// ==================================================================
//                            主入口
// ==================================================================

function main(config) {
  const subProxies = prepareProxies(config);
  const custom = prepareCustom(subProxies.map((p) => p.name));
  const dnsResult = buildDns(config, subProxies);
  const built = buildGroups(dnsResult.proxies, custom);

  const out = {};

  out['mixed-port'] = 7890;
  out['allow-lan'] = true;
  out['bind-address'] = '*';
  out['mode'] = 'rule';
  out['log-level'] = 'info';
  out['ipv6'] = options.启用IPv6;
  out['unified-delay'] = true;
  out['tcp-concurrent'] = true;
  out['keep-alive-idle'] = 600;
  out['keep-alive-interval'] = 30;
  out['global-ua'] = 'clash.meta';
  out['find-process-mode'] = options.进程匹配 ? 'strict' : 'off';
  out['external-controller'] = '127.0.0.1:9090';
  out['external-ui'] = 'ui';
  out['external-ui-url'] = 'https://github.com/Zephyruso/zashboard/releases/latest/download/dist.zip';

  out['profile'] = { 'store-selected': true, 'store-fake-ip': true };

  out['sniffer'] = {
    enable: true,
    'override-destination': false,
    sniff: {
      HTTP: { ports: [80, '8080-8880'], 'override-destination': true },
      TLS: { ports: [443, 8443] },
      QUIC: { ports: [443, 8443] },
    },
    // 这些域名嗅探反而会出问题：Apple 推送、微信、小米、向日葵、腾讯图片 CDN
    'skip-domain': [
      '+.push.apple.com',
      '+.apple.com',
      '+.wechat.com',
      '+.wechatapp.com',
      '+.qq.com',
      '+.qpic.cn',
      '+.oray.com',
      '+.sunlogin.net',
      'Mijia Cloud',
      'dlg.io.mi.com',
    ],
  };

  out['ntp'] = { enable: true, 'write-to-system': false, server: 'ntp.aliyun.com', port: 123, interval: 60 };

  if (options.启用TUN) {
    out['tun'] = {
      enable: true,
      stack: 'gvisor',
      'auto-route': true,
      'strict-route': true,
      'auto-redirect': true,
      'auto-detect-interface': true,
      'dns-hijack': ['any:53', 'tcp://any:53'],
      mtu: 1500,
    };
  }

  out['dns'] = dnsResult.dns;
  out['hosts'] = dnsResult.hosts;

  out['proxies'] = custom.concat(dnsResult.proxies, directProxies);
  out['proxy-groups'] = built.groups;
  out['rule-providers'] = built.providers;

  out['rules'] = customRules
    // 内网与明确的国内服务先直连
    .concat(cnDirectEarly.map((k) => `RULE-SET,${k},直连`))
    .concat(options.屏蔽国外QUIC ? [quicRule] : [])
    // 各分流组（TikTok 及字节海外域名在这一段里）
    .concat(built.rules)
    // 剩下的字节系、国内 CDN、B 站一律直连，必须排在分流之后
    .concat(cnDirectLate.map((k) => `RULE-SET,${k},直连`))
    // 兜底：国外域名走代理，国内域名与国内 IP 直连
    .concat([
      'RULE-SET,geolocation-!cn,默认代理',
      'RULE-SET,geolocation-cn,直连',
      'RULE-SET,cn_ip,直连',
      'RULE-SET,private_ip,直连',
      'MATCH,漏网之鱼',
    ]);

  return out;
}
