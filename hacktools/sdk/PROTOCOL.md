# HEX Bridge Protocol

First-party only. The game process talks to HEX Studio or the V-Space host.
No ptrace. No attach to a foreign PID.

## Transport

- Android broadcast `id.berasxcorps.hex.BRIDGE`
- WebSocket `ws://HOST:8787/bridge?pkg=YOUR.PACKAGE&role=game&token=HEX-...`

## Messages

```json
{ "type": "hello", "pkg": "id.example.game", "version": "1.0.0", "schema": [] }
{ "type": "values", "items": [{ "id": "coins", "type": "i32", "value": 120 }] }
{ "type": "set", "id": "coins", "value": 9999 }
{ "type": "freeze", "id": "health", "on": true, "value": 100 }
{ "type": "speed", "scale": 2 }
{ "type": "ping" }
```

Studio sends `set` / `freeze` / `speed`. Game replies with `values`.

If the APK does not include `XCorpsRuntime`, inject files in `assets/xcorps/` stay inert.
