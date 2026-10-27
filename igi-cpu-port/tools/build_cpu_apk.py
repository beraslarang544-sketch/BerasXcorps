#!/usr/bin/env python3
"""
Standalone Universal Android APK Compiler, Full Dalvik DEX Assembler,
AXML/ARSC Encoder, 16KB ZipAligner & APK Signature Scheme v1 + v2 Signer.

Builds:
  sandbox_igi/android_apk/ProjectIGI-CPU-Port-v0.6.0-universal.apk

Features:
  - Universal native Android Bionic API 24 libraries:
      * lib/arm64-v8a/libigi_cpu_port.so (AArch64, 16KB page-aligned)
      * lib/x86_64/libigi_cpu_port.so    (X86-64,  16KB page-aligned)
  - Full interactive Dalvik bytecode (classes.dex v035, ART DexFileVerifier clean):
      * IGICpuBridge (System.loadLibrary + JNI nativeInit/StepFrame/OnInput/OnTouch)
      * CpuSurfaceView extends android.view.View (640x360 ARGB_8888 Bitmap software Canvas
        blitter + VSync postInvalidateOnAnimation + multi-zone touch D-Pad & freelook)
      * MainActivity extends android.app.Activity (fullscreen landscape launcher)
  - Binary AXML AndroidManifest.xml (minSdkVersion=24, targetSdkVersion=34,
    android:hardwareAccelerated="false" -> pure CPU software Canvas pipeline)
  - Uncompressed 4-byte aligned resources.arsc & 16KB-aligned native .so libraries
  - Dual Cryptographic Signatures:
      * APK Signature Scheme v1 (JAR META-INF/MANIFEST.MF, CERT.SF, PKCS#7 CERT.RSA)
      * APK Signature Scheme v2 (APK Sig Block 42, ID 0x7109871a, RSA-2048 SHA-256 Merkle)
"""
import base64
import hashlib
import os
import struct
import subprocess
import tempfile
import zlib
import zipfile
from pathlib import Path
from PIL import Image, ImageDraw
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

BASE_DIR = Path("/home/user/BerasXcorps/sandbox_igi")
APK_DIR = BASE_DIR / "android_apk"
OUT_APK = APK_DIR / "ProjectIGI-CPU-Port-v0.6.0-universal.apk"

FB_W = 640
FB_H = 360
FB_PIXELS = FB_W * FB_H  # 230400 (0x00038400)


# ==============================================================================
# 1. Binary Android XML (AXML) Encoder
# ==============================================================================
def encode_utf16_string_pool(strings):
    offsets = []
    str_blob = bytearray()
    for s in strings:
        offsets.append(len(str_blob))
        u16 = s.encode("utf-16le")
        char_len = len(s)
        str_blob += struct.pack("<H", char_len) + u16 + b"\x00\x00"
    while len(str_blob) % 4 != 0:
        str_blob += b"\x00"
    header_size = 28
    strings_start = header_size + len(strings) * 4
    total_size = strings_start + len(str_blob)
    hdr = struct.pack(
        "<HHIIIIII",
        0x0001,        # RES_STRING_POOL_TYPE
        header_size,
        total_size,
        len(strings),
        0,             # styleCount
        0,             # flags (UTF-16)
        strings_start,
        0,             # stylesStart
    )
    off_bytes = b"".join(struct.pack("<I", o) for o in offsets)
    return hdr + off_bytes + bytes(str_blob)


def build_binary_android_manifest():
    # Attribute names with Android framework resource IDs MUST come first, sorted by resource ID
    res_attrs = [
        ("label",               0x01010001),
        ("icon",                0x01010002),
        ("name",                0x01010003),
        ("exported",            0x01010010),
        ("screenOrientation",   0x0101001E),
        ("configChanges",       0x0101001F),
        ("minSdkVersion",       0x0101020C),
        ("versionCode",         0x0101021B),
        ("versionName",         0x0101021C),
        ("targetSdkVersion",    0x01010270),
        ("hardwareAccelerated", 0x010102D3),
        ("extractNativeLibs",   0x010104EA),
    ]
    extra_strings = [
        "android",
        "http://schemas.android.com/apk/res/android",
        "manifest",
        "package",
        "com.berasxcorps.igiport",
        "0.6.0-universal",
        "uses-sdk",
        "application",
        "Project I.G.I. CPU Port",
        "activity",
        "com.berasxcorps.igiport.MainActivity",
        "intent-filter",
        "action",
        "android.intent.action.MAIN",
        "category",
        "android.intent.category.LAUNCHER",
    ]
    pool_list = [name for name, _ in res_attrs] + extra_strings
    sidx = {s: i for i, s in enumerate(pool_list)}

    sp_chunk = encode_utf16_string_pool(pool_list)
    res_map_body = b"".join(struct.pack("<I", rid) for _, rid in res_attrs)
    res_map_chunk = struct.pack("<HHI", 0x0180, 8, 8 + len(res_map_body)) + res_map_body

    NS_URI = sidx["http://schemas.android.com/apk/res/android"]
    NS_PFX = sidx["android"]
    NULL_S = 0xFFFFFFFF

    TYPE_REFERENCE = 0x01
    TYPE_STRING    = 0x03
    TYPE_INT_DEC   = 0x10
    TYPE_INT_HEX   = 0x11
    TYPE_INT_BOOL  = 0x12

    def start_ns(line):
        return struct.pack("<HHIIII", 0x0100, 16, 24, line, NULL_S, NS_PFX) + struct.pack("<I", NS_URI)

    def end_ns(line):
        return struct.pack("<HHIIII", 0x0101, 16, 24, line, NULL_S, NS_PFX) + struct.pack("<I", NS_URI)

    def attr_str(ns, name_s, val_s):
        ni = sidx[name_s]
        vi = sidx[val_s]
        return (ni if ns != NULL_S else 0xFFFF, struct.pack("<IIIHBBI", ns, ni, vi, 8, 0, TYPE_STRING, vi))

    def attr_int(ns, name_s, val_u32, vtype=TYPE_INT_DEC):
        ni = sidx[name_s]
        return (ni if ns != NULL_S else 0xFFFF, struct.pack("<IIIHBBI", ns, ni, NULL_S, 8, 0, vtype, val_u32 & 0xFFFFFFFF))

    def start_elem(line, tag_s, attr_pairs):
        # Android AXML requires attributes with resource IDs to be sorted in ascending resource ID order
        sorted_attrs = [b for _, b in sorted(attr_pairs, key=lambda x: x[0])]
        ti = sidx[tag_s]
        attr_blob = b"".join(sorted_attrs)
        size = 36 + len(attr_blob)
        hdr = struct.pack(
            "<HHIIIIIHHHHHH",
            0x0102, 16, size, line, NULL_S,
            NULL_S, ti,
            0x0014, 0x0014, len(sorted_attrs),
            0, 0, 0
        )
        return hdr + attr_blob

    def end_elem(line, tag_s):
        ti = sidx[tag_s]
        return struct.pack("<HHIIII", 0x0103, 16, 24, line, NULL_S, NULL_S) + struct.pack("<I", ti)

    nodes = bytearray()
    nodes += start_ns(2)
    nodes += start_elem(2, "manifest", [
        attr_int(NS_URI, "versionCode", 600, TYPE_INT_DEC),
        attr_str(NS_URI, "versionName", "0.6.0-universal"),
        attr_str(NULL_S, "package", "com.berasxcorps.igiport"),
    ])
    nodes += start_elem(6, "uses-sdk", [
        attr_int(NS_URI, "minSdkVersion", 24, TYPE_INT_DEC),
        attr_int(NS_URI, "targetSdkVersion", 34, TYPE_INT_DEC),
    ])
    nodes += end_elem(6, "uses-sdk")

    # Application with hardwareAccelerated="false" -> pure CPU Canvas/Surface driver
    # extractNativeLibs="false" -> direct mmap of 16KB-aligned uncompressed .so files
    nodes += start_elem(10, "application", [
        attr_str(NS_URI, "label", "Project I.G.I. CPU Port"),
        attr_int(NS_URI, "icon", 0x7F010000, TYPE_REFERENCE),
        attr_int(NS_URI, "hardwareAccelerated", 0, TYPE_INT_BOOL),
        attr_int(NS_URI, "extractNativeLibs", 0, TYPE_INT_BOOL),
    ])
    # configChanges: orientation|keyboardHidden|screenSize = 0x04A0
    nodes += start_elem(15, "activity", [
        attr_str(NS_URI, "name", "com.berasxcorps.igiport.MainActivity"),
        attr_int(NS_URI, "screenOrientation", 0, TYPE_INT_DEC),  # landscape
        attr_int(NS_URI, "configChanges", 0x04A0, TYPE_INT_HEX),
        attr_int(NS_URI, "exported", 0xFFFFFFFF, TYPE_INT_BOOL),
    ])
    nodes += start_elem(20, "intent-filter", [])
    nodes += start_elem(21, "action", [
        attr_str(NS_URI, "name", "android.intent.action.MAIN"),
    ])
    nodes += end_elem(21, "action")
    nodes += start_elem(22, "category", [
        attr_str(NS_URI, "name", "android.intent.category.LAUNCHER"),
    ])
    nodes += end_elem(22, "category")
    nodes += end_elem(20, "intent-filter")
    nodes += end_elem(15, "activity")
    nodes += end_elem(10, "application")
    nodes += end_elem(2, "manifest")
    nodes += end_ns(2)

    body = sp_chunk + res_map_chunk + bytes(nodes)
    return struct.pack("<HHI", 0x0003, 8, 8 + len(body)) + body


# ==============================================================================
# 2. Binary resources.arsc Table Encoder (0x7f010000 -> res/drawable-mdpi/ic_launcher.png)
# ==============================================================================
def build_resources_arsc():
    global_pool = encode_utf16_string_pool(["res/drawable-mdpi/ic_launcher.png"])
    type_pool = encode_utf16_string_pool(["drawable"])
    key_pool = encode_utf16_string_pool(["ic_launcher"])

    type_spec = struct.pack("<HHIBBHI", 0x0202, 16, 20, 1, 0, 0, 1) + struct.pack("<I", 0)
    entries_start = 68 + 4
    entry_data = struct.pack("<HHIHBBI", 8, 0, 0, 8, 0, 0x03, 0)
    res_config = struct.pack("<I", 48) + b"\x00" * 44
    type_chunk = (
        struct.pack("<HHIBBHII", 0x0201, 68, entries_start + len(entry_data), 1, 0, 0, 1, entries_start)
        + res_config
        + struct.pack("<I", 0)
        + entry_data
    )

    pkg_name_u16 = "com.berasxcorps.igiport".encode("utf-16le").ljust(256, b"\x00")
    pkg_hdr_size = 288
    type_strings_off = pkg_hdr_size
    key_strings_off = type_strings_off + len(type_pool)
    pkg_body = type_pool + key_pool + type_spec + type_chunk
    pkg_chunk = (
        struct.pack("<HHII", 0x0200, pkg_hdr_size, pkg_hdr_size + len(pkg_body), 0x7F)
        + pkg_name_u16
        + struct.pack("<IIIII", type_strings_off, 1, key_strings_off, 1, 0)
        + pkg_body
    )

    total_len = 12 + len(global_pool) + len(pkg_chunk)
    return struct.pack("<HHII", 0x0002, 12, total_len, 1) + global_pool + pkg_chunk


# ==============================================================================
# 3. Full ART-Verifier-Clean Dalvik Bytecode Assembler (classes.dex v035)
#    Classes:
#      1. com.berasxcorps.igiport.CpuSurfaceView extends android.view.View
#      2. com.berasxcorps.igiport.IGICpuBridge
#      3. com.berasxcorps.igiport.MainActivity extends android.app.Activity
# ==============================================================================
def uleb128(v):
    out = bytearray()
    while True:
        b = v & 0x7F
        v >>= 7
        if v:
            out.append(b | 0x80)
        else:
            out.append(b)
            break
    return bytes(out)


def build_classes_dex():
    raw_strings = {
        "<clinit>",
        "<init>",
        "ARGB_8888",
        "CpuSurfaceView.java",
        "F",
        "I",
        "IFLI",
        "IGICpuBridge.java",
        "L",
        "Landroid/app/Activity;",
        "Landroid/content/Context;",
        "Landroid/graphics/Bitmap$Config;",
        "Landroid/graphics/Bitmap;",
        "Landroid/graphics/Canvas;",
        "Landroid/graphics/Paint;",
        "Landroid/graphics/Rect;",
        "Landroid/os/Bundle;",
        "Landroid/view/MotionEvent;",
        "Landroid/view/View;",
        "Lcom/berasxcorps/igiport/CpuSurfaceView;",
        "Lcom/berasxcorps/igiport/IGICpuBridge;",
        "Lcom/berasxcorps/igiport/MainActivity;",
        "LIIL",
        "Ljava/lang/Object;",
        "Ljava/lang/String;",
        "Ljava/lang/System;",
        "MainActivity.java",
        "V",
        "VIFF",
        "VII",
        "VIII",
        "VIIII",
        "VL",
        "VLIIIIII",
        "VLLLL",
        "Z",
        "ZI",
        "ZL",
        "[I",
        "createBitmap",
        "drawBitmap",
        "getActionMasked",
        "getHeight",
        "getWidth",
        "getX",
        "getY",
        "igi_cpu_port",
        "loadLibrary",
        "mBitmap",
        "mDstRect",
        "mPixels",
        "nativeInit",
        "nativeOnInput",
        "nativeOnTouch",
        "nativeStepFrame",
        "onCreate",
        "onDraw",
        "onTouchEvent",
        "postInvalidateOnAnimation",
        "requestWindowFeature",
        "set",
        "setContentView",
        "setPixels",
    }
    strings = sorted(raw_strings)
    sidx = {s: i for i, s in enumerate(strings)}

    type_descs = sorted([
        "F",
        "I",
        "V",
        "Z",
        "[I",
        "Landroid/app/Activity;",
        "Landroid/content/Context;",
        "Landroid/graphics/Bitmap$Config;",
        "Landroid/graphics/Bitmap;",
        "Landroid/graphics/Canvas;",
        "Landroid/graphics/Paint;",
        "Landroid/graphics/Rect;",
        "Landroid/os/Bundle;",
        "Landroid/view/MotionEvent;",
        "Landroid/view/View;",
        "Lcom/berasxcorps/igiport/CpuSurfaceView;",
        "Lcom/berasxcorps/igiport/IGICpuBridge;",
        "Lcom/berasxcorps/igiport/MainActivity;",
        "Ljava/lang/Object;",
        "Ljava/lang/String;",
        "Ljava/lang/System;",
    ], key=lambda d: sidx[d])
    tidx = {t: i for i, t in enumerate(type_descs)}

    # Protos: (shorty, return_type, [param_types])
    raw_protos = [
        ("V",        "V", []),
        ("I",        "I", []),
        ("F",        "F", []),
        ("ZI",       "Z", ["I"]),
        ("ZL",       "Z", ["Landroid/view/MotionEvent;"]),
        ("VL",       "V", ["Landroid/content/Context;"]),
        ("VL",       "V", ["Landroid/graphics/Canvas;"]),
        ("VL",       "V", ["Landroid/os/Bundle;"]),
        ("VL",       "V", ["Landroid/view/View;"]),
        ("VL",       "V", ["Ljava/lang/String;"]),
        ("VII",      "V", ["I", "I"]),
        ("VIFF",     "V", ["I", "F", "F"]),
        ("VIIII",    "V", ["I", "I", "I", "I"]),
        ("IFLI",     "I", ["F", "[I", "I"]),
        ("LIIL",     "Landroid/graphics/Bitmap;", ["I", "I", "Landroid/graphics/Bitmap$Config;"]),
        ("VLLLL",    "V", ["Landroid/graphics/Bitmap;", "Landroid/graphics/Rect;", "Landroid/graphics/Rect;", "Landroid/graphics/Paint;"]),
        ("VLIIIIII", "V", ["[I", "I", "I", "I", "I", "I", "I"]),
    ]
    raw_protos.sort(key=lambda p: (tidx[p[1]], [tidx[x] for x in p[2]]))
    pidx = {(p[1], tuple(p[2])): i for i, p in enumerate(raw_protos)}

    # Fields: (class_type, field_type, field_name) — sorted by (class_idx, name_idx, type_idx)
    raw_fields = [
        ("Landroid/graphics/Bitmap$Config;",         "Landroid/graphics/Bitmap$Config;", "ARGB_8888"),
        ("Lcom/berasxcorps/igiport/CpuSurfaceView;", "Landroid/graphics/Bitmap;",        "mBitmap"),
        ("Lcom/berasxcorps/igiport/CpuSurfaceView;", "Landroid/graphics/Rect;",          "mDstRect"),
        ("Lcom/berasxcorps/igiport/CpuSurfaceView;", "[I",                               "mPixels"),
    ]
    raw_fields.sort(key=lambda f: (tidx[f[0]], sidx[f[2]], tidx[f[1]]))
    fidx = {(f[0], f[2], f[1]): i for i, f in enumerate(raw_fields)}

    # Methods: (class_type, name, (ret, params_tuple)) — sorted by (class_idx, name_idx, proto_idx)
    raw_methods = [
        # Framework methods
        ("Landroid/app/Activity;",        "<init>",                    ("V", ())),
        ("Landroid/app/Activity;",        "onCreate",                  ("V", ("Landroid/os/Bundle;",))),
        ("Landroid/app/Activity;",        "requestWindowFeature",      ("Z", ("I",))),
        ("Landroid/app/Activity;",        "setContentView",            ("V", ("Landroid/view/View;",))),
        ("Landroid/graphics/Bitmap;",     "createBitmap",              ("Landroid/graphics/Bitmap;", ("I", "I", "Landroid/graphics/Bitmap$Config;"))),
        ("Landroid/graphics/Bitmap;",     "setPixels",                 ("V", ("[I", "I", "I", "I", "I", "I", "I"))),
        ("Landroid/graphics/Canvas;",     "drawBitmap",                ("V", ("Landroid/graphics/Bitmap;", "Landroid/graphics/Rect;", "Landroid/graphics/Rect;", "Landroid/graphics/Paint;"))),
        ("Landroid/graphics/Rect;",       "<init>",                    ("V", ())),
        ("Landroid/graphics/Rect;",       "set",                       ("V", ("I", "I", "I", "I"))),
        ("Landroid/view/MotionEvent;",    "getActionMasked",           ("I", ())),
        ("Landroid/view/MotionEvent;",    "getX",                      ("F", ())),
        ("Landroid/view/MotionEvent;",    "getY",                      ("F", ())),
        ("Landroid/view/View;",           "<init>",                    ("V", ("Landroid/content/Context;",))),
        ("Landroid/view/View;",           "getHeight",                 ("I", ())),
        ("Landroid/view/View;",           "getWidth",                  ("I", ())),
        ("Landroid/view/View;",           "postInvalidateOnAnimation", ("V", ())),
        ("Ljava/lang/Object;",            "<init>",                    ("V", ())),
        ("Ljava/lang/System;",            "loadLibrary",               ("V", ("Ljava/lang/String;",))),
        # App classes: CpuSurfaceView
        ("Lcom/berasxcorps/igiport/CpuSurfaceView;", "<init>",       ("V", ("Landroid/content/Context;",))),
        ("Lcom/berasxcorps/igiport/CpuSurfaceView;", "onDraw",       ("V", ("Landroid/graphics/Canvas;",))),
        ("Lcom/berasxcorps/igiport/CpuSurfaceView;", "onTouchEvent", ("Z", ("Landroid/view/MotionEvent;",))),
        # App classes: IGICpuBridge
        ("Lcom/berasxcorps/igiport/IGICpuBridge;",   "<clinit>",        ("V", ())),
        ("Lcom/berasxcorps/igiport/IGICpuBridge;",   "<init>",          ("V", ())),
        ("Lcom/berasxcorps/igiport/IGICpuBridge;",   "nativeInit",      ("V", ("I", "I"))),
        ("Lcom/berasxcorps/igiport/IGICpuBridge;",   "nativeOnInput",   ("V", ("I", "I", "I", "I"))),
        ("Lcom/berasxcorps/igiport/IGICpuBridge;",   "nativeOnTouch",   ("V", ("I", "F", "F"))),
        ("Lcom/berasxcorps/igiport/IGICpuBridge;",   "nativeStepFrame", ("I", ("F", "[I", "I"))),
        # App classes: MainActivity
        ("Lcom/berasxcorps/igiport/MainActivity;",   "<init>",   ("V", ())),
        ("Lcom/berasxcorps/igiport/MainActivity;",   "onCreate", ("V", ("Landroid/os/Bundle;",))),
    ]
    raw_methods.sort(key=lambda m: (tidx[m[0]], sidx[m[1]], pidx[m[2]]))
    midx = {(m[0], m[1], m[2]): i for i, m in enumerate(raw_methods)}

    def pack_code_item(regs, ins, outs, insns_u16):
        hdr = struct.pack("<HHHHII", regs, ins, outs, 0, 0, len(insns_u16))
        body = b"".join(struct.pack("<H", w & 0xFFFF) for w in insns_u16)
        blob = hdr + body
        while len(blob) % 4 != 0:
            blob += b"\x00"
        return blob

    f_argb8888 = fidx[("Landroid/graphics/Bitmap$Config;", "ARGB_8888", "Landroid/graphics/Bitmap$Config;")]
    f_mBitmap  = fidx[("Lcom/berasxcorps/igiport/CpuSurfaceView;", "mBitmap",  "Landroid/graphics/Bitmap;")]
    f_mDstRect = fidx[("Lcom/berasxcorps/igiport/CpuSurfaceView;", "mDstRect", "Landroid/graphics/Rect;")]
    f_mPixels  = fidx[("Lcom/berasxcorps/igiport/CpuSurfaceView;", "mPixels",  "[I")]

    m_loadlib      = midx[("Ljava/lang/System;", "loadLibrary", ("V", ("Ljava/lang/String;",)))]
    m_obj_init     = midx[("Ljava/lang/Object;", "<init>", ("V", ()))]
    m_act_init     = midx[("Landroid/app/Activity;", "<init>", ("V", ()))]
    m_super_create = midx[("Landroid/app/Activity;", "onCreate", ("V", ("Landroid/os/Bundle;",)))]
    m_req_win_feat = midx[("Landroid/app/Activity;", "requestWindowFeature", ("Z", ("I",)))]
    m_set_content  = midx[("Landroid/app/Activity;", "setContentView", ("V", ("Landroid/view/View;",)))]

    m_view_super   = midx[("Landroid/view/View;", "<init>", ("V", ("Landroid/content/Context;",)))]
    m_get_w        = midx[("Landroid/view/View;", "getWidth", ("I", ()))]
    m_get_h        = midx[("Landroid/view/View;", "getHeight", ("I", ()))]
    m_post_inv     = midx[("Landroid/view/View;", "postInvalidateOnAnimation", ("V", ()))]

    m_create_bmp   = midx[("Landroid/graphics/Bitmap;", "createBitmap", ("Landroid/graphics/Bitmap;", ("I", "I", "Landroid/graphics/Bitmap$Config;")))]
    m_set_pixels   = midx[("Landroid/graphics/Bitmap;", "setPixels", ("V", ("[I", "I", "I", "I", "I", "I", "I")))]
    m_draw_bmp     = midx[("Landroid/graphics/Canvas;", "drawBitmap", ("V", ("Landroid/graphics/Bitmap;", "Landroid/graphics/Rect;", "Landroid/graphics/Rect;", "Landroid/graphics/Paint;")))]
    m_rect_init    = midx[("Landroid/graphics/Rect;", "<init>", ("V", ()))]
    m_rect_set     = midx[("Landroid/graphics/Rect;", "set", ("V", ("I", "I", "I", "I")))]

    m_ev_action    = midx[("Landroid/view/MotionEvent;", "getActionMasked", ("I", ()))]
    m_ev_x         = midx[("Landroid/view/MotionEvent;", "getX", ("F", ()))]
    m_ev_y         = midx[("Landroid/view/MotionEvent;", "getY", ("F", ()))]

    m_view_ctor    = midx[("Lcom/berasxcorps/igiport/CpuSurfaceView;", "<init>", ("V", ("Landroid/content/Context;",)))]
    m_native_init  = midx[("Lcom/berasxcorps/igiport/IGICpuBridge;", "nativeInit", ("V", ("I", "I")))]
    m_step_frame   = midx[("Lcom/berasxcorps/igiport/IGICpuBridge;", "nativeStepFrame", ("I", ("F", "[I", "I")))]
    m_on_touch     = midx[("Lcom/berasxcorps/igiport/IGICpuBridge;", "nativeOnTouch", ("V", ("I", "F", "F")))]

    # Code 1: IGICpuBridge.<clinit>()V
    code_bridge_clinit = pack_code_item(1, 0, 1, [
        0x001A, sidx["igi_cpu_port"],
        0x1071, m_loadlib, 0x0000,
        0x000E,
    ])

    # Code 2: IGICpuBridge.<init>()V
    code_bridge_init = pack_code_item(1, 1, 1, [
        0x1070, m_obj_init, 0x0000,
        0x000E,
    ])

    # Code 3: CpuSurfaceView.<init>(Context)V (regs=5: v0..v2 locals, v3=this, v4=ctx)
    pix_lo = FB_PIXELS & 0xFFFF
    pix_hi = (FB_PIXELS >> 16) & 0xFFFF
    code_view_init = pack_code_item(5, 2, 3, [
        0x2070, m_view_super, 0x0043,                     # super(ctx)
        0x0013, FB_W,                                     # v0 = 640
        0x0113, FB_H,                                     # v1 = 360
        0x0262, f_argb8888,                               # v2 = Bitmap.Config.ARGB_8888
        0x3071, m_create_bmp, 0x0210,                     # Bitmap.createBitmap(v0, v1, v2)
        0x020C,                                           # move-result-object v2
        0x325B, f_mBitmap,                                # this.mBitmap = v2
        0x0214, pix_lo, pix_hi,                           # v2 = 230400
        0x2223, tidx["[I"],                               # v2 = new int[v2]
        0x325B, f_mPixels,                                # this.mPixels = v2
        0x0222, tidx["Landroid/graphics/Rect;"],          # v2 = new Rect
        0x1070, m_rect_init, 0x0002,                      # v2.<init>()
        0x325B, f_mDstRect,                               # this.mDstRect = v2
        0x2071, m_native_init, 0x0010,                    # IGICpuBridge.nativeInit(640, 360)
        0x000E,                                           # return-void
    ])

    # Code 4: CpuSurfaceView.onDraw(Canvas)V (regs=10: v0..v7 locals, v8=this, v9=canvas)
    # 0.033f = 0x3D072B02
    code_view_ondraw = pack_code_item(10, 2, 8, [
        0x0014, 0x2B02, 0x3D07,                           # v0 = 0.033f
        0x8154, f_mPixels,                                # v1 = this.mPixels
        0x0214, pix_lo, pix_hi,                           # v2 = 230400
        0x3071, m_step_frame, 0x0210,                     # IGICpuBridge.nativeStepFrame(v0, v1, v2)
        0x8054, f_mBitmap,                                # v0 = this.mBitmap (v1 still mPixels)
        0x0212,                                           # v2 = 0 (offset)
        0x0313, FB_W,                                     # v3 = 640 (stride)
        0x0412,                                           # v4 = 0 (x)
        0x0512,                                           # v5 = 0 (y)
        0x0613, FB_W,                                     # v6 = 640 (width)
        0x0713, FB_H,                                     # v7 = 360 (height)
        0x0874, m_set_pixels, 0x0000,                     # v0.setPixels(v1..v7)
        0x8054, f_mDstRect,                               # v0 = this.mDstRect
        0x0112,                                           # v1 = 0
        0x0212,                                           # v2 = 0
        0x106E, m_get_w, 0x0008,                          # this.getWidth()
        0x030A,                                           # move-result v3
        0x106E, m_get_h, 0x0008,                          # this.getHeight()
        0x040A,                                           # move-result v4
        0x546E, m_rect_set, 0x3210,                       # v0.set(0, 0, v3, v4)
        0x8154, f_mBitmap,                                # v1 = this.mBitmap
        0x0212,                                           # v2 = null (src Rect)
        0x8354, f_mDstRect,                               # v3 = this.mDstRect
        0x0412,                                           # v4 = null (Paint)
        0x546E, m_draw_bmp, 0x3219,                       # canvas.drawBitmap(v1, v2, v3, v4)
        0x106E, m_post_inv, 0x0008,                       # this.postInvalidateOnAnimation()
        0x000E,                                           # return-void
    ])

    # Code 5: CpuSurfaceView.onTouchEvent(MotionEvent)Z (regs=6: v0..v3 locals, v4=this, v5=ev)
    code_view_ontouch = pack_code_item(6, 2, 3, [
        0x106E, m_ev_action, 0x0005,                      # ev.getActionMasked()
        0x000A,                                           # move-result v0
        0x106E, m_ev_x, 0x0005,                           # ev.getX()
        0x010A,                                           # move-result v1
        0x106E, m_get_w, 0x0004,                          # this.getWidth()
        0x030A,                                           # move-result v3
        0x3382,                                           # int-to-float v3, v3
        0x31C9,                                           # div-float/2addr v1, v3
        0x106E, m_ev_y, 0x0005,                           # ev.getY()
        0x020A,                                           # move-result v2
        0x106E, m_get_h, 0x0004,                          # this.getHeight()
        0x030A,                                           # move-result v3
        0x3382,                                           # int-to-float v3, v3
        0x32C9,                                           # div-float/2addr v2, v3
        0x3071, m_on_touch, 0x0210,                       # IGICpuBridge.nativeOnTouch(v0, v1, v2)
        0x1012,                                           # const/4 v0, 1
        0x000F,                                           # return v0
    ])

    # Code 6: MainActivity.<init>()V
    code_act_init = pack_code_item(1, 1, 1, [
        0x1070, m_act_init, 0x0000,
        0x000E,
    ])

    # Code 7: MainActivity.onCreate(Bundle)V (regs=4: v0, v1 locals, v2=this, v3=bundle)
    code_act_oncreate = pack_code_item(4, 2, 2, [
        0x206F, m_super_create, 0x0032,                   # super.onCreate(bundle)
        0x1012,                                           # const/4 v0, 1 (FEATURE_NO_TITLE)
        0x206E, m_req_win_feat, 0x0002,                   # this.requestWindowFeature(1)
        0x0022, tidx["Lcom/berasxcorps/igiport/CpuSurfaceView;"],  # v0 = new CpuSurfaceView
        0x2070, m_view_ctor, 0x0020,                      # v0.<init>(this)
        0x206E, m_set_content, 0x0002,                    # this.setContentView(v0)
        0x000E,                                           # return-void
    ])

    # Deterministic section offsets (all index tables first, then contiguous data subsections)
    string_ids_off = 0x70
    type_ids_off   = string_ids_off + len(strings) * 4
    proto_ids_off  = type_ids_off + len(type_descs) * 4
    field_ids_off  = proto_ids_off + len(raw_protos) * 12
    method_ids_off = field_ids_off + len(raw_fields) * 8
    class_defs_off = method_ids_off + len(raw_methods) * 8
    data_off       = class_defs_off + 3 * 32  # 3 app classes

    data_area = bytearray()

    def align4():
        while len(data_area) % 4 != 0:
            data_area.append(0)

    # Data Subsection A: TYPE_TYPE_LIST (0x1001)
    align4()
    type_list_first_off = data_off + len(data_area)
    type_list_count = 0
    proto_param_offs = []
    for shorty, ret, params in raw_protos:
        if not params:
            proto_param_offs.append(0)
        else:
            align4()
            off = data_off + len(data_area)
            proto_param_offs.append(off)
            data_area += struct.pack("<I", len(params))
            for p in params:
                data_area += struct.pack("<H", tidx[p])
            type_list_count += 1

    # Data Subsection B: TYPE_CODE_ITEM (0x2001)
    align4()
    code_first_off = data_off + len(data_area)
    code_blobs = [
        code_bridge_clinit,
        code_bridge_init,
        code_view_init,
        code_view_ondraw,
        code_view_ontouch,
        code_act_init,
        code_act_oncreate,
    ]
    code_offs = []
    for cb in code_blobs:
        align4()
        code_offs.append(data_off + len(data_area))
        data_area += cb
    (
        off_code_bridge_clinit,
        off_code_bridge_init,
        off_code_view_init,
        off_code_view_ondraw,
        off_code_view_ontouch,
        off_code_act_init,
        off_code_act_oncreate,
    ) = code_offs

    # Data Subsection C: TYPE_STRING_DATA_ITEM (0x2002)
    string_data_first_off = data_off + len(data_area)
    string_data_offs = []
    for s in strings:
        string_data_offs.append(data_off + len(data_area))
        b = s.encode("utf-8")
        data_area += uleb128(len(s)) + b + b"\x00"

    # Data Subsection D: TYPE_CLASS_DATA_ITEM (0x2000)
    def encode_fields(entries):
        out = bytearray()
        prev = 0
        for f_id, flags in entries:
            out += uleb128(f_id - prev)
            out += uleb128(flags)
            prev = f_id
        return bytes(out)

    def encode_methods(entries):
        out = bytearray()
        prev = 0
        for m_id, flags, c_off in entries:
            out += uleb128(m_id - prev)
            out += uleb128(flags)
            out += uleb128(c_off)
            prev = m_id
        return bytes(out)

    class_data_first_off = data_off + len(data_area)

    # Class 0: CpuSurfaceView
    view_ifields = sorted([
        (f_mBitmap,  0x0012),  # private final
        (f_mDstRect, 0x0012),
        (f_mPixels,  0x0012),
    ], key=lambda x: x[0])
    view_direct = [(m_view_ctor, 0x10001, off_code_view_init)]
    view_virtual = sorted([
        (midx[("Lcom/berasxcorps/igiport/CpuSurfaceView;", "onDraw", ("V", ("Landroid/graphics/Canvas;",)))],       0x00004, off_code_view_ondraw),
        (midx[("Lcom/berasxcorps/igiport/CpuSurfaceView;", "onTouchEvent", ("Z", ("Landroid/view/MotionEvent;",)))], 0x00001, off_code_view_ontouch),
    ], key=lambda x: x[0])
    off_cdata_view = data_off + len(data_area)
    data_area += (
        uleb128(0) + uleb128(len(view_ifields)) + uleb128(len(view_direct)) + uleb128(len(view_virtual))
        + encode_fields(view_ifields)
        + encode_methods(view_direct)
        + encode_methods(view_virtual)
    )

    # Class 1: IGICpuBridge
    bridge_direct = sorted([
        (midx[("Lcom/berasxcorps/igiport/IGICpuBridge;", "<clinit>",        ("V", ()))],               0x10008, off_code_bridge_clinit),
        (midx[("Lcom/berasxcorps/igiport/IGICpuBridge;", "<init>",          ("V", ()))],               0x10001, off_code_bridge_init),
        (midx[("Lcom/berasxcorps/igiport/IGICpuBridge;", "nativeInit",      ("V", ("I", "I")))],       0x00109, 0),
        (midx[("Lcom/berasxcorps/igiport/IGICpuBridge;", "nativeOnInput",   ("V", ("I", "I", "I", "I")))], 0x00109, 0),
        (midx[("Lcom/berasxcorps/igiport/IGICpuBridge;", "nativeOnTouch",   ("V", ("I", "F", "F")))],  0x00109, 0),
        (midx[("Lcom/berasxcorps/igiport/IGICpuBridge;", "nativeStepFrame", ("I", ("F", "[I", "I")))], 0x00109, 0),
    ], key=lambda x: x[0])
    off_cdata_bridge = data_off + len(data_area)
    data_area += (
        uleb128(0) + uleb128(0) + uleb128(len(bridge_direct)) + uleb128(0)
        + encode_methods(bridge_direct)
    )

    # Class 2: MainActivity
    act_direct = [(midx[("Lcom/berasxcorps/igiport/MainActivity;", "<init>", ("V", ()))], 0x10001, off_code_act_init)]
    act_virtual = [(midx[("Lcom/berasxcorps/igiport/MainActivity;", "onCreate", ("V", ("Landroid/os/Bundle;",)))], 0x00004, off_code_act_oncreate)]
    off_cdata_act = data_off + len(data_area)
    data_area += (
        uleb128(0) + uleb128(0) + uleb128(len(act_direct)) + uleb128(len(act_virtual))
        + encode_methods(act_direct)
        + encode_methods(act_virtual)
    )

    # Data Subsection E: TYPE_MAP_LIST (0x1000) — sorted strictly by offset
    align4()
    map_off = data_off + len(data_area)
    map_items = [
        (0x0000, 1,                0),
        (0x0001, len(strings),     string_ids_off),
        (0x0002, len(type_descs),  type_ids_off),
        (0x0003, len(raw_protos),  proto_ids_off),
        (0x0004, len(raw_fields),  field_ids_off),
        (0x0005, len(raw_methods), method_ids_off),
        (0x0006, 3,                class_defs_off),
        (0x1001, type_list_count,  type_list_first_off),
        (0x2001, len(code_blobs),  code_first_off),
        (0x2002, len(strings),     string_data_first_off),
        (0x2000, 3,                class_data_first_off),
        (0x1000, 1,                map_off),
    ]
    data_area += struct.pack("<I", len(map_items))
    for mtype, msize, moff in map_items:
        data_area += struct.pack("<HHII", mtype, 0, msize, moff)

    file_size = data_off + len(data_area)
    data_size = len(data_area)

    dex = bytearray()
    dex += b"dex\n035\x00" + b"\x00" * 4 + b"\x00" * 20
    dex += struct.pack(
        "<IIIIIIIIIIIIIIIIIIII",
        file_size,
        0x70,
        0x12345678,
        0, 0,
        map_off,
        len(strings), string_ids_off,
        len(type_descs), type_ids_off,
        len(raw_protos), proto_ids_off,
        len(raw_fields), field_ids_off,
        len(raw_methods), method_ids_off,
        3, class_defs_off,
        data_size, data_off,
    )
    assert len(dex) == 0x70

    for off in string_data_offs:
        dex += struct.pack("<I", off)
    for td in type_descs:
        dex += struct.pack("<I", sidx[td])
    for (shorty, ret, params), poff in zip(raw_protos, proto_param_offs):
        dex += struct.pack("<III", sidx[shorty], tidx[ret], poff)
    for cls_t, fld_t, name_s in raw_fields:
        dex += struct.pack("<HHI", tidx[cls_t], tidx[fld_t], sidx[name_s])
    for cls_t, name_s, proto_k in raw_methods:
        dex += struct.pack("<HHI", tidx[cls_t], pidx[proto_k], sidx[name_s])

    # 3 class_def_items
    dex += struct.pack(
        "<IIIIIIII",
        tidx["Lcom/berasxcorps/igiport/CpuSurfaceView;"],
        0x0011,  # public final
        tidx["Landroid/view/View;"],
        0,
        sidx["CpuSurfaceView.java"],
        0,
        off_cdata_view,
        0,
    )
    dex += struct.pack(
        "<IIIIIIII",
        tidx["Lcom/berasxcorps/igiport/IGICpuBridge;"],
        0x0011,  # public final
        tidx["Ljava/lang/Object;"],
        0,
        sidx["IGICpuBridge.java"],
        0,
        off_cdata_bridge,
        0,
    )
    dex += struct.pack(
        "<IIIIIIII",
        tidx["Lcom/berasxcorps/igiport/MainActivity;"],
        0x0001,  # public
        tidx["Landroid/app/Activity;"],
        0,
        sidx["MainActivity.java"],
        0,
        off_cdata_act,
        0,
    )
    assert len(dex) == data_off
    dex += data_area
    assert len(dex) == file_size

    dex[12:32] = hashlib.sha1(bytes(dex[32:])).digest()
    struct.pack_into("<I", dex, 8, zlib.adler32(bytes(dex[12:])) & 0xFFFFFFFF)
    return bytes(dex)


# ==============================================================================
# 4. Icon, Readable Java Sources, 16KB ZipAlign, APK Sig v1 + APK Sig v2
# ==============================================================================
def build_launcher_icon(out_png: Path):
    img = Image.new("RGBA", (96, 96), (14, 28, 22, 255))
    d = ImageDraw.Draw(img)
    d.rectangle([3, 3, 92, 92], outline=(72, 235, 138, 255), width=3)
    d.ellipse([20, 20, 76, 76], outline=(72, 235, 138, 255), width=2)
    d.line([(48, 10), (48, 86)], fill=(72, 235, 138, 220), width=2)
    d.line([(10, 48), (86, 48)], fill=(72, 235, 138, 220), width=2)
    d.text((31, 30), "IGI", fill=(180, 255, 205, 255))
    d.text((29, 55), "CPU", fill=(255, 210, 90, 255))
    img.save(out_png)


def write_java_wrapper_sources():
    src_dir = APK_DIR / "java_src" / "com" / "berasxcorps" / "igiport"
    src_dir.mkdir(parents=True, exist_ok=True)
    (src_dir / "IGICpuBridge.java").write_text(
        """package com.berasxcorps.igiport;

public final class IGICpuBridge {
    static {
        System.loadLibrary("igi_cpu_port");
    }

    public static native void nativeInit(int width, int height);
    public static native int nativeStepFrame(float dt, int[] outArgb, int maxPixels);
    public static native void nativeOnInput(int dikCode, int down, int lookDx, int lookDy);
    public static native void nativeOnTouch(int action, float normX, float normY);
}
"""
    )
    (src_dir / "CpuSurfaceView.java").write_text(
        """package com.berasxcorps.igiport;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Rect;
import android.view.MotionEvent;
import android.view.View;

public final class CpuSurfaceView extends View {
    private final Bitmap mBitmap;
    private final int[] mPixels;
    private final Rect mDstRect;

    public CpuSurfaceView(Context ctx) {
        super(ctx);
        mBitmap = Bitmap.createBitmap(640, 360, Bitmap.Config.ARGB_8888);
        mPixels = new int[230400];
        mDstRect = new Rect();
        IGICpuBridge.nativeInit(640, 360);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        IGICpuBridge.nativeStepFrame(0.033f, mPixels, 230400);
        mBitmap.setPixels(mPixels, 0, 640, 0, 0, 640, 360);
        mDstRect.set(0, 0, getWidth(), getHeight());
        canvas.drawBitmap(mBitmap, null, mDstRect, null);
        postInvalidateOnAnimation();
    }

    @Override
    public boolean onTouchEvent(MotionEvent ev) {
        int action = ev.getActionMasked();
        float nx = ev.getX() / (float) getWidth();
        float ny = ev.getY() / (float) getHeight();
        IGICpuBridge.nativeOnTouch(action, nx, ny);
        return true;
    }
}
"""
    )
    (src_dir / "MainActivity.java").write_text(
        """package com.berasxcorps.igiport;

import android.app.Activity;
import android.os.Bundle;
import android.view.Window;

public class MainActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        setContentView(new CpuSurfaceView(this));
    }
}
"""
    )


def generate_or_load_signing_identity():
    key_pem = APK_DIR / "signer_key.pem"
    cert_pem = APK_DIR / "cert.pem"
    if not key_pem.exists() or not cert_pem.exists():
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-keyout", str(key_pem), "-out", str(cert_pem),
            "-days", "3650", "-subj", "/CN=BerasXcorps IGI CPU Port/O=BerasXcorps/C=ID",
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    priv_key = serialization.load_pem_private_key(key_pem.read_bytes(), password=None)
    cert_obj = x509.load_pem_x509_certificate(cert_pem.read_bytes())
    return key_pem, cert_pem, priv_key, cert_obj


def sign_v1_jar(entries: dict, key_pem: Path, cert_pem: Path) -> dict:
    """Create META-INF/MANIFEST.MF, CERT.SF (with X-Android-APK-Signed: 2), and PKCS#7 CERT.RSA."""
    manifest_buf = bytearray(b"Manifest-Version: 1.0\r\nCreated-By: 1.0 (BerasXcorps APK Compiler)\r\n\r\n")
    sf_sections = bytearray()

    for name, raw in entries.items():
        dig = base64.b64encode(hashlib.sha256(raw).digest()).decode("ascii")
        sec = f"Name: {name}\r\nSHA-256-Digest: {dig}\r\n\r\n".encode("utf-8")
        manifest_buf += sec
        sdig = base64.b64encode(hashlib.sha256(sec).digest()).decode("ascii")
        sf_sections += f"Name: {name}\r\nSHA-256-Digest: {sdig}\r\n\r\n".encode("utf-8")

    manifest_bytes = bytes(manifest_buf)
    mf_sha256 = base64.b64encode(hashlib.sha256(manifest_bytes).digest()).decode("ascii")
    cert_sf_bytes = (
        f"Signature-Version: 1.0\r\n"
        f"Created-By: 1.0 (BerasXcorps APK Signer)\r\n"
        f"X-Android-APK-Signed: 2\r\n"
        f"SHA-256-Digest-Manifest: {mf_sha256}\r\n\r\n"
    ).encode("utf-8") + bytes(sf_sections)

    with tempfile.TemporaryDirectory() as td:
        sf_file = Path(td) / "CERT.SF"
        rsa_der = Path(td) / "CERT.RSA"
        sf_file.write_bytes(cert_sf_bytes)
        subprocess.run([
            "openssl", "cms", "-sign", "-binary", "-noattr",
            "-in", str(sf_file), "-signer", str(cert_pem), "-inkey", str(key_pem),
            "-outform", "DER", "-out", str(rsa_der), "-md", "sha256",
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cert_rsa_bytes = rsa_der.read_bytes()

    return {
        "META-INF/MANIFEST.MF": manifest_bytes,
        "META-INF/CERT.SF": cert_sf_bytes,
        "META-INF/CERT.RSA": cert_rsa_bytes,
    }


def write_zipaligned_apk_bytes(all_files: list) -> bytes:
    """Build ZIP ensuring resources.arsc is 4-byte aligned and *.so are 16KB-aligned (Android 15 ready)."""
    with tempfile.NamedTemporaryFile(delete=False) as tf:
        tmp_name = Path(tf.name)
    try:
        uncompressed_names = {"resources.arsc", "res/drawable-mdpi/ic_launcher.png"}
        with zipfile.ZipFile(tmp_name, "w") as zf:
            for arcname, payload in all_files:
                store = arcname in uncompressed_names or arcname.endswith(".so")
                zi = zipfile.ZipInfo(arcname, date_time=(2026, 10, 27, 12, 0, 0))
                zi.compress_type = zipfile.ZIP_STORED if store else zipfile.ZIP_DEFLATED
                zi.create_system = 3
                zi.external_attr = 0o644 << 16
                if store:
                    cur_pos = zf.fp.tell()
                    data_start = cur_pos + 30 + len(arcname.encode("utf-8"))
                    align = 16384 if arcname.endswith(".so") else 4
                    pad = (align - (data_start % align)) % align
                    zi.extra = b"\x00" * pad
                zf.writestr(zi, payload)
        return tmp_name.read_bytes()
    finally:
        tmp_name.unlink(missing_ok=True)


def v2_prefixed(*parts: bytes) -> bytes:
    body = b"".join(parts)
    return struct.pack("<I", len(body)) + body


def compute_v2_merkle_digest(before_cd: bytes, central_dir: bytes, eocd_with_orig_cd_off: bytes) -> bytes:
    chunk_digests = []
    for section in (before_cd, central_dir, eocd_with_orig_cd_off):
        mv = memoryview(section)
        pos = 0
        n = len(mv)
        while pos < n:
            clen = min(1 << 20, n - pos)
            h = hashlib.sha256()
            h.update(b"\xa5")
            h.update(struct.pack("<I", clen))
            h.update(mv[pos : pos + clen])
            chunk_digests.append(h.digest())
            pos += clen
    top = hashlib.sha256()
    top.update(b"\x5a")
    top.update(struct.pack("<I", len(chunk_digests)))
    for cd in chunk_digests:
        top.update(cd)
    return top.digest()


def sign_v2_apk(apk_bytes: bytes, priv_key, cert_obj) -> bytes:
    """Insert APK Signature Scheme v2 Signing Block ('APK Sig Block 42', ID 0x7109871a)."""
    eocd_off = len(apk_bytes) - 22
    magic, _, _, _, _, cd_size, cd_off, comment_len = struct.unpack_from("<IHHHHIIH", apk_bytes, eocd_off)
    assert magic == 0x06054B50 and comment_len == 0, "Invalid EOCD layout"
    assert cd_off + cd_size == eocd_off, "Central directory must immediately precede EOCD"

    before_cd = apk_bytes[:cd_off]
    central_dir = apk_bytes[cd_off:eocd_off]
    eocd = bytearray(apk_bytes[eocd_off:])
    struct.pack_into("<I", eocd, 16, cd_off)

    digest = compute_v2_merkle_digest(before_cd, central_dir, bytes(eocd))

    ALGO_RSA_PKCS1_V1_5_SHA256 = 0x0103
    ALGO_ATTR_STRIPPING_PROT   = 0xBEEFF00D

    cert_der = cert_obj.public_bytes(serialization.Encoding.DER)
    spki_der = priv_key.public_key().public_bytes(
        serialization.Encoding.DER,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )

    digests_seq = v2_prefixed(v2_prefixed(struct.pack("<I", ALGO_RSA_PKCS1_V1_5_SHA256), v2_prefixed(digest)))
    certs_seq = v2_prefixed(v2_prefixed(cert_der))
    attrs_seq = v2_prefixed(v2_prefixed(struct.pack("<II", ALGO_ATTR_STRIPPING_PROT, 2)))
    signed_data = digests_seq + certs_seq + attrs_seq

    signature = priv_key.sign(signed_data, padding.PKCS1v15(), hashes.SHA256())
    sigs_seq = v2_prefixed(v2_prefixed(struct.pack("<I", ALGO_RSA_PKCS1_V1_5_SHA256), v2_prefixed(signature)))

    signer = v2_prefixed(signed_data) + sigs_seq + v2_prefixed(spki_der)
    v2_value = v2_prefixed(v2_prefixed(signer))

    pair_body = struct.pack("<I", 0x7109871A) + v2_value
    pair = struct.pack("<Q", len(pair_body)) + pair_body

    # Pad APK Signing Block to multiple of 4096 bytes using Android's official verity padding block (0x42726577)
    raw_total = 8 + len(pair) + 8 + 16
    if raw_total % 4096 != 0:
        need = (4096 - (raw_total % 4096)) % 4096
        if need < 12:
            need += 4096
        pad_val_len = need - 12
        pad_pair_body = struct.pack("<I", 0x42726577) + (b"\x00" * pad_val_len)
        pair += struct.pack("<Q", len(pad_pair_body)) + pad_pair_body

    size_of_block = len(pair) + 8 + 16
    sig_block = (
        struct.pack("<Q", size_of_block)
        + pair
        + struct.pack("<Q", size_of_block)
        + b"APK Sig Block 42"
    )
    assert len(sig_block) % 4096 == 0

    struct.pack_into("<I", eocd, 16, cd_off + len(sig_block))
    return before_cd + sig_block + central_dir + bytes(eocd)


def verify_apk_complete(apk_path: Path):
    """Verify AXML, ARSC, DEX Dalvik bytecode, 16KB alignment, v1 JAR sig, and v2 Merkle RSA sig."""
    from loguru import logger
    logger.disable("androguard")
    from androguard.core.apk import APK
    from androguard.core.dex import DEX

    raw = apk_path.read_bytes()
    a = APK(str(apk_path))
    assert not a.axml["AndroidManifest.xml"].is_packed(), "AXML packerwarning triggered!"
    assert a.get_package() == "com.berasxcorps.igiport"
    assert a.get_main_activity() == "com.berasxcorps.igiport.MainActivity"
    assert a.is_signed_v1(), "v1 signature missing!"
    assert a.is_signed_v2(), "v2 signature missing!"

    # Cryptographically verify APK Signature Scheme v2 Merkle digest + RSA-2048 signature
    eocd_off = len(raw) - 22
    _, _, _, _, _, cd_size, cd_off, _ = struct.unpack_from("<IHHHHIIH", raw, eocd_off)
    sb_size, sb_magic = struct.unpack_from("<Q16s", raw, cd_off - 24)
    assert sb_magic == b"APK Sig Block 42"
    sb_start = cd_off - 8 - sb_size
    before_cd = raw[:sb_start]
    central_dir = raw[cd_off:eocd_off]
    eocd_check = bytearray(raw[eocd_off:])
    struct.pack_into("<I", eocd_check, 16, sb_start)
    expected_digest = compute_v2_merkle_digest(before_cd, central_dir, bytes(eocd_check))

    a.parse_v2_signing_block()
    signer = a._v2_signing_data[0]
    algo_id, stored_digest = signer.signed_data.digests[0]
    assert algo_id == 0x0103 and stored_digest == expected_digest, "v2 Merkle digest mismatch!"
    sig_algo, sig_bytes = signer.signatures[0]
    pub_key = serialization.load_der_public_key(signer.public_key)
    pub_key.verify(sig_bytes, signer.signed_data._bytes, padding.PKCS1v15(), hashes.SHA256())

    # Verify DEX classes & disassemble all methods via Androguard
    d = DEX(a.get_dex())
    cls_names = [c.get_name() for c in d.get_classes()]
    method_dump = []
    for c in d.get_classes():
        for m in c.get_methods():
            code = m.get_code()
            ins_count = 0
            ins_preview = []
            if code:
                bc = code.get_bc()
                ins_list = list(bc.get_instructions())
                ins_count = len(ins_list)
                ins_preview = [f"      {ins.get_name():24s} {ins.get_output()}" for ins in ins_list]
            method_dump.append(f"{m.get_class_name()}->{m.get_name()}{m.get_descriptor()} [insns={ins_count}]")
            method_dump.extend(ins_preview)

    # Verify ZIP alignment
    align_lines = []
    with zipfile.ZipFile(apk_path, "r") as zf:
        for info in zf.infolist():
            f_off = info.header_offset + 30 + len(info.filename.encode("utf-8")) + len(info.extra)
            a4 = (f_off % 4 == 0)
            a16k = (f_off % 16384 == 0)
            if info.filename == "resources.arsc":
                assert info.compress_type == zipfile.ZIP_STORED and a4, "resources.arsc must be STORED & 4B aligned!"
            if info.filename.endswith(".so"):
                assert info.compress_type == zipfile.ZIP_STORED and a16k, f"{info.filename} must be STORED & 16KB aligned!"
            align_lines.append(
                f"{info.filename:40s} size={info.file_size:9d} comp={info.compress_type} "
                f"off=0x{f_off:08X} align4={str(a4):5s} align16k={str(a16k):5s}"
            )

    return {
        "package": a.get_package(),
        "version_name": a.get_androidversion_name(),
        "version_code": a.get_androidversion_code(),
        "min_sdk": a.get_min_sdk_version(),
        "target_sdk": a.get_target_sdk_version(),
        "main_activity": a.get_main_activity(),
        "signed_v1": a.is_signed_v1(),
        "signed_v2": a.is_signed_v2(),
        "v2_merkle_sha256": expected_digest.hex(),
        "classes": cls_names,
        "methods": method_dump,
        "alignment": align_lines,
    }


def main():
    APK_DIR.mkdir(parents=True, exist_ok=True)
    write_java_wrapper_sources()

    icon_tmp = APK_DIR / "ic_launcher.png"
    build_launcher_icon(icon_tmp)

    manifest_bin = build_binary_android_manifest()
    arsc_bin = build_resources_arsc()
    dex_bin = build_classes_dex()

    arm64_so = (APK_DIR / "jniLibs" / "arm64-v8a" / "libigi_cpu_port.so").read_bytes()
    x86_64_so = (APK_DIR / "jniLibs" / "x86_64" / "libigi_cpu_port.so").read_bytes()

    res_bytes = (BASE_DIR / "reverse_inspection" / "res_roundtrip" / "qed_bundle.res").read_bytes()
    qvm_obj = (BASE_DIR / "extracted_assets" / "missions" / "location0" / "level1" / "objects.qvm").read_bytes()
    qvm_ter = (BASE_DIR / "extracted_assets" / "missions" / "location0" / "level1" / "terrain" / "terrain.qvm").read_bytes()
    sky_tex = (BASE_DIR / "extracted_assets" / "missions" / "location0" / "common" / "textures" / "sky_layer1.tex").read_bytes()
    cfg_bytes = (
        b"driver=cpu_software_d3d7\n"
        b"hardware_accelerated=0\n"
        b"abis=arm64-v8a,x86_64\n"
        b"resolution=640x360\n"
        b"audio=pcm_sw_44100\n"
        b"recompiled_functions=5712\n"
        b"embedded_mission=level1_trainyard_66_entities\n"
    )

    payload_entries = {
        "AndroidManifest.xml": manifest_bin,
        "resources.arsc": arsc_bin,
        "classes.dex": dex_bin,
        "res/drawable-mdpi/ic_launcher.png": icon_tmp.read_bytes(),
        "lib/arm64-v8a/libigi_cpu_port.so": arm64_so,
        "lib/x86_64/libigi_cpu_port.so": x86_64_so,
        "assets/igi/cpu_driver.cfg": cfg_bytes,
        "assets/igi/qed_bundle.res": res_bytes,
        "assets/igi/level1_objects.qvm": qvm_obj,
        "assets/igi/level1_terrain.qvm": qvm_ter,
        "assets/igi/sky_layer1.tex": sky_tex,
    }

    key_pem, cert_pem, priv_key, cert_obj = generate_or_load_signing_identity()
    sig_v1_entries = sign_v1_jar(payload_entries, key_pem, cert_pem)

    ordered = list(payload_entries.items()) + list(sig_v1_entries.items())
    v1_aligned_bytes = write_zipaligned_apk_bytes(ordered)
    final_v1_v2_bytes = sign_v2_apk(v1_aligned_bytes, priv_key, cert_obj)
    OUT_APK.write_bytes(final_v1_v2_bytes)

    ver = verify_apk_complete(OUT_APK)
    report_lines = [
        f"APK File        : {OUT_APK.name}",
        f"Size            : {OUT_APK.stat().st_size:,} bytes ({OUT_APK.stat().st_size / 1048576:.2f} MB)",
        f"SHA-256         : {hashlib.sha256(final_v1_v2_bytes).hexdigest()}",
        f"Package         : {ver['package']} (v{ver['version_name']} / code {ver['version_code']})",
        f"SDK Levels      : minSdkVersion={ver['min_sdk']}, targetSdkVersion={ver['target_sdk']}",
        f"Main Activity   : {ver['main_activity']}",
        f"Signatures      : v1={ver['signed_v1']} (JAR PKCS#7) + v2={ver['signed_v2']} (APK Sig Block 42 RSA-2048 SHA-256)",
        f"v2 Merkle Digest: {ver['v2_merkle_sha256']}",
        "",
        "=== Verified DEX Classes & Dalvik Bytecode Methods ===",
        *[f"  {m}" for m in ver["methods"]],
        "",
        "=== Verified ZIP Alignment (4B resources.arsc + 16KB Native .so) ===",
        *[f"  {line}" for line in ver["alignment"]],
    ]
    report_txt = "\n".join(report_lines) + "\n"
    (APK_DIR / "APK_VERIFY_REPORT.txt").write_text(report_txt)
    print(report_txt)


if __name__ == "__main__":
    main()
