package com.mcc.console.ui

import android.annotation.SuppressLint
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun McWebView(url: String, modifier: Modifier = Modifier) {
    val ctx = LocalContext.current
    val view = remember {
        WebView(ctx).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            webChromeClient = WebChromeClient()
            webViewClient = WebViewClient() // 留在 WebView 内,不弹外部浏览器
        }
    }
    LaunchedEffect(url) { if (view.url != url) view.loadUrl(url) }
    AndroidView(factory = { view }, modifier = modifier.fillMaxSize())
}
