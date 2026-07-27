# NextTrade Android 构建指南

## 项目结构

```
apps/web/
├── capacitor.config.ts        # Capacitor 配置
├── .env.capacitor             # Capacitor 构建环境变量
├── android/                   # Android 原生项目（由 Capacitor 生成）
│   ├── app/src/main/
│   │   ├── AndroidManifest.xml          # 应用清单（权限、组件声明）
│   │   ├── java/.../MainActivity.java    # Android 入口 Activity
│   │   └── res/                         # 资源文件（图标、闪屏、主题）
│   ├── build.gradle           # 项目级构建脚本
│   ├── gradle/wrapper/        # Gradle Wrapper（无需预装 Gradle）
│   └── local.properties       # 本地 SDK 路径（不提交 git）
├── android-build.md           # 本文件
└── src/components/DebugLogger.tsx  # 远程错误日志组件
```

## 环境准备

### 必要组件

| 组件               | 版本要求 | 安装方式                          |
| ------------------ | -------- | --------------------------------- |
| JDK                | 21+      | `brew install openjdk@21`         |
| Android SDK        | API 36   | 命令行工具安装（见下方）          |
| Android 命令行工具 | latest   | 已安装到 `~/Library/Android/sdk/` |

国内网络慢时，使用中科大镜像加速：

```bash
export HOMEBREW_API_DOMAIN="https://mirrors.ustc.edu.cn/homebrew-bottles/api"
export HOMEBREW_BOTTLE_DOMAIN="https://mirrors.ustc.edu.cn/homebrew-bottles"
```

### 安装 JDK 21

```bash
brew install openjdk@21

# 配置环境变量
echo 'export JAVA_HOME=/opt/homebrew/opt/openjdk@21' >> ~/.zshrc
echo 'export PATH="$JAVA_HOME/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

### 安装 Android SDK

```bash
# 下载命令行工具（需网络，约 146MB）
curl -L --retry 3 -o /tmp/cmdline-tools.zip \
  "https://mirrors.cloud.tencent.com/AndroidSDK/commandlinetools-mac-11076708_latest.zip"

# 解压到 SDK 目录
mkdir -p ~/Library/Android/sdk/cmdline-tools
unzip /tmp/cmdline-tools.zip -d /tmp/cmdline-tools
mv /tmp/cmdline-tools/cmdline-tools ~/Library/Android/sdk/cmdline-tools/latest

# 安装 platform 和 build-tools
export ANDROID_HOME=$HOME/Library/Android/sdk
yes | $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager \
  --sdk_root=$ANDROID_HOME \
  "platforms;android-36" \
  "build-tools;36.0.0"
```

### 创建 local.properties

```bash
echo "sdk.dir=$HOME/Library/Android/sdk" > apps/web/android/local.properties
```

## 构建 APK

### 一键构建（推荐）

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
export ANDROID_HOME=$HOME/Library/Android/sdk

cd apps/web

# 1. 设置 API 地址（改成你的服务器局域网 IP）
cp .env.capacitor .env.local

# 2. 构建 Next.js 静态导出 + 同步到 Android + 编译 APK
BUILD_FOR_CAPACITOR=true pnpm run build && \
  npx cap sync && \
  cd android && \
  ./gradlew assembleDebug --no-daemon

# APK 输出位置：
# apps/web/android/app/build/outputs/apk/debug/app-debug.apk
```

### 分步说明

```bash
# Step 1: 构建前端静态文件
cd apps/web
BUILD_FOR_CAPACITOR=true pnpm run build
# 输出 → apps/web/out/

# Step 2: 同步到 Android 项目
npx cap sync
# 把 out/ 复制到 android/app/src/main/assets/public/

# Step 3: 编译 Android APK
cd android
./gradlew assembleDebug --no-daemon
# 输出 → android/app/build/outputs/apk/debug/app-debug.apk
```

## 安装到手机

### USB 连接（推荐）

```bash
# 确认手机已连接并授权
adb devices -l
# 应显示: 设备ID device usb:...

# 安装 APK
adb install -r apps/web/android/app/build/outputs/apk/debug/app-debug.apk

# 启动 App
adb shell am start -n com.nexttrade.app/.MainActivity
```

### WiFi 传输

启动 HTTP 服务，手机浏览器打开下载：

```bash
cd apps/web/android/app/build/outputs/apk/debug
python3 -m http.server 3003
# 手机访问 http://电脑IP:3003/app-debug.apk
```

## 调试

### 方法 1：Chrome DevTools（推荐）

手机 USB 连接后：

```bash
# 1. 查看 WebView 调试端口
adb shell "cat /proc/net/unix | grep webview_devtools"

# 2. 端口转发
adb forward tcp:9223 localabstract:webview_devtools_remote_$(adb shell pidof com.nexttrade.app)

# 3. 查看可调试页面
curl http://localhost:9223/json

# 4. 在 Chrome 打开 devtoolsFrontendUrl（如无法访问 Google CDN，用 Node.js 连接）
node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:9223/devtools/page/页面ID');
ws.on('open', () => {
  ws.send(JSON.stringify({id:1, method:'Console.enable'}));
});
ws.on('message', data => {
  const msg = JSON.parse(data);
  if(msg.method === 'Runtime.consoleAPICalled')
    console.log(msg.params.args.map(a=>a.value).join(' '));
});
"
```

### 方法 2：ADB Logcat

```bash
# 查看 App 所有日志
adb logcat --pid=$(adb shell pidof -s com.nexttrade.app)

# 过滤 WebView 控制台输出
adb logcat --pid=$(adb shell pidof -s com.nexttrade.app) | grep -iE "Capacitor/Console|chromium"

# 截屏
adb exec-out screencap -p > screen.png
```

### 方法 3：远程错误日志

`DebugLogger` 组件已内置在 App 中，JS 运行时报错会自动 POST 到 `/api/debug/log`：

```bash
# 在服务器终端实时查看手机端错误
# 日志格式: [📱 手机端错误] { type, detail, url, userAgent }
```

## 配置说明

### API 地址（.env.capacitor）

```ini
# 构建时注入的 API 地址
NEXT_PUBLIC_API_URL=http://192.168.31.130:3001
BUILD_FOR_CAPACITOR=true
```

- `NEXT_PUBLIC_API_URL`：后端 API 地址，手机和电脑需在同一局域网
- `BUILD_FOR_CAPACITOR`：触发 Next.js 静态导出模式

### Capacitor 配置（capacitor.config.ts）

```ts
const config: CapacitorConfig = {
  appId: 'com.nexttrade.app', // 应用包名
  appName: 'NextTrade', // 桌面显示名称
  webDir: 'out', // 静态文件目录
  server: {
    androidScheme: 'http', // 使用 HTTP 避免 Mixed Content 拦截
    cleartext: true // 允许明文 HTTP
  }
}
```

### 网络安全配置

`android/app/src/main/res/xml/network_security_config.xml` 允许所有 HTTP 明文流量，
使 App 可以连接本地 HTTP 后端。

## 文件提交规范

### 需要提交 git 的 Android 文件（~54 个，~412KB）

| 类别           | 文件                                                                       | 说明                   |
| -------------- | -------------------------------------------------------------------------- | ---------------------- |
| Gradle Wrapper | `gradlew`, `gradlew.bat`, `gradle/wrapper/*`                               | 必须，否则无法编译     |
| 构建配置       | `build.gradle`, `settings.gradle`, `variables.gradle`, `gradle.properties` | 项目配置               |
| App 配置       | `app/build.gradle`, `AndroidManifest.xml`, `MainActivity.java`             | 应用入口               |
| 资源           | `res/mipmap-*/ic_launcher*.png`（15个）                                    | 应用图标               |
| 资源           | `res/drawable*/splash.png`（11个）                                         | 启动闪屏               |
| 资源           | `res/values/*.xml`, `res/xml/*.xml`                                        | 主题、字符串、安全配置 |
| 测试           | `app/src/test/*`, `app/src/androidTest/*`                                  | 单元测试模板           |

### 不提交 git（已忽略）

| 文件/目录                              | 原因                                   |
| -------------------------------------- | -------------------------------------- |
| `build/`, `.gradle/`                   | 编译产物                               |
| `*.apk`, `*.class`                     | 二进制生成物                           |
| `local.properties`                     | 本机 SDK 路径                          |
| `app/src/main/assets/public/`          | Web 静态文件（由 `npx cap sync` 生成） |
| `app/src/main/assets/capacitor.*.json` | 自动生成的配置                         |
| `capacitor-cordova-android-plugins/`   | 插件桩代码                             |
| `out/`                                 | Next.js 静态导出                       |

## 常见问题

| 问题                                             | 解决                                                                                                                                                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `无效的源发行版：21`                             | 需要 JDK 21，不是 JDK 17。`brew install openjdk@21`                                                                                                                                                        |
| `SDK location not found`                         | 创建 `android/local.properties`：`echo "sdk.dir=$HOME/Library/Android/sdk" > apps/web/android/local.properties`                                                                                            |
| `Could not resolve all files` / TLS 错误         | Google Maven 被墙，已配置阿里云镜像在 `android/build.gradle`                                                                                                                                               |
| Mixed Content 错误                               | Capacitor 默认用 HTTPS 加载页面，API 是 HTTP 会被拦截。已在 `capacitor.config.ts` 设置 `androidScheme: 'http'`                                                                                             |
| WebSocket 连不上                                 | 手机和电脑需同局域网，检查防火墙是否开放 3001 端口                                                                                                                                                         |
| `SecurityError: Failed to construct 'WebSocket'` | HTTPS 页面不能发起 WS 连接。同上，需要 `androidScheme: 'http'`                                                                                                                                             |
| 白屏 / App 不渲染                                | 检查 `out/` 目录是否存在、`npx cap sync` 是否执行过                                                                                                                                                        |
| ADB 不识别小米/红米                              | 开启「USB 调试」+「USB 调试（安全设置）」、选 MTP 模式、`adb kill-server` 后重试                                                                                                                           |
| 鸿蒙手机 ADB 连不上                              | 鸿蒙系统不兼容标准 ADB，换其他 Android 手机                                                                                                                                                                |
| `triggerEvent` 报错                              | 之前 `wagmi` 和 `viem` 包未使用但安装了，已从 `package.json` 删除                                                                                                                                          |
| 修改代码后如何更新 APK                           | `cp .env.capacitor .env.local && BUILD_FOR_CAPACITOR=true pnpm run build && npx cap sync && cd android && ./gradlew assembleDebug --no-daemon && adb install -r app/build/outputs/apk/debug/app-debug.apk` |

## 相关文件清单

```
apps/web/
├── capacitor.config.ts                          # Capacitor 核心配置
├── .env.capacitor                               # 构建变量（API 地址）
├── android-build.md                             # 本文档
├── android/
│   ├── .gitignore                               # Android 忽略规则
│   ├── build.gradle                             # 项目 Gradle 配置（含阿里云镜像）
│   ├── settings.gradle
│   ├── gradle.properties
│   ├── variables.gradle
│   ├── gradlew / gradlew.bat                    # Gradle Wrapper
│   ├── gradle/wrapper/
│   │   ├── gradle-wrapper.jar
│   │   └── gradle-wrapper.properties
│   └── app/
│       ├── build.gradle
│       ├── proguard-rules.pro
│       └── src/main/
│           ├── AndroidManifest.xml              # 清单（含网络安全配置）
│           ├── java/com/nexttrade/app/
│           │   └── MainActivity.java            # Activity 入口
│           └── res/
│               ├── drawable*/splash.png         # 启动闪屏（多分辨率）
│               ├── mipmap-*/ic_launcher*.png    # 应用图标（多分辨率）
│               ├── values/
│               │   ├── strings.xml              # 应用名称
│               │   ├── styles.xml               # 暗色主题
│               │   └── ic_launcher_background.xml
│               └── xml/
│                   ├── network_security_config.xml  # 允许 HTTP 明文
│                   └── file_paths.xml
├── src/components/
│   └── DebugLogger.tsx                          # 远程错误日志组件
└── src/lib/
    └── api.ts                                   # API 地址检测逻辑
```
