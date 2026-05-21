# 把编译好的 APK 放这里

按 `docs/BUILD.md` 完成编译后：

```bash
cp ../apk/app/build/outputs/apk/debug/app-debug.apk \
   ./OpenNexus-v0.1.0-debug.apk
```

约定文件名：`OpenNexus-v<版本号>-{debug,release}.apk`。

这个目录已经在 `.gitignore` 里 allowlist：`!release/*.apk`，可以直接 `git add release/*.apk` 进开源仓库做下载链。

## 给 release 包签名（v0.2 起）

```bash
keytool -genkey -v -keystore opennexus.jks -keyalg RSA -keysize 2048 -validity 10000 -alias opennexus
# 注意 opennexus.jks 不要进 git（.gitignore 已含 *.keystore，建议也加 *.jks）
```

打包：

```bash
cd ../apk
./gradlew assembleRelease \
  -Pandroid.injected.signing.store.file=$(pwd)/../release/opennexus.jks \
  -Pandroid.injected.signing.store.password=*** \
  -Pandroid.injected.signing.key.alias=opennexus \
  -Pandroid.injected.signing.key.password=***
```
