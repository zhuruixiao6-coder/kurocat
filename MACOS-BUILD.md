# KuroCat macOS 构建与发布指南

> 本文给「拿到一台 Mac 之后怎么把它编出来、签好、发出去」。
> 代码侧的 macOS 适配已经完成大半，剩下的是编译验证与签名流程。

---

## 0. 当前状态（2026-11-26）

| 项目 | 状态 |
|---|---|
| Tauri 2 应用壳 | ✅ 跨平台 |
| 透明无边框窗口 / 置顶 / 多显示器 | ✅ `macos_window.rs` 已实现 |
| 全局键盘钩子（CGEventTap + IOHIDManager） | ✅ 已实现，**未在 Mac 编译验证** |
| 键码映射（CGKeyCode → VK） | ✅ 全量映射（字母/数字/符号/小键盘/方向/F1-F12/修饰键） |
| 开机自启（LaunchAgents） | ✅ 已实现 |
| 权限检测 + 引导条 | ✅ 本次新增（`macos_perms.rs` + 顶部提示条） |
| 更新器（识别 macos 资产） | ✅ 已支持 `*-macos-universal.app.tar.gz` / `.dmg` |
| 签名 / 公证 / DMG | ⬜ 需要 Apple 账号，见第 3 节 |
| 真机回归 | ⬜ 必须在 Mac 上做，见第 5 节 |

---

## 1. 准备环境

```bash
xcode-select --install                 # 命令行工具
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
node -v    # >= 18
npm i -g @tauri-apps/cli   # 或直接用 npx
```

Apple Silicon 机器即可，Intel 目标用交叉编译（Universal 构建会同时产出两个架构）。

---

## 2. 构建

```bash
npm ci
npm run build
npx tauri build --target universal-apple-darwin --bundles app,dmg
```

产物：
```
src-tauri/target/universal-apple-darwin/release/bundle/macos/KuroCat.app
src-tauri/target/universal-apple-darwin/release/bundle/dmg/KuroCat_<ver>_universal.dmg
```

或直接用脚本：

```bash
./scripts/build-macos.sh          # 不签名，本机跑
SIGN=1 ./scripts/build-macos.sh   # 签名
SIGN=1 NOTARIZE=1 ./scripts/build-macos.sh   # 签名 + 公证 + staple
```

### 首次编译大概率要修的地方

- `objc2 0.6` / `objc2-app-kit 0.3` 的 API 名称变动（`NSWindow::setLevel`、`collectionBehavior` 等）；
- `#[cfg(windows)]` 漏网导致的 `windows_sys` 引用；
- `win7_layered` / `windows_display` 在 mac 上不参与编译，若被无条件引用会报错；
- `tauri.conf.json` 里 NSIS 段落只对 Windows 生效，不用改。

---

## 3. 签名与公证

### 3.1 证书
1. 加入 Apple Developer Program（99 美元/年）；
2. 在 Certificates 里创建 **Developer ID Application**，导入钥匙串；
3. 确认：`security find-identity -v -p codesigning` 能看到 `Developer ID Application: ... (TEAMID)`。

### 3.2 构建时签名
```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
npx tauri build --target universal-apple-darwin --bundles app,dmg
```

### 3.3 公证
```bash
xcrun notarytool submit KuroCat_5.9.0_universal.dmg \
  --apple-id "you@example.com" --password "app-specific-password" \
  --team-id "TEAMID" --wait
xcrun stapler staple KuroCat_5.9.0_universal.dmg
xcrun stapler staple KuroCat.app
```

未公证的包在别人机器上会提示「已损坏，应移到废纸篓」，**不要跳过**。

---

## 4. 权限（用户侧）

首次启动会在宠物窗口顶部出现一条提示：

```
⚠ 需要「辅助功能」权限才能统计按键   [辅助功能] [输入监控] [已授权 · 重启]
```

- 点「辅助功能」→ 打开 系统设置 → 隐私与安全性 → 辅助功能，勾选 KuroCat；
- 点「输入监控」→ 勾选 KuroCat（IOHIDManager 通道需要，掉这个也能计数，但某些输入法/键盘会漏）；
- 两项都勾选后点「已授权 · 重启」，重启后钩子重新挂载。

> 为什么需要两个：CGEventTap 负责常规按键；IOHIDManager 负责在 Secure Input / 某些输入法下仍能读到硬件。任一缺失都会让统计变少。

---

## 5. 真机回归清单

- [ ] 双击 DMG 安装 → 首次启动不报「已损坏」
- [ ] 顶部权限条出现，两项授权后消失
- [ ] 快速连打（35ms 间隔）计数不丢
- [ ] 中文输入法候选框打字不重复计数
- [ ] 密码框聚焦时计数停止，失焦恢复
- [ ] 窗口置顶、点击穿透、贴边停靠、跨全屏空间
- [ ] 多显示器（Retina + 外接 1080p）位置记忆
- [ ] 75% 键盘 / 自定义配色 JSON / 毛色贴图 / 大肥鱼都能加载
- [ ] 菜单栏图标在深浅色下都清晰
- [ ] 开机自启生效，系统「登录项」里可见
- [ ] 检查更新能识别 `*-macos-universal.app.tar.gz`

---

## 6. 发布资产命名（重要）

更新器的匹配规则写死在 `updater.rs`：

| 平台 | 资产名必须匹配 |
|---|---|
| macOS | `*-macos-universal.app.tar.gz`（优先）或 `*-macos-universal.dmg` |
| Windows | `*-setup.exe` / `*-windows-x64.exe` / `*win7*.zip` |

所以 macOS 包名要形如：

```
KuroCat-5.9.0-macos-universal.app.tar.gz
KuroCat-5.9.0-macos-universal.dmg
```

`build-macos.sh` 已按这个规则打包。

---

## 7. 数据目录

```
~/Library/Application Support/kuro-cat-pet/
    profile.json  settings.json  cats.json  shop.json
    keyboards/    skins/         sounds/
```

与 Windows 的 `%APPDATA%\kuro-cat-pet\` 结构一致，可直接互相拷贝。

---

## 8. 已知限制

1. 不能上架 App Store（全局输入 + 非沙盒）；
2. Secure Input 场景计数必漏，只能提示；
3. 隐私模式在 macOS 上降级为手动开关（没有 UIAutomation 等价能力）；
4. 全屏独占游戏上方窗口会被系统压制；
5. 最低系统版本配置为 10.15，但 Tauri 2 + objc2 实际建议 11+。
