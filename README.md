# mihomo 分流配置

给 mihomo（Clash.Meta）内核用的订阅覆写脚本 + 配置文件。地区组只保留香港 / 日本 / 美国 / 新加坡，20 个分流策略组，不含广告拦截。

## 快速开始

在客户端的「覆写 / Override / 脚本」里填这个地址，然后对订阅启用它：

```
https://raw.githubusercontent.com/lll33lll/mihomo-rule/main/Script/override.js
```

国内拉不动就换 jsDelivr（有几分钟缓存延迟）：

```
https://fastly.jsdelivr.net/gh/lll33lll/mihomo-rule@main/Script/override.js
```

支持 Bettbox、FlClash、Clash Verge Rev、Mihomo Party、Clash Meta for Android 等使用 mihomo 内核的客户端。

不想用脚本、只想要一份填完订阅就能跑的配置：用 [`Config/config.yaml`](Config/config.yaml)，把机场订阅链接填进开头 `proxy-providers` 的 `url` 即可。

> 覆写脚本是拿来覆写**机场订阅**的，别用它覆写自己手写的配置。

## 内置策略组

分流组（20 个）：

`AI` `YouTube` `Google` `FCM` `GitHub` `Telegram` `Twitter` `Instagram` `TikTok` `Netflix` `Disney+` `国际流媒体` `Spotify` `Emby` `PikPak` `Steam` `Microsoft` `Apple` `Crypto` `EHentai`

`国际流媒体` = HBO / Twitch / Prime Video / Hulu / Abema / 巴哈姆特 / niconico。

节点组：`默认代理` `手动选择` `自动选择` `负载均衡` `香港` `日本` `美国` `新加坡` `其他节点` `直连` `漏网之鱼`

地区组按节点名动态生成，机场没有某个地区的节点时该组不会出现，也不会留下悬空引用。每个地区另带一个隐藏的 `· 自动` 子组做延迟优选。

默认走直连的组：`FCM` `Apple`（选它们时组内第一项就是直连）。默认选美国的：`AI` `EHentai`；默认选日本的：`TikTok` `Crypto`。

## 改配置

脚本顶部的 `enableGroups` 和 `options` 就是全部开关，改完保存即生效：

| 开关 | 默认 | 说明 |
| --- | --- | --- |
| `enableGroups.*` | 多数 true | 某个分流组设 false 后，它的策略组、规则、规则集会一起消失，不留垃圾 |
| `成人内容` | false | 打开后 `category-porn` 单独走一个组 |
| `生成地区自动选择组` | true | 关掉则地区组只能手动点节点 |
| `隐藏地区手动选择组` | false | 只用自动选择时打开，界面更干净 |
| `分流组平铺全部节点` | false | 打开后每个分流组里能直接点到单个节点，组会变得很长 |
| `过滤非地区节点` | true | 剔除机场塞进节点列表的广告 / 到期提示 |
| `屏蔽国外QUIC` | true | 拦掉国外 UDP/443，强制 YouTube 等回落 TCP |
| `启用TUN` | true | **路由器 / OpenWrt 透明代理场景要改成 false** |
| `启用IPv6` | true | 没有 IPv6 出口时关掉，少一半无用的 AAAA 查询 |
| `进程匹配` | true | 关掉省电，但 Emby 按进程分流的规则会失效 |
| `代理IPv4优先` / `代理IPv6优先` | false | 只开一个才生效，同时开等于都不开 |

想加地区就往 `regions` 数组里加一项（名字、国旗、匹配正则、图标）；想加自建节点填 `customProxies`；想加几条自己的直连/代理规则填 `customRules`，它们会插在所有规则最前面。

## 关于 DNS

DNS 和路由规则是配套的，**不要再开客户端自带的「DNS 覆写」**，否则下面这套会被顶掉。

- 国外域名：只由 `cloudflare-dns.com` / `dns.google` 的 DoH 解析，且这两条被绑到 `默认代理`，解析请求跟着代理走，本地看不到查询内容
- 这两个 DoH 自己的域名在 `hosts` 里被写死成 IP，避免「解析 DNS 服务器要先解析 DNS 服务器」的死循环
- 国内域名：交给 `223.5.5.5` / `119.29.29.29`，直连不绕路
- 节点域名：用国内 DoH 且强制 `#DIRECT` 解析，不会绕回代理
- 内网、国内域名走 `fake-ip-filter` 真实解析，其余走 fake-ip

Windows 上还要额外做一件事：关掉系统的智能多宿主域名解析，或在客户端里开 [严格路由](https://wiki.metacubex.one/config/inbound/tun/#strict-route)，否则系统会绕过 mihomo 直接查询。

### 机场用私有 DNS / hosts 映射节点域名的情况

脚本会自动处理，不用手动复制 hosts：

1. 订阅 `hosts` 里能定死成 IP 的节点域名，直接写进节点的 `server`，彻底不依赖解析；如果是 TLS 节点还会自动把原域名补成 `servername`，不会丢 SNI
2. 定不死的（机场只给了私有 DNS），把私有 DNS 降级成 `proxy-server-nameserver-policy`，**只对节点域名生效**，不会污染其他域名的解析
3. 指向 `127.0.0.1` 之类本机地址的私有 DNS 会被丢掉——覆写之后本机并不会起那个 DNS 服务

## 规则集

全部使用 mrs 二进制格式，按需下载，比 geodata 省内存。来源 [appshubcc/bett-rules](https://github.com/appshubcc/bett-rules)（上游是 [MetaCubeX/meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat)）。

CDN 换源改脚本里的 `RULES_BASE` 一行即可，例如换成 `https://testingcf.jsdelivr.net/gh/appshubcc/bett-rules@meta`。

规则集下载走代理，但它的域名解析被单独指给了国内 DNS——不然会陷入「拉规则集要先解析域名、解析又要先有可用代理」的互等。

## 本地验证

```bash
node test/run.js          # 48 项自检：引用自洽、DNS 防泄露、开关、异常输入、QuickJS 语法兼容
node tools/gen-config.js  # 从脚本重新生成 Config/config.yaml
```

配置文件版由脚本生成，两份产物的规则集、策略组、规则完全一致。改完脚本记得重跑 `gen-config.js`（CI 也会自动跑并提交）。

两份产物都用 mihomo v1.19.30 内核 `-t` 校验通过，并实机跑过分流验证（YouTube→YouTube 组、chatgpt.com→AI 组、`www.apple.com`→直连、`apps.apple.com`→Apple 组等 26 个域名全部命中预期策略组）。

## 致谢

[AIsouler/MyClash](https://github.com/AIsouler/MyClash) · [dahaha-365/YaNet](https://github.com/dahaha-365/YaNet) · [MetaCubeX/meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat) · [appshubcc/bett-rules](https://github.com/appshubcc/bett-rules) · [Koolson/Qure](https://github.com/Koolson/Qure)（图标）
