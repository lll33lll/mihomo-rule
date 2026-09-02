# mihomo 分流配置

给 mihomo（Clash.Meta）内核用的订阅覆写脚本 + 配置文件。地区组只保留香港 / 日本 / 美国 / 新加坡，20 个分流策略组，不含广告拦截。国内的走国内，国外的走国外。

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

节点组：`默认代理` `手动选择` `自动选择` `负载均衡` `故障转移` `香港` `日本` `美国` `新加坡` `其他节点` `直连` `漏网之鱼`

地区组按节点名动态生成，机场没有某个地区的节点时该组不会出现，也不会留下悬空引用。每个地区另带一个隐藏的 `· 自动` 子组做延迟优选。

默认走直连的组：`FCM` `Apple`。默认选美国的：`AI` `EHentai`；默认选日本的：`TikTok` `Crypto`。

## 国内分流

除了 `geolocation-cn` 和 `cn_ip` 两层兜底，还单独把下面这几类固定直连：拖音 / 字节系域名（`douyin`、`bytedance`）、国内 CDN 服务商（`category-cdn-cn`）、B 站（`bilibili`）、国内游戏 / 苹果 / 微软 / NVIDIA 的国内站点。

为什么要特殊处理：`geolocation-cn` 里 `byteimg.com` 只收了 juejin / novel 几个子域，而拖音图集的图片走的是 `p*-sign.byteimg.com`。它不在名单里，就会被兜底规则当成国外域名送去代理，而国内 CDN 不接海外 IP——表现就是视频能看、图集刷不出来。

字节的海外服务（CapCut、musical.ly、ibyteimg 等）跟 TikTok 一起走代理，规则排在国内直连之前，两者不会互相吃掉。

## 改配置

脚本顶部的 `enableGroups` 和 `options` 就是全部开关，改完保存即生效：

| 开关 | 默认 | 说明 |
| --- | --- | --- |
| `enableGroups.*` | 多数 true | 某个分流组设 false 后，它的策略组、规则、规则集会一起消失 |
| `成人内容` | false | 打开后 `category-porn` 单独走一个组 |
| `屏蔽国外QUIC` | **false** | 这条规则容易顺带拦掉国内 App 的 QUIC 图片/视频 CDN，所以默认关；开启时也已把国内规则集全部放行 |
| `节点域名用加密DNS` | false | 默认用明文国内 DNS 解析节点域名，最不容易连不上；要隐藏机场域名再打开 |
| `写死节点IP` | false | 把机场 hosts 里的映射直接写进节点 `server`。默认不改，只保留 hosts 条目，避免丢 TLS 的 SNI |
| `节点强制启用UDP` | true | 给漏写 `udp` 的订阅节点补上，QUIC / 游戏 / 语音才正常 |
| `启用TUN` | true | **路由器 / OpenWrt 透明代理场景要改成 false** |
| `启用IPv6` | true | 没有 IPv6 出口时关掉，少一半无用的 AAAA 查询 |
| `进程匹配` | true | 关掉省电，但 Emby 按进程分流的规则会失效 |
| `生成地区自动选择组` / `隐藏地区手动选择组` | true / false | 控制地区组的形态 |
| `分流组平铺全部节点` | false | 打开后每个分流组里能直接点到单个节点，组会很长 |
| `过滤非地区节点` | true | 剔除机场塞进节点列表的广告 / 到期提示 |
| `代理IPv4优先` / `代理IPv6优先` | false | 只开一个才生效，同时开等于都不开 |

想加地区就往 `regions` 数组里加一项（名字、国旗、匹配正则、图标）；想加自建节点填 `customProxies`；想加几条自己的直连/代理规则填 `customRules`，它们会插在所有规则最前面。

## 关于 DNS

DNS 和路由规则是配套的，**不要再开客户端自带的「DNS 覆写」**，否则下面这套会被顶掉。

- 国外域名：只由 `cloudflare-dns.com` / `dns.google` 的 DoH 解析，且这两条被绑到 `默认代理`，解析请求跟着代理走，本地看不到查询内容
- 这两个 DoH 自己的域名在 `hosts` 里被写死成 IP，避开「解析 DNS 服务器要先解析 DNS 服务器」的死循环
- 国内域名、国内 App：交给 `223.5.5.5` / `119.29.29.29`，直连不绕路
- 节点域名：默认用明文国内 DNS 解析（`proxy-server-nameserver`）
- **测速地址与规则集 CDN 的域名也固定走国内 DNS**：这两类域名如果靠「国外 DoH 经代理」解析，就会形成测速等解析、解析等代理、代理等测速的互锁

Windows 上还要额外做一件事：关掉系统的智能多宙主域名解析，或在客户端里开 [严格路由](https://wiki.metacubex.one/config/inbound/tun/#strict-route)。

### 机场用私有 DNS / hosts 映射节点域名的情况

脚本会自动处理，不用手动复制 hosts：

1. 机场 `hosts` 里跟节点有关的条目原样保留到输出配置，由 `use-hosts` 完成解析——域名不变，TLS 的 SNI 也不会丢
2. 机场只给了私有 DNS 时，把它降级成 `proxy-server-nameserver-policy`，**只对节点域名生效**，不污染其他域名的解析
3. 指向 `127.0.0.1` 之类本机地址的私有 DNS 会被丢掉——覆写之后本机并不会起那个 DNS 服务
4. 实在需要把节点写成 IP（部分机场依赖这个），把 `写死节点IP` 改成 `true`，脚本会按协议把原域名写到 `sni` 或 `servername`

## 排查

**所有订阅节点测延迟都超时，只有 IP 形式的自建节点能用？** 旧版本的测速地址靠国外 DoH 经代理解析，会和代理互锁。现在的版本已修；若仍有问题，依次试：把 `节点域名用加密DNS` 确认为 `false` → 如果机场靠 hosts 映射节点域名，把 `写死节点IP` 改成 `true` → 关掉客户端自带的 DNS 覆写。

**国内 App 的图片 / 视频加载不出来？** 先确认 `屏蔽国外QUIC` 是 `false`。如果是其他国内站点，把它的域名后缀加进 `customRules`，例如 `'DOMAIN-SUFFIX,example.cn,直连'`。

**首次启动拉不到规则集？** 把脚本里的 `RULES_BASE` 换成 `https://testingcf.jsdelivr.net/gh/appshubcc/bett-rules@meta` 或其他可达镜像。

**路由器上跑？** `启用TUN` 改 `false`，让路由器自己的透明代理接流量。

## 规则集

全部使用 mrs 二进制格式，按需下载，比 geodata 省内存。来源 [appshubcc/bett-rules](https://github.com/appshubcc/bett-rules)（上游是 [MetaCubeX/meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat)）。换源改脚本里的 `RULES_BASE` 一行即可。

## 本地验证

```bash
node test/run.js          # 60 项自检：引用自洽、DNS 防泄露与防互锁、国内分流顺序、开关、QuickJS 兼容
node tools/gen-config.js  # 从脚本重新生成 Config/config.yaml
```

配置文件版由脚本生成（直接复用 `main()` 的产出，只把节点相关部分换成 `proxy-providers` + 正则过滤的地区组），所以两份产物的 DNS、规则、规则集永远一致。CI 会自动跑自检 + mihomo 内核 `-t` 校验，并提交重新生成的 `Config/config.yaml`。

两份产物都用 mihomo v1.19.30 内核验证过：49 个规则集全部能被内核加载，实机分流结果也比对过——`p3-sign.byteimg.com` / `douyinpic.com` / B 站走直连，`www.capcut.com` 跟 TikTok 走代理，YouTube / chatgpt.com 进各自的组，`www.apple.com` 直连而 `apps.apple.com` 进 Apple 组。

## 致谢

[AIsouler/MyClash](https://github.com/AIsouler/MyClash) · [Lanlan13-14/Rules](https://github.com/Lanlan13-14/Rules) · [dahaha-365/YaNet](https://github.com/dahaha-365/YaNet) · [MetaCubeX/meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat) · [appshubcc/bett-rules](https://github.com/appshubcc/bett-rules) · [Koolson/Qure](https://github.com/Koolson/Qure)（图标）
