# mihomo 分流配置

分流规则照搬 [Lanlan13-14/Rules](https://github.com/Lanlan13-14/Rules) 的 `configfull.yaml`，做成订阅覆写脚本；地区组改成按订阅里实际有的节点动态生成。

## 快速开始

在客户端的「覆写 / Override / 脚本」里填这个地址，然后对订阅启用它：

```
https://raw.githubusercontent.com/lll33lll/mihomo-rule/main/Script/override.js
```

国内拉不动就换 jsDelivr（有几分钟缓存延迟）：

```
https://fastly.jsdelivr.net/gh/lll33lll/mihomo-rule@main/Script/override.js
```

支持 FlClash、Bettbox、Clash Verge Rev、Mihomo Party、Clash Meta for Android 等使用 mihomo 内核的客户端。不想用脚本就用 [`Config/config.yaml`](Config/config.yaml)，把订阅链接填进开头 `proxy-providers` 的 `url` 即可。

> 覆写脚本是拿来覆写**机场订阅**的，别用它覆写自己手写的配置。

## 与上游的关系

以下三项与 `configfull.yaml` 完全一致，自检里会逐条比对：

- 94 个规则集（MetaCubeX/meta-rules-dat + 上游自维护的那几份）
- 96 条规则及其先后顺序
- 38 个分流策略组的划分与成员模板（代理优先 / 直连优先 / 平铺全部节点）

两处本地化改动：

1. **地区组动态生成**。上游用 `filter` 正则固定列了六个地区，这里改成按节点名匹配：只生成香港 / 日本 / 美国 / 新加坡 + 其他节点，机场没有某个地区的节点时该组不会出现，也不会留下指向空组的引用（例如巴哈姆特本来固定指台湾，台湾组不存在时自动回落香港）。
2. **测速与 DNS 防互锁**。测速地址用 `http://www.gstatic.com/generate_204` 且域名固定交给国内 DNS；节点域名与直连域名用明文国内 DNS 加 `system` 兜底。不这么做的话，一旦测速域名靠「国外 DoH 经代理」解析，就会变成测速等解析、解析等代理、代理等测速的死循环，表现是所有节点一起超时。

## 策略组

分流组（38 个）：

`YouTube` `FCM` `GoogleVPN` `Google` `Meta` `AI` `GitHub` `OneDrive` `Microsoft` `Telegram` `Discord` `Talkatone` `LINE` `Signal` `TikTok` `NETFLIX` `DisneyPlus` `HBO` `Primevideo` `AppleTV` `Apple` `Emby` `哔哩哔哩` `哔哩东南亚` `巴哈姆特` `Spotify` `国内媒体` `Global-TV` `Global-Medial` `游戏平台` `Speedtest` `PayPal` `Wise` `国外电商` `STEAM` `全球直连` `隐私拦截` `Final`

节点组：`节点选择`（所有分流组的上游）`香港节点` `日本节点` `美国节点` `新加坡节点` `其他节点` `自建/家宽节点` `全部节点` `故障转移`

每个地区另带两个隐藏子组：`××节点自动`（url-test 延迟优选）和 `××节点均衡`（load-balance，一致性哈希）。名字里带自建 / 家宽 / CF / HKT / Hinet 等关键词的节点会多归一份到「自建/家宽节点」，没有这类节点时该组不生成。

「隐私拦截」默认 REJECT，用的是上游的 `banAd_mini` 广告规则集；不想去广告就在客户端里把这个组切成「🟢 直连」。

## 改配置

脚本顶部的 `options` 就是全部开关：

| 开关 | 默认 | 说明 |
| --- | --- | --- |
| `地区自动选择组` / `地区负载均衡组` | true | 每个地区是否生成自动 / 均衡子组 |
| `隐藏地区手动组` | false | 只用自动选择时打开，界面更干净 |
| `分流组平铺节点` | false | 打开后所有分流组都能直接点到单个节点（组会很长） |
| `过滤假节点` | true | 剔除机场塞进节点列表的广告 / 到期提示 |
| `节点强制UDP` | true | 给漏写 `udp` 的节点补上，QUIC / 游戏 / 语音才正常 |
| `启用TUN` | true | **路由器 / OpenWrt 透明代理场景要改成 false** |
| `启用IPv6` | true | 没有 IPv6 出口时关掉 |
| `进程匹配` | true | 关掉省电，但按进程分流的规则会失效 |
| `DNS监听` | false | 打开后内核自己监听 1053 做 DNS 服务，部分客户端会冲突 |
| `测速域名走国内DNS` | true | 防测速与代理互锁，不建议关 |

想加地区就往 `regions` 数组里加一项（名字、国旗、匹配正则、图标）；添自建节点填 `customProxies`；自己的直连/代理规则填 `customRules`，会插在所有规则最前面，例如：

```js
const customRules = ['DOMAIN-SUFFIX,example.cn,全球直连', 'DOMAIN-SUFFIX,example.com,节点选择'];
```

规则集拉不动时把脚本里的 `META` 和 `LAN` 两行换成加速镜像：

```js
const META = 'https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/';
const LAN = 'https://fastly.jsdelivr.net/gh/Lanlan13-14/Rules@main/';
```

## 关于 DNS

DNS 和路由规则是配套的，**不要再开客户端自带的「DNS 覆写」**。

- 国外域名：`dns.google` / `dns.cloudflare.com` 的 DoH，配 `respect-rules` 让查询本身也走路由规则
- 这两个 DoH 域名在 `hosts` 里固定成 IP，省掉「解析 DNS 服务器」这一步
- 国内域名、节点域名、测速域名：`223.5.5.5` / `119.29.29.29`，另有 `system` 兜底
- fake-ip 采用 `28.0.0.1/8`，白名单照搬上游的 19 个国内规则集

机场靠私有 DNS 或 hosts 才能解析节点域名的情况会自动处理：hosts 里跟节点有关的条目原样保留（不改 `server`，不会丢 TLS 的 SNI），私有 DNS 降级成只对节点域名生效的 `proxy-server-nameserver-policy`，指向 `127.0.0.1` 的那种直接丢掉。

Windows 上还要关掉系统的智能多宙主域名解析，或在客户端里开 [严格路由](https://wiki.metacubex.one/config/inbound/tun/#strict-route)。

## 排查

**节点全部超时** → 确认客户端的 DNS 覆写是关的；确认 `测速域名走国内DNS` 为 `true`。

**某个国内站点走了代理** → 把它的域名后缀加进 `customRules` 指向 `全球直连`。

**某个国外站点走了直连** → 同理，指向 `节点选择`。

**首次启动拉不到规则集** → 换 `META` / `LAN` 为 jsDelivr 镜像。

**路由器上跑** → `启用TUN` 改 `false`。

## 本地验证

```bash
node test/run.js          # 58 项自检：规则逐条对齐上游、引用自洽、DNS、开关、QuickJS 兼容
node tools/gen-config.js  # 从脚本重新生成 Config/config.yaml
```

配置文件版由脚本生成（复用 `main()` 的产出，只把节点部分换成 `proxy-providers` + 正则过滤的地区组），CI 会自动跑自检 + mihomo 内核 `-t` 校验并提交结果。

两份产物都用 mihomo v1.19.30 验证过：94 个规则集全部能被内核加载，29 个域名的分流结果符合预期：`p3-sign.byteimg.com` / `douyinpic.com` / `douyinvod.com` / `aweme.snssdk.com` 走全球直连，B 站进哔哩哔哩组，`www.apple.com` 直连而 `apps.apple.com` 进 Apple 组，`x.com` 进 Global-Medial，淘宝 / 百度 / 网易云音乐 / QQ 全部直连。

## 致谢

[Lanlan13-14/Rules](https://github.com/Lanlan13-14/Rules)（规则与配置结构）· [MetaCubeX/meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat)（规则集）· [AIsouler/MyClash](https://github.com/AIsouler/MyClash) · [dahaha-365/YaNet](https://github.com/dahaha-365/YaNet)
