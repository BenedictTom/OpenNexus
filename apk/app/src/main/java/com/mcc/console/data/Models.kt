package com.mcc.console.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class SessionView(
    val name: String,
    val path: String,
    val status: String,
    val lastActive: Long = 0,
    val createdAt: Long = 0,
)

@Serializable
data class PermissionRequest(
    val id: String,
    val sessionId: String,
    val sessionName: String? = null,
    val cwd: String,
    val toolName: String,
    val toolInput: JsonElement? = null,
    val description: String,
    val createdAt: Long,
)

@Serializable
data class DecisionBody(val choice: String, val reason: String? = null)

@Serializable
data class NtfyAction(
    val action: String,
    val label: String,
    val url: String,
    val method: String? = null,
    val body: String? = null,
)

@Serializable
data class TunnelState(
    val active: Boolean,
    val url: String? = null,
    val startedAt: Long? = null,
    val pid: Long? = null,
)

@Serializable
data class NtfyMessage(
    val id: String,
    val time: Long,
    val event: String,
    val topic: String,
    val title: String? = null,
    val message: String? = null,
    val priority: Int = 3,
    val tags: List<String> = emptyList(),
    val click: String? = null,
    val actions: List<NtfyAction> = emptyList(),
)
