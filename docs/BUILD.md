# 本地编译 APK 指引

> 自动编译在当前 Mac 上失败了：企业网络拦截了 dl.google.com / github.com / 大多数 SDK 镜像。
> sdkmanager 拿不到 `platforms;android-34` 和 `build-tools;34.0.0`。请在能访问外网的机器（或者切到 VPN / 代理）上按下面步骤完成。

## 一次性环境（5–10 分钟）

```bash
# 1. JDK 17（如果已用 jenv 管理，跳过）
brew install --cask temurin@17

# 2. Gradle（已有可跳）
brew install gradle

# 3. Android SDK 命令行工具
mkdir -p ~/Library/Android/sdk/cmdline-tools
cd ~/Library/Android/sdk/cmdline-tools
curl -fL -o cmdline.zip "https://dl.google.com/android/repository/commandlinetools-mac-11076708_latest.zip"
unzip -q cmdline.zip && mv cmdline-tools latest && rm cmdline.zip

export ANDROID_HOME=~/Library/Android/sdk
export PATH=$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH
export JAVA_HOME=$(/usr/libexec/java_home -v 17)

# 4. 接受 license + 装 build-tools / platform / platform-tools
yes | sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
```

## 编译 + 安装

```bash
cd opennexus/apk
gradle wrapper --gradle-version 8.10.2     # 仅首次
./gradlew assembleDebug

# Debug APK 产物位置
ls app/build/outputs/apk/debug/app-debug.apk

# 拷到分发目录
cp app/build/outputs/apk/debug/app-debug.apk \
   ../release/OpenNexus-v0.1.0-debug.apk

# 推到手机
adb install ../release/OpenNexus-v0.1.0-debug.apk
```

## 国内网络无法访问 dl.google.com 时

Gradle 这一层可以走阿里源（已验证可用）。在 `~/.gradle/init.gradle.kts` 里加：

```kotlin
allprojects {
    repositories {
        maven { url = uri("https://maven.aliyun.com/repository/google") }
        maven { url = uri("https://maven.aliyun.com/repository/central") }
        maven { url = uri("https://maven.aliyun.com/repository/gradle-plugin") }
    }
}
```

但 **Android SDK 本身（cmdline-tools / platforms / build-tools）国内没有靠谱镜像了**（清华、腾讯都关了），只能：

- 临时开 VPN / 代理
- 或者直接用 Android Studio 一键装好 SDK，再 `gradle assembleDebug`

## 直接用 Android Studio

1. Android Studio → Open → 选 `opennexus/apk` 目录
2. Studio 会自动提示装 SDK 34 + Build Tools，同意装
3. 点 ▶ Run（接上手机或开模拟器）

完事 APK 就在 `apk/app/build/outputs/apk/debug/app-debug.apk`。
