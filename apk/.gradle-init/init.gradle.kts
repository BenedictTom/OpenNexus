// Gradle 国内镜像加速（容器内用）
val ali = mapOf(
    "https://repo.maven.apache.org/maven2"  to "https://maven.aliyun.com/repository/central",
    "https://repo1.maven.org/maven2"         to "https://maven.aliyun.com/repository/central",
    "https://jcenter.bintray.com"            to "https://maven.aliyun.com/repository/public",
    "https://dl.google.com/dl/android/maven2" to "https://maven.aliyun.com/repository/google",
    "https://plugins.gradle.org/m2"          to "https://maven.aliyun.com/repository/gradle-plugin"
)

allprojects {
    repositories {
        all {
            if (this is MavenArtifactRepository) {
                val orig = url.toString().trimEnd('/')
                ali.forEach { (k, v) ->
                    if (orig.startsWith(k.trimEnd('/'))) setUrl(v)
                }
            }
        }
        // 兜底
        maven { url = uri("https://maven.aliyun.com/repository/google") }
        maven { url = uri("https://maven.aliyun.com/repository/central") }
        maven { url = uri("https://maven.aliyun.com/repository/public") }
        maven { url = uri("https://maven.aliyun.com/repository/gradle-plugin") }
    }
}

settingsEvaluated {
    pluginManagement {
        repositories {
            maven { url = uri("https://maven.aliyun.com/repository/gradle-plugin") }
            maven { url = uri("https://maven.aliyun.com/repository/google") }
            maven { url = uri("https://maven.aliyun.com/repository/central") }
            maven { url = uri("https://maven.aliyun.com/repository/public") }
        }
    }
}
