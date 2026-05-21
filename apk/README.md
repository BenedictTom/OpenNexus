# MobileClaudeConsole APK

Kotlin + Compose 原生 App, 用作 Mac 端 mobile-claude-console 服务的客户端 + 通知接收端。

## 在 Android Studio 中打开

```
File → Open → 选 /Users/caohongwei/Program/mobile-claude-console/apk 目录
```

首次打开会:
1. 自动同步 Gradle, 下载 Wrapper 和依赖 (5-10 分钟)
2. 提示需要 Android SDK 平台 (API 34) 和 Build Tools, 同意装即可

## 编译 + 安装

```
./gradlew assembleDebug
adb install app/build/outputs/apk/debug/app-debug.apk
```

或在 Studio 里点 ▶ 直接推到连着的手机。

## 首次启动

1. 应用打开会要权限: 通知 (Android 13+ 必须)
2. 进入「首次配置」页:
   - **Mac 主机**: 填 Tailscale MagicDNS 名 (如 `mac-mini.tailnet-xxxx.ts.net`) 或局域网 IP
   - **端口**: 默认 8080
   - **ntfy topic**: 与 Mac 端 `mcc.config.json` 一致
   - **ntfy server**: 默认 `https://ntfy.sh`
3. 点「测试连接」验证, 通过后「保存」
4. 进入主界面 (三 Tab: 会话 / 终端 / 文件)

## 当前能力 (Day 4 骨架)

- ✅ WebView 加载 Mac 三个页面
- ✅ Foreground service 占位 (常驻通知)
- ✅ 通知权限引导
- ✅ 配置持久化 (DataStore)
- ⏳ ntfy 订阅 + 审批按钮 (Day 5)
- ⏳ 按钮回填决策 (Day 5)
- ⏳ Deep link `mcc://session/<name>` 跳转对应 Tab (Day 5)

## 包结构

```
com.mcc.console/
├── McApplication.kt          通知 Channel 注册
├── MainActivity.kt           入口 Activity
├── data/
│   ├── ConfigStore.kt        DataStore 配置持久化
│   └── Models.kt             序列化模型
├── net/
│   └── McServer.kt           OkHttp REST 客户端
├── notify/
│   ├── Channels.kt           Channel ID 常量
│   ├── NtfyService.kt        ForegroundService (Day 5 完整)
│   └── ApprovalReceiver.kt   按钮回调 Receiver (Day 5 完整)
└── ui/
    ├── RootScreen.kt         路由: 未配置 → ConfigScreen, 已配置 → MainScreen
    ├── ConfigScreen.kt       首次配置表单
    ├── MainScreen.kt         三 Tab 主界面
    └── McWebView.kt          WebView Compose 包装
```
