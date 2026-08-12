# HEX SDK — first-party

Masukkan `XCorpsRuntime.kt` (atau `.java`) ke modul game milikmu.

```kotlin
class FarmApp : Application() {
    override fun onCreate() {
        super.onCreate()
        XCorpsRuntime.attach(this)
        XCorpsRuntime.registerInt("coins", { Player.coins }, { Player.coins = it })
        XCorpsRuntime.registerFloat("health", { Player.hp }, { Player.hp = it })
        XCorpsRuntime.registerFloat("speed", { Player.speed }, { Player.speed = it })
    }
}

// di loop game
dt *= XCorpsRuntime.speedScale()
XCorpsRuntime.tickFrozen()
```

HEX Studio menyuntik `assets/xcorps/*` tanpa decompile. Runtime di atas yang
membaca tabel cheat. Tanpa SDK, berkas inject hanya data.

Tidak ada ptrace, Frida, atau VirtualApp.
