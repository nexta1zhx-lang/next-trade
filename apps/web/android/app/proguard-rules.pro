# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# ─── Capacitor / WebView ──────────────────────────────────
# Capacitor 通过 JavaScriptInterface 与原生通信，需要保留这些类
-keep class com.getcapacitor.** { *; }
-keep class com.nexttrade.app.** { *; }

# 保留 JavaScriptInterface 方法（供 WebView JS 调用）
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ─── 保留行号信息（方便排查问题）────────────────────────��
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
