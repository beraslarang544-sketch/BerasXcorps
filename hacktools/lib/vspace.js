import { signScript } from "./inject.js";

export function hostProject({ pkg = "id.berasxcorps.farm", label = "BerasFarm", overlay = true } = {}) {
  const appId = "id.berasxcorps.hex.vspace";
  const files = {};

  files["README.md"] = `# HEX Virtual Space Host

Host first-party untuk paket **${pkg}** (${label}).

Ini BUKAN Parallel Space / VirtualApp. Host tidak mengkloning aplikasi orang lain
dan tidak memuat APK pihak ketiga di proses yang sama.

Yang dilakukan host:

1. Meluncurkan APK milikmu lewat launch intent.
2. Menyimpan profil terpisah (save overlay) di folder aplikasi host.
3. Overlay tombol cheat yang mengirim broadcast ke HEX SDK di dalam game.
4. Opsional: WebSocket ke studio \`/bridge\` untuk nilai live.

## Bangun

\`\`\`bash
# Android Studio → Open folder ini
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
\`\`\`

Game target harus sudah terpasang dan sudah menyertakan HEX SDK
(\`XCorpsRuntime.attach\`) supaya overlay bisa menulis nilai.
`;

  files["settings.gradle.kts"] = `pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories { google(); mavenCentral() }
}
rootProject.name = "HexVSpace"
include(":app")
`;

  files["build.gradle.kts"] = `plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
}
`;

  files["gradle.properties"] = `org.gradle.jvmargs=-Xmx2g
android.useAndroidX=true
kotlin.code.style=official
`;

  files["app/build.gradle.kts"] = `plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "${appId}"
    compileSdk = 34
    defaultConfig {
        applicationId = "${appId}"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
    }
    buildTypes {
        release { isMinifyEnabled = false }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
}
`;

  files["app/src/main/AndroidManifest.xml"] = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW"/>
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>
    <uses-permission android:name="android.permission.INTERNET"/>
    <application
        android:allowBackup="true"
        android:label="HEX V-Space"
        android:supportsRtl="true"
        android:theme="@style/Theme.AppCompat.DayNight.NoActionBar">
        <activity
            android:name=".HostActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN"/>
                <category android:name="android.intent.category.LAUNCHER"/>
            </intent-filter>
        </activity>
        <service
            android:name=".OverlayService"
            android:exported="false"/>
    </application>
</manifest>
`;

  files["app/src/main/java/id/berasxcorps/hex/vspace/HostActivity.kt"] = `package ${appId}

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class HostActivity : AppCompatActivity() {
    private val guest = "${pkg}"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_host)
        findViewById<TextView>(R.id.guestPkg).text = guest

        findViewById<Button>(R.id.btnLaunch).setOnClickListener { launchGuest() }
        findViewById<Button>(R.id.btnOverlay).setOnClickListener {
            if (!Settings.canDrawOverlays(this)) {
                startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:\$packageName")))
            } else {
                startService(Intent(this, OverlayService::class.java))
                Toast.makeText(this, "Overlay HEX aktif", Toast.LENGTH_SHORT).show()
            }
        }
        findViewById<Button>(R.id.btnProfile).setOnClickListener {
            val dir = getExternalFilesDir("guest/\$guest")
            dir?.mkdirs()
            Toast.makeText(this, "Profil: \${dir?.absolutePath}", Toast.LENGTH_LONG).show()
        }
    }

    private fun launchGuest() {
        val launch = packageManager.getLaunchIntentForPackage(guest)
        if (launch == null) {
            Toast.makeText(this, "APK \$guest belum terpasang", Toast.LENGTH_LONG).show()
            return
        }
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivity(launch)
    }
}
`;

  files["app/src/main/java/id/berasxcorps/hex/vspace/OverlayService.kt"] = `package ${appId}

import android.app.Service
import android.content.Intent
import android.graphics.PixelFormat
import android.os.IBinder
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout

class OverlayService : Service() {
    private var wm: WindowManager? = null
    private var view: LinearLayout? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        wm = getSystemService(WINDOW_SERVICE) as WindowManager
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xCC12151D.toInt())
            setPadding(24, 24, 24, 24)
            addView(chip("COINS +999") { send("coins", 999999) })
            addView(chip("HP FULL") { send("health", 100f) })
            addView(chip("SPEED x2") { send("speed", 2f) })
            addView(chip("TUTUP") { stopSelf() })
        }
        view = panel
        val p = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        )
        p.gravity = Gravity.TOP or Gravity.END
        p.y = 180
        wm?.addView(panel, p)
    }

    private fun chip(label: String, fn: () -> Unit): Button =
        Button(this).apply { text = label; setOnClickListener { fn() } }

    private fun send(id: String, value: Any) {
        val i = Intent("id.berasxcorps.hex.BRIDGE").apply {
            setPackage("${pkg}")
            putExtra("op", "set")
            putExtra("id", id)
            putExtra("value", value.toString())
        }
        sendBroadcast(i)
    }

    override fun onDestroy() {
        view?.let { wm?.removeView(it) }
        super.onDestroy()
    }
}
`;

  files["app/src/main/res/layout/activity_host.xml"] = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:orientation="vertical" android:padding="24dp"
    android:background="#07080C"
    android:layout_width="match_parent" android:layout_height="match_parent">
    <TextView android:text="HEX V-SPACE" android:textColor="#E8C547" android:textSize="22sp"
        android:layout_width="wrap_content" android:layout_height="wrap_content"/>
    <TextView android:id="@+id/guestPkg" android:textColor="#3EE0C5" android:textSize="14sp"
        android:layout_marginTop="8dp"
        android:layout_width="wrap_content" android:layout_height="wrap_content"/>
    <Button android:id="@+id/btnLaunch" android:text="Jalankan game milikmu"
        android:layout_marginTop="24dp" android:layout_width="match_parent" android:layout_height="wrap_content"/>
    <Button android:id="@+id/btnOverlay" android:text="Pasang overlay HEX"
        android:layout_marginTop="8dp" android:layout_width="match_parent" android:layout_height="wrap_content"/>
    <Button android:id="@+id/btnProfile" android:text="Buat profil terisolasi"
        android:layout_marginTop="8dp" android:layout_width="match_parent" android:layout_height="wrap_content"/>
</LinearLayout>
`;

  files["overlay.json"] = JSON.stringify(
    {
      guest: pkg,
      label,
      overlay,
      actions: [
        { id: "coins", label: "Coins +999", op: "set", value: 999999 },
        { id: "health", label: "HP Full", op: "set", value: 100 },
        { id: "speed", label: "Speed x2", op: "set", value: 2 },
      ],
    },
    null,
    2
  );

  files["scripts/sign.sh"] = signScript("guest-unsigned.apk");

  return files;
}

export function adbRecipes(pkg = "id.berasxcorps.farm") {
  return `# HEX ADB recipes — first-party only
# Install patched APK (after you sign it with YOUR key)
adb install -r hex-signed.apk

# Pull save files from YOUR app
adb shell "run-as ${pkg} ls -la files"
adb exec-out run-as ${pkg} tar c files > save-files.tar

# Isolated profile folder (host)
adb shell mkdir -p /sdcard/Android/data/id.berasxcorps.hex.vspace/files/guest/${pkg}

# Broadcast a cheat (SDK must be in the APK)
adb shell am broadcast -a id.berasxcorps.hex.BRIDGE -n ${pkg}/id.berasxcorps.hex.BridgeReceiver --es op set --es id coins --es value 999999
`;
}
