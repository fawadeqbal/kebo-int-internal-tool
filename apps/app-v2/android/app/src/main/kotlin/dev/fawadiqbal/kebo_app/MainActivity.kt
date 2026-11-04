package dev.fawadiqbal.kebo_app

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

/**
 * Share → RFQ Desk. receive_sharing_intent hands the shared files to Dart; this adds two things it
 * does not do: the words that came with files (an email's subject and body, a WhatsApp caption),
 * on the "rfqdesk/share" channel, and files from the Files app (document links), which are copied
 * here first because the plugin would pass a storage path this app may not read.
 */
class MainActivity : FlutterActivity() {
    private var sharedText: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        // Before super: the plugins read the intent while the engine attaches.
        prepare(intent)
        super.onCreate(savedInstanceState)
    }

    override fun onNewIntent(intent: Intent) {
        prepare(intent)
        super.onNewIntent(intent)
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "rfqdesk/share").setMethodCallHandler { call, result ->
            when (call.method) {
                "text" -> result.success(sharedText)
                "reset" -> {
                    sharedText = null
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }
    }

    private fun prepare(intent: Intent?) {
        if (intent == null || (intent.action != Intent.ACTION_SEND && intent.action != Intent.ACTION_SEND_MULTIPLE)) return
        val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)?.trim()
        val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.trim()
        sharedText = listOfNotNull(subject, text).filter { it.isNotEmpty() }.distinct().joinToString("\n\n").ifEmpty { null }
        try {
            if (intent.action == Intent.ACTION_SEND) {
                val uri = streamOf(intent) ?: return
                if (isDocument(uri)) intent.putExtra(Intent.EXTRA_STREAM, copy(uri) ?: uri)
            } else {
                val uris = streamsOf(intent) ?: return
                if (uris.any { isDocument(it) }) {
                    intent.putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList(uris.map { if (isDocument(it)) copy(it) ?: it else it }))
                }
            }
        } catch (e: Exception) {
            // Left as it came: the plugin still tries.
        }
    }

    private fun isDocument(uri: Uri) = DocumentsContract.isDocumentUri(this, uri)

    /** A copy in the app's cache, readable from Dart; null when it cannot be read. */
    private fun copy(uri: Uri): Uri? = try {
        var name: String? = null
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
            if (it.moveToFirst()) name = it.getString(0)
        }
        val dir = File(cacheDir, "shared/${System.currentTimeMillis()}").apply { mkdirs() }
        val file = File(dir, (name ?: "file").replace('/', '_'))
        contentResolver.openInputStream(uri)?.use { input -> file.outputStream().use { input.copyTo(it) } } ?: throw IllegalStateException()
        Uri.fromFile(file)
    } catch (e: Exception) {
        null
    }

    @Suppress("DEPRECATION")
    private fun streamOf(intent: Intent): Uri? =
        if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) else intent.getParcelableExtra(Intent.EXTRA_STREAM)

    @Suppress("DEPRECATION")
    private fun streamsOf(intent: Intent): ArrayList<Uri>? =
        if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java) else intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)
}
