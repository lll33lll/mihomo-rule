/**
 * mihomo（Clash.Meta）订阅覆写脚本
 * ------------------------------------------------------------------
 * 分流规则 1:1 照搬 Lanlan13-14/Rules 的 configfull.yaml（规则集、规则顺序、
 * 策略组划分、DNS 结构都与之保持一致），只把节点相关的部分改成动态生成：
 * 地区组按订阅里实际有的节点生成，没有对应节点的地区不会出现。
 *
 * 用法：把本文件的 URL 填进客户端的「覆写 / Override / 脚本」处，对机场订阅启用。
 *       支持 mihomo 内核：FlClash、Bettbox、Clash Verge Rev、Mihomo Party 等。
 *
 * 致谢：规则与配置结构来自 Lanlan13-14/Rules，规则集来自 MetaCubeX/meta-rules-dat。
 */

// ==================================================================
//                          用户配置区
// ==================================================================

/** 地区组：按节点名匹配，匹配不到就不生成该组 */
const regions = [
  { name: '香港节点', flag: '🇭🇰', re: /🇭🇰|香港|港区|港區|(?<![A-Za-z])HKG?(?![A-Za-z])|hong\s*kong/i, icon: 'Hongkong' },
  {
    name: '日本节点',
    flag: '🇯🇵',
    re: /🇯🇵|日本|东京|東京|大阪|京都|埼玉|(?<![A-Za-z])JPN?(?![A-Za-z])|japan|tokyo|osaka/i,
    icon: 'Japan',
  },
  {
    name: '美国节点',
    flag: '🇺🇸',
    re: /🇺🇸|🇺🇲|美国|美國|纽约|紐約|洛杉矶|洛杉磯|旧金山|舊金山|硅谷|芝加哥|休斯顿|迈阿密|邁阿密|西雅图|西雅圖|波士顿|波士頓|华盛顿|華盛頓|拉斯维加斯|圣何塞|聖何塞|圣地亚哥|达拉斯|凤凰城|阿什本|(?<![A-Za-z])USA?(?![A-Za-z])|america|united\s*states|los\s*angeles|ashburn|kansas/i,
    icon: 'America',
  },
  { name: '新加坡节点', flag: '🇸🇬', re: /🇸🇬|新加坡|狮城|獅城|(?<![A-Za-z])SGP?(?![A-Za-z])|singapore/i, icon: 'Singapore' },
];

/** 没匹配到任何地区的节点归到这里 */
const otherRegionName = '其他节点';

/** 自建 / 家宽节点识别（匹配不到就不生成该组） */
const homeRe = /自建|家宽|家寬|(?<![A-Za-z])CF(?![A-Za-z])|home|hgc|hkt|hkbn|icable|hinet|(?<![A-Za-z])att(?![A-Za-z])/i;

/** 功能开关 */
const options = {
  地区自动选择组: true, // 每个地区生成一个 url-test 子组
  地区负载均衡组: true, // 每个地区生成一个 load-balance 子组
  隐藏地区手动组: false, // 只用自动选择时可设 true
  分流组平铺节点: false, // 每个分流组里都能直接点到单个节点（组会变长）
  过滤假节点: true, // 剔除机场塞进节点列表的广告 / 到期提示
  节点强制UDP: true, // 给订阅节点补 udp: true
  启用TUN: true, // 路由器 / OpenWrt 透明代理场景设为 false
  启用IPv6: true,
  进程匹配: true, // 关掉省电，但按进程分流的规则会失效
  DNS监听: false, // 是否让内核自己监听 1053 端口做 DNS 服务（部分客户端会冲突，默认关）
  测速域名走国内DNS: true, // 保险开关：测速地址的解析不经代理，避免所有节点一起超时
};

/** 想额外直连/代理的域名写这里，会插在所有规则最前面 */
const customRules = [
  // 'DOMAIN-SUFFIX,example.com,全球直连',
  // 'DOMAIN-SUFFIX,example.org,节点选择',
];

/** 自建节点：填了会并入「自建/家宽节点」组，不参与假节点过滤 */
const customProxies = [
  // { name: '自建-日本', type: 'vless', server: '1.2.3.4', port: 443, uuid: 'xxx', tls: true, servername: 'a.com' },
];

/** 假节点识别正则 */
const junkRe =
  /群|返利|循环|官网|客服|网站|网址|获取|订阅|流量|到期|机场|下次|版本|官址|备用|过期|已用|联系|邮箱|工单|贩卖|通知|倒卖|防止|地址|频道|电报|无法|说明|提示|特别|访问|支持|教程|关注|更新|作者|加入|超时|收藏|优惠|福利|邀请|好友|失联|剩余|公益|发布|通路|登录|禁止|定时|渠道|牢记|永久|余额|阁下|本站|刷新|导航|建议|重置|以下|拒绝|⚠️|@|t\.me\/\+|\bexpire\b|\bhttps?:\/\/|\.com|\btraffic\b|\bused?\b|\btotal\b|\bpanel\b|\bchannel\b/i;

// ==================================================================
//                        以下一般不用改
// ==================================================================

/**
 * 规则集与图标的下载前缀。国内直连拉不动时可换成加速镜像，例如：
 *   META = 'https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/'
 *   LAN  = 'https://fastly.jsdelivr.net/gh/Lanlan13-14/Rules@main/'
 */
const META = 'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/';
const LAN = 'https://raw.githubusercontent.com/Lanlan13-14/Rules/main/';

/** 连通性检测地址：HTTP 省一次 TLS 握手 */
const healthCheckUrl = 'http://www.gstatic.com/generate_204';
const healthCheckDomains = ['www.gstatic.com', 'cp.cloudflare.com', 'connectivitycheck.platform.hicloud.com'];

const icon = (n) => `${LAN}icon/${n}.png`;

/**
 * 规则集定义，与上游 configfull.yaml 一一对应。
 * 每项：[名称, 行为(d=domain / i=ipcidr), 前缀(M=meta-rules-dat / L=Lanlan), 路径]
 */
const providerDefs = [
  // --- 直连类 ---
  ['private_domain', 'd', 'M', 'geo/geosite/private.mrs'],
  ['cn_domain', 'd', 'M', 'geo/geosite/cn.mrs'],
  ['direct_domain', 'd', 'L', 'rules/Domain/direct.mrs'],
  ['bank_cn_domain', 'd', 'M', 'geo/geosite/category-bank-cn.mrs'],
  ['ai_cn_domain', 'd', 'M', 'geo/geosite/category-ai-cn.mrs'],
  ['alibaba_domain', 'd', 'M', 'geo/geosite/alibaba.mrs'],
  ['aliyun_domain', 'd', 'M', 'geo/geosite/aliyun.mrs'],
  ['115_domain', 'd', 'M', 'geo/geosite/115.mrs'],
  ['tencent_domain', 'd', 'M', 'geo/geosite/tencent.mrs'],
  ['tencent!cn_domain', 'd', 'M', 'geo/geosite/tencent%40!cn.mrs'],
  ['wechat_domain', 'd', 'L', 'rules/Domain/WeChat.mrs'],
  ['xiaomi_domain', 'd', 'M', 'geo/geosite/xiaomi.mrs'],
  ['iptv_domain', 'd', 'L', 'rules/Domain/iptv.mrs'],
  ['ifast_domain', 'd', 'M', 'geo/geosite/ifast.mrs'],
  ['game_cn_domain', 'd', 'M', 'geo/geosite/category-games%40cn.mrs'],
  ['steam_cn_domain', 'd', 'M', 'geo/geosite/steam%40cn.mrs'],
  ['steamcdn_domain', 'd', 'L', 'rules/Domain/Steam-domain.mrs'],
  ['NetEaseMusic_domain', 'd', 'L', 'rules/Domain/NetEaseMusic-domain.mrs'],
  ['apple_cn_domain', 'd', 'M', 'geo/geosite/apple%40cn.mrs'],
  ['media_cn_domain', 'd', 'M', 'geo/geosite/category-media-cn.mrs'],
  ['fakeip_filter_domain', 'd', 'L', 'rules/Domain/fakeip-filter.mrs'],

  // --- 广告 ---
  ['banAd_domain', 'd', 'L', 'rules/Domain/banAd_mini.mrs'],

  // --- 代理类 ---
  ['proxy_domain', 'd', 'L', 'rules/Domain/proxy.mrs'],
  ['gfw_domain', 'd', 'M', 'geo/geosite/gfw.mrs'],
  ['geolocation-!cn', 'd', 'M', 'geo/geosite/geolocation-!cn.mrs'],
  ['Cloudflare_domain', 'd', 'M', 'geo/geosite/cloudflare.mrs'],
  ['pikpak_domain', 'd', 'M', 'geo/geosite/pikpak.mrs'],
  ['speedtest_domain', 'd', 'M', 'geo/geosite/ookla-speedtest.mrs'],
  ['Wise_domain', 'd', 'M', 'geo/geosite/wise.mrs'],
  ['paypal_domain', 'd', 'M', 'geo/geosite/paypal.mrs'],

  // --- 哔哩哔哩 / 巴哈姆特 ---
  ['bilibili_domain', 'd', 'M', 'geo/geosite/bilibili.mrs'],
  ['biliintl_domain', 'd', 'M', 'geo/geosite/bilibili%40!cn.mrs'],
  ['bahamut_domain', 'd', 'M', 'geo/geosite/bahamut.mrs'],

  // --- Google 系 ---
  ['github_domain', 'd', 'M', 'geo/geosite/github.mrs'],
  ['gitbook_domain', 'd', 'M', 'geo/geosite/gitbook.mrs'],
  ['googlevpn_domain', 'd', 'L', 'rules/Domain/googleVPN.mrs'],
  ['youtube_domain', 'd', 'M', 'geo/geosite/youtube.mrs'],
  ['fcm_domain', 'd', 'M', 'geo/geosite/googlefcm.mrs'],
  ['google_domain', 'd', 'L', 'rules/Domain/google.mrs'],

  // --- 微软 ---
  ['onedrive_domain', 'd', 'M', 'geo/geosite/onedrive.mrs'],
  ['microsoft_domain', 'd', 'M', 'geo/geosite/microsoft.mrs'],

  // --- AI ---
  ['ai!cn_domain', 'd', 'M', 'geo/geosite/category-ai-!cn.mrs'],
  ['ai_domain', 'd', 'L', 'rules/Domain/ai.mrs'],
  ['openai_domain', 'd', 'M', 'geo/geosite/openai.mrs'],

  // --- 通讯 ---
  ['telegram_domain', 'd', 'M', 'geo/geosite/telegram.mrs'],
  ['line_domain', 'd', 'M', 'geo/geosite/line.mrs'],
  ['talkatone_domain', 'd', 'L', 'rules/Domain/Talkatone-domain.mrs'],
  ['discord_domain', 'd', 'M', 'geo/geosite/discord.mrs'],
  ['signal_domain', 'd', 'M', 'geo/geosite/signal.mrs'],

  // --- 苹果 ---
  ['appleTV_domain', 'd', 'L', 'rules/Domain/appletv.mrs'],
  ['apple_firmware_domain', 'd', 'L', 'rules/Domain/applefirmware.mrs'],
  ['apple_domain', 'd', 'M', 'geo/geosite/apple.mrs'],

  // --- 流媒体 ---
  ['tiktok_domain', 'd', 'M', 'geo/geosite/tiktok.mrs'],
  ['netflix_domain', 'd', 'M', 'geo/geosite/netflix.mrs'],
  ['disney_domain', 'd', 'M', 'geo/geosite/disney.mrs'],
  ['hbo_domain', 'd', 'M', 'geo/geosite/hbo.mrs'],
  ['primevideo_domain', 'd', 'M', 'geo/geosite/primevideo.mrs'],
  ['emby_domain', 'd', 'L', 'rules/Domain/emby.mrs'],
  ['spotify_domain', 'd', 'M', 'geo/geosite/spotify.mrs'],
  ['twitch_domain', 'd', 'M', 'geo/geosite/twitch.mrs'],
  ['porn_domain', 'd', 'M', 'geo/geosite/category-porn.mrs'],
  ['TVB_domain', 'd', 'L', 'rules/Domain/tvb.mrs'],
  ['media!cn_domain', 'd', 'M', 'geo/geosite/category-social-media-!cn.mrs'],

  // --- Meta ---
  ['facebook_domain', 'd', 'M', 'geo/geosite/facebook.mrs'],
  ['whatsapp_domain', 'd', 'M', 'geo/geosite/whatsapp.mrs'],
  ['instagram_domain', 'd', 'M', 'geo/geosite/instagram.mrs'],
  ['threads_domain', 'd', 'M', 'geo/geosite/threads.mrs'],
  ['meta_domain', 'd', 'M', 'geo/geosite/meta.mrs'],

  // --- 游戏 ---
  ['steam_domain', 'd', 'M', 'geo/geosite/steam.mrs'],
  ['Epic_domain', 'd', 'M', 'geo/geosite/epicgames.mrs'],
  ['EA_domain', 'd', 'M', 'geo/geosite/ea.mrs'],
  ['Blizzard_domain', 'd', 'M', 'geo/geosite/blizzard.mrs'],
  ['UBI_domain', 'd', 'L', 'rules/Domain/ubi.mrs'],
  ['Sony_domain', 'd', 'M', 'geo/geosite/sony.mrs'],
  ['Nintendo_domain', 'd', 'M', 'geo/geosite/nintendo.mrs'],

  // --- 电商 ---
  ['Amazon_domain', 'd', 'M', 'geo/geosite/amazon.mrs'],
  ['Shopee_domain', 'd', 'M', 'geo/geosite/shopee.mrs'],
  ['Shopify_domain', 'd', 'M', 'geo/geosite/shopify.mrs'],
  ['ebay_domain', 'd', 'M', 'geo/geosite/ebay.mrs'],

  // --- IP 类 ---
  ['private_ip', 'i', 'M', 'geo/geoip/private.mrs'],
  ['cn_ip', 'i', 'M', 'geo/geoip/cn.mrs'],
  ['bilibili_ip', 'i', 'M', 'geo-lite/geoip/bilibili.mrs'],
  ['google_ip', 'i', 'M', 'geo/geoip/google.mrs'],
  ['telegram_ip', 'i', 'M', 'geo/geoip/telegram.mrs'],
  ['netflix_ip', 'i', 'M', 'geo/geoip/netflix.mrs'],
  ['facebook_ip', 'i', 'M', 'geo/geoip/facebook.mrs'],
  ['twitter_ip', 'i', 'M', 'geo/geoip/twitter.mrs'],
  ['Amazon_ip', 'i', 'L', 'rules/IP/amazon-ip.mrs'],
  ['talkatone_ip', 'i', 'L', 'rules/IP/Talkatone-ip.mrs'],
  ['steamcdn_ip', 'i', 'L', 'rules/IP/steamCDN-ip.mrs'],
  ['NetEaseMusic_ip', 'i', 'L', 'rules/IP/NetEaseMusic-ip.mrs'],
  ['emby_ip', 'i', 'L', 'rules/IP/emby-ip.mrs'],
  ['google_asn_cn', 'i', 'L', 'rules/IP/AS24424.mrs'],
  ['discord_asn', 'i', 'L', 'rules/IP/AS49544.mrs'],
];

/**
 * 路由规则，顺序与上游 configfull.yaml 完全一致。
 */
const ruleList = [
  'RULE-SET,banAd_domain,隐私拦截',
  'RULE-SET,wechat_domain,全球直连',
  'RULE-SET,pikpak_domain,节点选择',
  'RULE-SET,speedtest_domain,Speedtest',
  'RULE-SET,Cloudflare_domain,节点选择',
  'RULE-SET,Wise_domain,Wise',
  'RULE-SET,paypal_domain,PayPal',
  'RULE-SET,proxy_domain,节点选择',
  'RULE-SET,biliintl_domain,哔哩东南亚',
  'RULE-SET,bilibili_domain,哔哩哔哩',
  'RULE-SET,bilibili_ip,哔哩哔哩,no-resolve',
  'RULE-SET,bahamut_domain,巴哈姆特',
  'RULE-SET,bank_cn_domain,全球直连',
  'RULE-SET,ai_cn_domain,全球直连',
  'RULE-SET,direct_domain,全球直连',
  'RULE-SET,alibaba_domain,全球直连',
  'RULE-SET,115_domain,全球直连',
  'RULE-SET,aliyun_domain,全球直连',
  'RULE-SET,github_domain,GitHub',
  'RULE-SET,gitbook_domain,GitHub',
  'RULE-SET,googlevpn_domain,GoogleVPN',
  'RULE-SET,youtube_domain,YouTube',
  'RULE-SET,fcm_domain,FCM',
  'RULE-SET,google_domain,Google',
  'RULE-SET,google_asn_cn,Google,no-resolve',
  'RULE-SET,google_ip,Google,no-resolve',
  'RULE-SET,onedrive_domain,OneDrive',
  'RULE-SET,microsoft_domain,Microsoft',
  'RULE-SET,ai!cn_domain,AI',
  'RULE-SET,ai_domain,AI',
  'RULE-SET,openai_domain,AI',
  'RULE-SET,telegram_domain,Telegram',
  'RULE-SET,telegram_ip,Telegram,no-resolve',
  'RULE-SET,line_domain,LINE',
  'RULE-SET,talkatone_domain,Talkatone',
  'RULE-SET,talkatone_ip,Talkatone,no-resolve',
  'RULE-SET,discord_domain,Discord',
  'RULE-SET,discord_asn,Discord,no-resolve',
  'RULE-SET,signal_domain,Signal',
  'RULE-SET,tencent!cn_domain,节点选择',
  'RULE-SET,tencent_domain,全球直连',
  'RULE-SET,iptv_domain,全球直连',
  'RULE-SET,private_domain,全球直连',
  'DOMAIN-KEYWORD,hk.tv.global.mi.com,节点选择',
  'RULE-SET,xiaomi_domain,全球直连',
  'RULE-SET,steam_cn_domain,全球直连',
  'RULE-SET,steamcdn_domain,全球直连',
  'RULE-SET,steamcdn_ip,全球直连,no-resolve',
  'RULE-SET,NetEaseMusic_domain,全球直连',
  'RULE-SET,NetEaseMusic_ip,全球直连,no-resolve',
  'RULE-SET,media_cn_domain,国内媒体',
  'RULE-SET,appleTV_domain,AppleTV',
  'RULE-SET,apple_cn_domain,全球直连',
  'RULE-SET,apple_firmware_domain,Apple',
  'RULE-SET,apple_domain,Apple',
  'RULE-SET,tiktok_domain,TikTok',
  'RULE-SET,netflix_domain,NETFLIX',
  'RULE-SET,netflix_ip,NETFLIX,no-resolve',
  'RULE-SET,disney_domain,DisneyPlus',
  'RULE-SET,hbo_domain,HBO',
  'RULE-SET,primevideo_domain,Primevideo',
  'RULE-SET,emby_domain,Emby',
  'RULE-SET,emby_ip,Emby,no-resolve',
  'RULE-SET,spotify_domain,Spotify',
  'RULE-SET,facebook_domain,Meta',
  'RULE-SET,whatsapp_domain,Meta',
  'RULE-SET,instagram_domain,Meta',
  'RULE-SET,threads_domain,Meta',
  'RULE-SET,meta_domain,Meta',
  'RULE-SET,facebook_ip,Meta,no-resolve',
  'DOMAIN-SUFFIX,mytvsuper.com,Global-TV',
  'DOMAIN-SUFFIX,mytv.com.hk,Global-TV',
  'RULE-SET,twitch_domain,Global-TV',
  'RULE-SET,porn_domain,Global-TV',
  'RULE-SET,TVB_domain,Global-TV',
  'RULE-SET,media!cn_domain,Global-Medial',
  'RULE-SET,twitter_ip,节点选择,no-resolve',
  'RULE-SET,steam_domain,STEAM',
  'RULE-SET,Epic_domain,游戏平台',
  'RULE-SET,EA_domain,游戏平台',
  'RULE-SET,Blizzard_domain,游戏平台',
  'RULE-SET,UBI_domain,游戏平台',
  'RULE-SET,Sony_domain,游戏平台',
  'RULE-SET,Nintendo_domain,游戏平台',
  'RULE-SET,ifast_domain,全球直连',
  'RULE-SET,Amazon_domain,国外电商',
  'RULE-SET,Amazon_ip,国外电商,no-resolve',
  'RULE-SET,Shopee_domain,国外电商',
  'RULE-SET,Shopify_domain,国外电商',
  'RULE-SET,ebay_domain,国外电商',
  'RULE-SET,gfw_domain,节点选择',
  'RULE-SET,geolocation-!cn,节点选择',
  'RULE-SET,cn_domain,全球直连',
  'RULE-SET,private_ip,全球直连,no-resolve',
  'RULE-SET,cn_ip,全球直连,no-resolve',
  'MATCH,Final',
];

/** fake-ip 白名单用到的规则集，与上游一致 */
const fakeIpSets = [
  'fakeip_filter_domain',
  'game_cn_domain',
  'bank_cn_domain',
  'wechat_domain',
  'ai_cn_domain',
  'NetEaseMusic_domain',
  'fcm_domain',
  'alibaba_domain',
  'media_cn_domain',
  'xiaomi_domain',
  'steam_cn_domain',
  '115_domain',
  'aliyun_domain',
  'direct_domain',
  'apple_cn_domain',
  'apple_firmware_domain',
  'iptv_domain',
  'private_domain',
  'cn_domain',
];

/**
 * 分流策略组，与上游 configfull.yaml 的划分一致。
 *   tpl: 'proxy'  代理优先（对应上游 Proxy_first）
 *        'direct' 直连优先（对应上游 Direct_first）
 *        'all'    代理优先，且把全部节点平铺进组（对应上游 Include_all）
 *   fixed: 固定成员，用它就不走模板
 *   prefer: 存在时提到成员列表最前面
 */
const groupDefs = [
  { name: 'YouTube', tpl: 'proxy', icon: 'youtube' },
  { name: 'FCM', tpl: 'proxy', icon: 'fcm' },
  { name: 'GoogleVPN', tpl: 'proxy', icon: 'googlevpn' },
  { name: 'Google', tpl: 'proxy', icon: 'google' },
  { name: 'Meta', tpl: 'proxy', icon: 'meta' },
  { name: 'AI', tpl: 'all', icon: 'ai' },
  { name: 'GitHub', tpl: 'proxy', icon: 'github' },
  { name: 'OneDrive', tpl: 'proxy', icon: 'onedrive' },
  { name: 'Microsoft', tpl: 'proxy', icon: 'microsoft' },
  { name: 'Telegram', tpl: 'proxy', icon: 'telegram' },
  { name: 'Discord', tpl: 'proxy', icon: 'discord' },
  { name: 'Talkatone', tpl: 'proxy', icon: 'talkatone' },
  { name: 'LINE', tpl: 'proxy', icon: 'line' },
  { name: 'Signal', tpl: 'proxy', icon: 'signal' },
  { name: 'TikTok', tpl: 'proxy', icon: 'tiktok' },
  { name: 'NETFLIX', tpl: 'proxy', icon: 'netflix' },
  { name: 'DisneyPlus', tpl: 'proxy', icon: 'disney' },
  { name: 'HBO', tpl: 'proxy', icon: 'hbo' },
  { name: 'Primevideo', tpl: 'proxy', icon: 'primevideo' },
  { name: 'AppleTV', tpl: 'proxy', icon: 'appletv' },
  { name: 'Apple', tpl: 'direct', icon: 'apple' },
  { name: 'Emby', tpl: 'all', icon: 'emby' },
  { name: '哔哩哔哩', tpl: 'direct', icon: 'bilibili' },
  { name: '哔哩东南亚', tpl: 'proxy', prefer: ['新加坡节点'], icon: 'bilibilit' },
  { name: '巴哈姆特', tpl: 'proxy', prefer: ['台湾节点', '香港节点'], icon: 'bahamut' },
  { name: 'Spotify', tpl: 'proxy', icon: 'spotify' },
  { name: '国内媒体', tpl: 'direct', icon: 'Chinese_media' },
  { name: 'Global-TV', tpl: 'all', icon: 'global_tv' },
  { name: 'Global-Medial', tpl: 'all', icon: 'global_media' },
  { name: '游戏平台', tpl: 'proxy', icon: 'game' },
  { name: 'Speedtest', tpl: 'all', icon: 'speedtest' },
  { name: 'PayPal', tpl: 'proxy', icon: 'paypal' },
  { name: 'Wise', tpl: 'proxy', icon: 'wise' },
  { name: '国外电商', tpl: 'proxy', icon: 'shopping' },
  { name: 'STEAM', tpl: 'all', icon: 'steam' },
  { name: '全球直连', fixed: ['🟢 直连', '🔗 代理', '全部节点'], icon: 'direct' },
  { name: '隐私拦截', fixed: ['🚫 拒绝', '⚪ 丢弃', '🟢 直连', '🔗 代理'], icon: 'block' },
  { name: 'Final', tpl: 'all', icon: 'final' },
];

/** 内置直连节点 */
const directProxies = [{ name: '🟢 直连', type: 'direct', udp: true }];

/** 策略组公共参数 */
const groupBase = { url: healthCheckUrl, interval: 300, timeout: 5000, lazy: true, 'max-failed-times': 5 };
const selectBase = Object.assign({}, groupBase, { type: 'select' });
const urlTestBase = Object.assign({}, groupBase, {
  type: 'url-test',
  tolerance: 20,
  'exclude-type': 'DIRECT',
  hidden: true,
});
const balanceBase = Object.assign({}, groupBase, {
  type: 'load-balance',
  strategy: 'consistent-hashing',
  'exclude-type': 'DIRECT',
  hidden: true,
  icon: icon('load-balance'),
});

// ==================================================================
//                          工具函数
// ==================================================================

const regionCache = new Map();
/** 取节点名匹配到的地区（带缓存） */
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

/**
 * 过滤 + 标准化订阅节点：剔除内置类型与假节点、补国旗、去重、补 udp、
 * 修掉 dialer-proxy 的悬空引用
 */
function prepareProxies(config) {
  regionCache.clear();
  const src = Array.isArray(config.proxies) ? config.proxies : [];

  const kept = src.filter((p) => {
    if (!p || typeof p.name !== 'string') return false;
    const t = String(p.type || '').toLowerCase();
    if (t === 'direct' || t === 'reject' || t === 'reject-drop' || t === 'pass' || t === 'rematch') return false;
    if (!options.过滤假节点) return true;
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

  const finalList = out.map((p) => {
    let next = p;
    const dialer = p['dialer-proxy'];
    if (dialer) {
      if (renamed.has(dialer)) next = Object.assign({}, next, { 'dialer-proxy': renamed.get(dialer) });
      else if (!seen.has(dialer)) {
        next = Object.assign({}, next);
        delete next['dialer-proxy'];
      }
    }
    if (options.节点强制UDP && next.udp !== true) next = Object.assign({}, next, { udp: true });
    return next;
  });

  if (!finalList.length) {
    throw new Error('订阅里没有可用节点，请确认这份配置来自机场，而不是手写配置');
  }
  return finalList;
}

const ipv4Re = /^\d{1,3}(\.\d{1,3}){3}$/;
function isIp(v) {
  const s = String(v || '').trim();
  return ipv4Re.test(s) || s.indexOf(':') >= 0;
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

/** 常见公共 DNS，用来识别机场自带的私有 DNS */
const publicDnsRe =
  /^(system|dhcp|223\.5\.5\.5|223\.6\.6\.6|119\.29\.29\.29|180\.184\.1\.1|182\.254\.11[68]\.118|114\.114\.114\.114|1\.12\.12\.12|120\.53\.53\.53|180\.76\.76\.76|117\.50\.\d+\.\d+|8\.8\.[84]\.[84]|1\.1\.1\.1|1\.0\.0\.1|9\.9\.9\.\d+|149\.112\.112\.112|208\.67\.22[02]\.22[02]|94\.140\.1[45]\.1[45]|dns\.(google|alidns\.com|quad9\.net|adguard\.com|sb|twnic\.tw|cloudflare\.com)|(cloudflare|adguard|opendns|mozilla\.cloudflare)-dns\.com|doh\.(pub|dns\.sb|opendns\.com)|.*\.doh\.pub)$/i;

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

function stripPolicy(entry) {
  const s = String(entry || '').trim();
  const hash = s.indexOf('#');
  return (hash >= 0 ? s.slice(0, hash) : s).trim();
}

function isPublicDns(entry) {
  return publicDnsRe.test(dnsHost(entry));
}

// ==================================================================
//                          策略组构建
// ==================================================================

/** 生成一个地区组：手动选择 + 隐藏的自动/均衡子组 */
function makeRegionGroup(region, members) {
  const groups = [];
  const subs = [];
  if (options.地区自动选择组) {
    const autoName = `${region.name}自动`;
    subs.push(autoName);
    groups.push(Object.assign({}, urlTestBase, { name: autoName, icon: icon(region.icon), proxies: members.slice() }));
  }
  if (options.地区负载均衡组) {
    const lbName = `${region.name}均衡`;
    subs.push(lbName);
    groups.push(Object.assign({}, balanceBase, { name: lbName, proxies: members.slice() }));
  }
  groups.push(
    Object.assign({}, selectBase, {
      name: region.name,
      icon: icon(region.icon),
      proxies: subs.concat(members),
      hidden: !!options.隐藏地区手动组,
    }),
  );
  return groups;
}

/** 自建节点重名时加前缀 */
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

function buildGroups(proxies, custom) {
  const customNames = custom.map((p) => p.name);
  const allNames = customNames.concat(proxies.map((p) => p.name));

  // --- 地区归类 ---
  const buckets = {};
  for (const r of regions) buckets[r.name] = [];
  const others = [];
  for (const name of allNames) {
    const hit = matchRegions(name);
    if (hit.length) for (const r of hit) buckets[r.name].push(name);
    else others.push(name);
  }

  const regionGroups = [];
  for (const r of regions) {
    if (!buckets[r.name].length) continue;
    regionGroups.push.apply(regionGroups, makeRegionGroup(r, buckets[r.name]));
  }
  if (others.length) {
    regionGroups.push.apply(regionGroups, makeRegionGroup({ name: otherRegionName, icon: 'all', re: null }, others));
  }
  const regionSelects = regionGroups.filter((g) => g.type === 'select').map((g) => g.name);

  // --- 自建 / 家宽 ---
  const homeNames = customNames.concat(proxies.filter((p) => homeRe.test(p.name)).map((p) => p.name));
  const homeGroup = homeNames.length
    ? Object.assign({}, selectBase, {
        name: '自建/家宽节点',
        icon: icon('private_node'),
        proxies: homeNames.slice(),
      })
    : null;
  const homeName = homeGroup ? ['自建/家宽节点'] : [];

  // --- 全部节点 / 故障转移 ---
  const allGroup = Object.assign({}, selectBase, {
    name: '全部节点',
    icon: icon('all'),
    proxies: allNames.slice(),
  });
  const fallbackGroup = Object.assign({}, groupBase, {
    type: 'fallback',
    name: '故障转移',
    icon: icon('fallback'),
    'exclude-type': 'DIRECT',
    proxies: allNames.slice(),
  });

  // --- 节点选择：所有分流组的上游 ---
  const mainGroup = Object.assign({}, selectBase, {
    name: '节点选择',
    icon: icon('select'),
    proxies: regionSelects.concat(['全部节点'], homeName, ['故障转移']),
  });

  // --- 三种成员模板 ---
  const proxyFirst = ['节点选择'].concat(regionSelects, ['全部节点'], homeName, ['全球直连']);
  const directFirst = ['全球直连', '节点选择'].concat(regionSelects, ['全部节点'], homeName);

  const serviceGroups = [];
  for (const def of groupDefs) {
    let members;
    if (def.fixed) {
      members = def.fixed.slice();
    } else {
      const base = def.tpl === 'direct' ? directFirst : proxyFirst;
      members = base.slice();
      if (def.tpl === 'all' && !options.分流组平铺节点) {
        // 上游这几个组是 include-all，这里等价成把全部节点接在后面
        members = members.concat(allNames);
      }
      // 首选地区（例如巴哈姆特优先台湾）存在时提到最前
      if (def.prefer) {
        for (let i = def.prefer.length - 1; i >= 0; i--) {
          const p = def.prefer[i];
          const at = members.indexOf(p);
          if (at > 0) {
            members.splice(at, 1);
            members.unshift(p);
          }
        }
      }
    }
    if (options.分流组平铺节点 && !def.fixed) members = members.concat(allNames);
    serviceGroups.push(Object.assign({}, selectBase, { name: def.name, icon: icon(def.icon), proxies: members }));
  }

  // --- 隐藏的功能组，供「全球直连」「隐私拦截」引用 ---
  const utilGroups = [
    Object.assign({}, selectBase, { name: '🔗 代理', hidden: true, proxies: ['节点选择'] }),
    Object.assign({}, selectBase, { name: '🚫 拒绝', hidden: true, proxies: ['REJECT'] }),
    Object.assign({}, selectBase, { name: '⚪ 丢弃', hidden: true, proxies: ['REJECT-DROP'] }),
  ];

  const ordered = [mainGroup].concat(
    serviceGroups,
    utilGroups,
    homeGroup ? [homeGroup] : [],
    regionGroups,
    [allGroup, fallbackGroup],
  );

  const globalGroup = Object.assign({}, selectBase, {
    name: 'GLOBAL',
    icon: icon('global'),
    proxies: ordered.map((g) => g.name),
  });

  return { groups: [globalGroup].concat(ordered), regionSelects };
}

// ==================================================================
//                          DNS
// ==================================================================

/**
 * DNS 结构照搬上游：国内域名与节点域名交给国内 DNS，其余走国外 DoH，
 * 并用 respect-rules 让 DNS 查询本身也遵循路由规则。
 *
 * 额外加了一条保险：测速地址的域名固定用国内明文 DNS 解析。否则
 * 「测速要先解析域名、解析要先有可用代理、代理可用与否又要靠这次测速」
 * 会互相锁死，表现就是所有节点一起超时。
 */
function buildDns(config, proxies) {
  const orig = config.dns && typeof config.dns === 'object' ? config.dns : {};

  const proxyDomains = [];
  for (const p of proxies) {
    if (typeof p.server === 'string' && !isIp(p.server)) {
      const d = p.server.toLowerCase();
      if (proxyDomains.indexOf(d) < 0) proxyDomains.push(d);
    }
  }

  // 机场自带的私有 DNS：可能是解析节点域名的唯一途径；指向本机的那种覆写后已失效
  const privateDns = [];
  for (const entry of (orig['proxy-server-nameserver'] || []).concat(orig.nameserver || [])) {
    if (isPublicDns(entry)) continue;
    const host = dnsHost(entry);
    if (!host || /^(127\.|0\.0\.0\.0$|::1$|localhost$)/.test(host)) continue;
    const clean = stripPolicy(entry);
    if (clean && privateDns.indexOf(clean) < 0) privateDns.push(clean);
  }

  const proxyPolicy = {};
  const origPolicies = Object.assign({}, orig['nameserver-policy'], orig['proxy-server-nameserver-policy']);
  for (const key of Object.keys(origPolicies)) {
    if (!proxyDomains.some((d) => hostMatch(key, d) || key.toLowerCase() === d)) continue;
    const cleaned = (Array.isArray(origPolicies[key]) ? origPolicies[key] : [origPolicies[key]])
      .map(stripPolicy)
      .filter((v) => !!v);
    if (cleaned.length) proxyPolicy[key] = cleaned;
  }
  if (privateDns.length && !Object.keys(proxyPolicy).length) {
    for (const d of proxyDomains) proxyPolicy[d] = privateDns;
  }

  const dns = {
    enable: true,
    ipv6: options.启用IPv6,
    'prefer-h3': false,
    'respect-rules': true,
    'enhanced-mode': 'fake-ip',
    'fake-ip-range': '28.0.0.1/8',
    'fake-ip-filter-mode': 'blacklist',
    'fake-ip-filter': [`rule-set:${fakeIpSets.join(',')}`, '+.lan', '+.local'].concat(proxyDomains),
    'default-nameserver': ['119.29.29.29', '223.5.5.5'],
    // 节点域名与直连域名都用明文国内 DNS，并拿系统 DNS 兜底：
    // DoH 首次连接慢、被干扰时会直接表现成「所有节点超时」
    'proxy-server-nameserver': ['223.5.5.5', '119.29.29.29', 'system'],
    'direct-nameserver': ['system', '223.5.5.5', '119.29.29.29'],
    nameserver: ['https://dns.google/dns-query', 'https://dns.cloudflare.com/dns-query'],
  };
  if (options.启用IPv6) dns['fake-ip-range6'] = '2001:480:abcd::1/64';
  if (options.DNS监听) dns.listen = '0.0.0.0:1053';
  if (options.测速域名走国内DNS) {
    dns['nameserver-policy'] = { [healthCheckDomains.join(',')]: ['223.5.5.5', '119.29.29.29'] };
  }
  if (Object.keys(proxyPolicy).length) dns['proxy-server-nameserver-policy'] = proxyPolicy;

  const hosts = {
    // 固定住国外 DoH 的 IP，省掉「解析 DNS 服务器域名」这一步
    'dns.google': ['8.8.8.8', '8.8.4.4'],
    'dns.cloudflare.com': ['1.1.1.1', '1.0.0.1'],
    'services.googleapis.cn': 'services.googleapis.com',
    // 掐掉 B 站 PCDN，解决看视频/直播卡顿和上传占满带宽
    '+.mcdn.bilivideo.com': ['0.0.0.0'],
    '+.mcdn.bilivideo.cn': ['0.0.0.0'],
  };
  // 机场 hosts 里跟节点域名有关的条目保留下来，节点域名靠它解析
  if (config.hosts && typeof config.hosts === 'object') {
    for (const key of Object.keys(config.hosts)) {
      if (hosts[key] !== undefined) continue;
      if (proxyDomains.some((d) => hostMatch(key, d) || key.toLowerCase() === d)) hosts[key] = config.hosts[key];
    }
  }

  return { dns, hosts };
}

// ==================================================================
//                            主入口
// ==================================================================

function main(config) {
  const proxies = prepareProxies(config);
  const custom = prepareCustom(proxies.map((p) => p.name));
  const built = buildGroups(proxies, custom);
  const dnsResult = buildDns(config, proxies);

  const providers = {};
  for (const def of providerDefs) {
    const name = def[0];
    const behavior = def[1] === 'i' ? 'ipcidr' : 'domain';
    const base = def[2] === 'L' ? LAN : META;
    providers[name] = {
      type: 'http',
      format: 'mrs',
      behavior,
      interval: 86400,
      url: base + def[3],
      path: `./ruleset/${behavior === 'ipcidr' ? 'ip_' : ''}${name}.mrs`,
    };
  }

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
  out['geodata-mode'] = false;
  out['find-process-mode'] = options.进程匹配 ? 'strict' : 'off';
  // 只监听本机，避免控制接口暴露到局域网
  out['external-controller'] = '127.0.0.1:9090';
  out['external-ui'] = 'ui';
  out['external-ui-url'] = 'https://github.com/Zephyruso/zashboard/archive/refs/heads/gh-pages.zip';

  out['profile'] = { 'store-selected': true, 'store-fake-ip': true };

  out['ntp'] = { enable: true, 'write-to-system': false, server: 'ntp.aliyun.com', port: 123, interval: 60 };

  out['sniffer'] = {
    enable: true,
    sniff: {
      HTTP: { ports: [80, '8080-8880'], 'override-destination': true },
      TLS: { ports: [443, 8443] },
      QUIC: { ports: [443, 8443] },
    },
    'force-domain': ['+.v2ex.com'],
    'skip-domain': [
      'Mijia Cloud',
      'dlg.io.mi.com',
      '+.push.apple.com',
      '+.apple.com',
      '+.wechat.com',
      '+.wechatapp.com',
      '+.qq.com',
      '+.qpic.cn',
      '+.vivox.com',
      '+.oray.com',
      '+.sunlogin.net',
    ],
  };

  if (options.启用TUN) {
    out['tun'] = {
      enable: true,
      stack: 'gvisor',
      mtu: 9000,
      'auto-route': true,
      'auto-redirect': true,
      'auto-detect-interface': true,
      'dns-hijack': ['any:53', 'tcp://any:53'],
    };
  }

  out['dns'] = dnsResult.dns;
  out['hosts'] = dnsResult.hosts;

  out['proxies'] = custom.concat(proxies, directProxies);
  out['proxy-groups'] = built.groups;
  out['rule-providers'] = providers;
  out['rules'] = customRules.concat(ruleList);

  return out;
}
