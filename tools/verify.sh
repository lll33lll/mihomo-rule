#!/usr/bin/env bash
# 用真实 mihomo 内核校验两份产物：覆写脚本的输出、以及配置文件版。
# CI 与本地都用这一份，避免两处逻辑跑偏。
set -euo pipefail

cd "$(dirname "$0")/.."

ver="${MIHOMO_VERSION:-}"
if [ -z "$ver" ]; then
  ver=$(curl -sL https://api.github.com/repos/MetaCubeX/mihomo/releases/latest | grep -oP '"tag_name": "\K[^"]+')
fi
case "$(uname -m)" in
  x86_64) arch=amd64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) arch=amd64 ;;
esac
echo "mihomo $ver ($arch)"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

curl -sL -o "$work/mihomo.gz" "https://github.com/MetaCubeX/mihomo/releases/download/${ver}/mihomo-linux-${arch}-${ver}.gz"
gzip -df "$work/mihomo.gz"
chmod +x "$work/mihomo"

node test/emit.js "$work/gen.yaml"
sed "s|url: '' # ← 订阅链接填这里|url: 'https://example.com/sub'|" Config/config.yaml > "$work/file.yaml"

"$work/mihomo" -t -d "$work" -f "$work/gen.yaml"
"$work/mihomo" -t -d "$work" -f "$work/file.yaml"
echo "两份产物都通过内核校验"
