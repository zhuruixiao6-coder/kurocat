#!/usr/bin/env bash
# KuroCat macOS 构建脚本（在 Mac 上运行）
#
# 用法：
#   ./scripts/build-macos.sh                 # 只构建，不签名（本机测试用）
#   SIGN=1 ./scripts/build-macos.sh          # 用 Developer ID 签名
#   SIGN=1 NOTARIZE=1 ./scripts/build-macos.sh   # 签名 + 公证 + staple（发布用）
#
# 需要环境变量（SIGN=1 时）：
#   APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
#   APPLE_ID / APPLE_PASSWORD（App 专用密码）/ APPLE_TEAM_ID（NOTARIZE=1 时）
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> 检查工具链"
xcode-select -p >/dev/null || { echo "缺少 Xcode Command Line Tools"; exit 1; }
command -v node >/dev/null || { echo "缺少 Node"; exit 1; }
rustup target list --installed | grep -q aarch64-apple-darwin || rustup target add aarch64-apple-darwin
rustup target list --installed | grep -q x86_64-apple-darwin || rustup target add x86_64-apple-darwin

echo "==> 前端构建"
npm ci || npm install
npm run build

echo "==> Tauri 构建（Universal）"
ARGS=(--target universal-apple-darwin --bundles app,dmg)
if [[ "${SIGN:-0}" == "1" ]]; then
  : "${APPLE_SIGNING_IDENTITY:?需要 APPLE_SIGNING_IDENTITY}"
  export APPLE_SIGNING_IDENTITY
fi
npx tauri build "${ARGS[@]}"

APP="src-tauri/target/universal-apple-darwin/release/bundle/macos/KuroCat.app"
DMG_DIR="src-tauri/target/universal-apple-darwin/release/bundle/dmg"

if [[ "${NOTARIZE:-0}" == "1" ]]; then
  echo "==> 公证"
  : "${APPLE_ID:?}" ; : "${APPLE_PASSWORD:?}" ; : "${APPLE_TEAM_ID:?}"
  DMG=$(ls -t "$DMG_DIR"/*.dmg | head -1)
  xcrun notarytool submit "$DMG" --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" \
    --team-id "$APPLE_TEAM_ID" --wait
  xcrun stapler staple "$DMG"
  xcrun stapler staple "$APP"
fi

echo "==> 发布用压缩包（更新器要求文件名以 -macos-universal.app.tar.gz 结尾）"
VERSION=$(node -p "require('./package.json').version")
(cd "$(dirname "$APP")" && tar -czf "KuroCat-${VERSION}-macos-universal.app.tar.gz" "KuroCat.app")

echo "完成："
echo "  $APP"
ls -lh "$DMG_DIR"/*.dmg || true
echo "  $(dirname "$APP")/KuroCat-${VERSION}-macos-universal.app.tar.gz"
