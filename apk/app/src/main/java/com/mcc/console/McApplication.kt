package com.mcc.console

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import com.mcc.console.notify.Channels

class McApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        ensureChannels()
    }

    private fun ensureChannels() {
        val nm = getSystemService(NotificationManager::class.java)
        listOf(
            NotificationChannel(Channels.APPROVAL, getString(R.string.notify_channel_approval), NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Claude 工具调用审批请求"
                enableVibration(true)
            },
            NotificationChannel(Channels.EVENT, getString(R.string.notify_channel_event), NotificationManager.IMPORTANCE_DEFAULT),
            NotificationChannel(Channels.SERVICE, getString(R.string.notify_channel_service), NotificationManager.IMPORTANCE_LOW),
        ).forEach(nm::createNotificationChannel)
    }
}
