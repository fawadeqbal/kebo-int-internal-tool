package com.keboint.kebo_rfq

import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity

class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // The channel push notifications arrive on (Settings → Apps → Kebo RFQ → Notifications → Updates).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel("kebo_updates", "Updates", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "New inquiries, assignments, quotations, payments and reminders"
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }
}
