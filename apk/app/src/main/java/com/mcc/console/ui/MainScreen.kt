package com.mcc.console.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Terminal
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import com.mcc.console.data.AppConfig

private enum class Tab(val title: String) {
    Sessions("会话"), Terminal("终端"), Files("文件"),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen(cfg: AppConfig) {
    var current by remember { mutableStateOf(Tab.Sessions) }
    var showShare by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Claude Console") },
                actions = {
                    IconButton(onClick = { showShare = true }) {
                        Icon(Icons.Default.Share, contentDescription = "公网分享")
                    }
                },
            )
        },
        bottomBar = {
            NavigationBar {
                Tab.values().forEach { t ->
                    NavigationBarItem(
                        selected = current == t,
                        onClick = { current = t },
                        icon = {
                            when (t) {
                                Tab.Sessions -> Icon(Icons.Default.List, contentDescription = null)
                                Tab.Terminal -> Icon(Icons.Default.Terminal, contentDescription = null)
                                Tab.Files -> Icon(Icons.Default.Folder, contentDescription = null)
                            }
                        },
                        label = { Text(t.title) },
                    )
                }
            }
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            val path = when (current) {
                Tab.Sessions -> "/"
                Tab.Terminal -> "/term/"
                Tab.Files -> "/files.html"
            }
            McWebView(url = cfg.baseUrl + path)
        }
    }

    if (showShare) {
        ShareSheet(cfg = cfg, onDismiss = { showShare = false })
    }
}
