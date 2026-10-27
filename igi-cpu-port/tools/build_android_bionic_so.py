#!/usr/bin/env python3
"""
Cross-compile Project I.G.I.: I'm Going In Full PC Port (5,712 statically recompiled
x86 functions + 23 native C11 performance modules + Direct3D 7 / DirectDraw 7 /
OpenSL ES DirectSound + Case-Insensitive NTFS VFS + All-14-Missions Campaign)
to native Android Bionic API 24 shared libraries (arm64-v8a + x86_64) via Zig CC.
"""
import concurrent.futures
import glob
import os
import shutil
import subprocess
import sys
import time

PORT_ROOT = "/home/user/BerasXcorps/igi-cpu-port"
PROBE = "/tmp/igi_probe"
SDK_SRC = "/tmp/gd_android/cmd/gd/internal/builder/bundled/android"
SDK_DIR = "/tmp/android_sdk"


def ensure_android_sdk():
    for triple in ["aarch64-linux-android", "x86_64-linux-android"]:
        libc_txt = os.path.join(SDK_DIR, "usr", "lib", triple, "libc.txt")
        crt_o = os.path.join(SDK_DIR, "usr", "lib", triple, "crtbegin_so.o")
        if os.path.exists(libc_txt) and os.path.exists(crt_o):
            continue
        if os.path.exists(SDK_DIR):
            shutil.rmtree(SDK_DIR)
        shutil.copytree(SDK_SRC, SDK_DIR)
        for tr in ["aarch64-linux-android", "x86_64-linux-android"]:
            inc = os.path.join(SDK_DIR, "usr", "include")
            inc_arch = os.path.join(SDK_DIR, "usr", "include", tr)
            libdir = os.path.join(SDK_DIR, "usr", "lib", tr)
            for cfile in sorted(glob.glob(os.path.join(libdir, "*.c"))):
                name = os.path.splitext(os.path.basename(cfile))[0]
                subprocess.run([
                    "python3", "-m", "ziglang", "cc",
                    "-target", tr, "-shared", "-nostdlib", "-fno-builtin", "-w",
                    f"-Wl,-soname,{name}.so", "-o", os.path.join(libdir, f"{name}.so"), cfile
                ], check=True)
            ltxt = os.path.join(libdir, "libc.txt")
            with open(ltxt, "w") as f:
                f.write(
                    f"include_dir={inc}\n"
                    f"sys_include_dir={inc_arch}\n"
                    f"cc_dir={libdir}\n"
                    f"crt_dir={libdir}\n"
                    f"msvc_lib_dir=\n"
                    f"kernel32_lib_dir=\n"
                    f"darwin_sdk_dir=\n"
                )
            env = dict(os.environ, ZIG_LIBC=ltxt)
            for crt in ["crtbegin_so", "crtend_so"]:
                subprocess.run([
                    "python3", "-m", "ziglang", "cc",
                    "-target", f"{tr}.24", "-fPIC", "-O2", "-fvisibility=hidden",
                    "-c", os.path.join(SDK_DIR, "usr", "lib", f"{crt}.c"),
                    "-o", os.path.join(libdir, f"{crt}.o")
                ], env=env, check=True)
        break


def collect_sources():
    wrapper_srcs = sorted(glob.glob(f"{PORT_ROOT}/src/*.c"))
    rt_srcs = [
        p for p in sorted(glob.glob(f"{PROBE}/igi_recomp/runtime/src/*.c"))
        if os.path.basename(p) not in {"main.c"}
    ]
    shim_exclude = {
        "platform_sdl.c",
        "platform_vita.c",
        "render_backend.c",
        "render_gl.c",
        "render_queue.c",
    }
    patched_dir = "/tmp/igi_patched_shim"
    os.makedirs(patched_dir, exist_ok=True)
    orig_k32 = f"{PROBE}/igi_recomp/shim/src/kernel32.c"
    patched_k32 = os.path.join(patched_dir, "kernel32.c")
    with open(orig_k32, "r", encoding="utf-8") as f:
        k32_src = f.read()
    assert "void win_path_to_host(" in k32_src, "Expected win_path_to_host in kernel32.c"
    k32_patched = k32_src.replace(
        "void win_path_to_host(const char *win, char *out, size_t out_size)",
        "void __orig_win_path_to_host(const char *win, char *out, size_t out_size)",
        1,
    )
    if not os.path.exists(patched_k32) or open(patched_k32, "r", encoding="utf-8").read() != k32_patched:
        with open(patched_k32, "w", encoding="utf-8") as f:
            f.write(k32_patched)

    shim_srcs = []
    for p in sorted(glob.glob(f"{PROBE}/igi_recomp/shim/src/*.c")):
        bn = os.path.basename(p)
        if bn in shim_exclude:
            continue
        shim_srcs.append(patched_k32 if bn == "kernel32.c" else p)
    recomp_srcs = sorted(glob.glob(f"{PROBE}/gen_out/*.c"))
    return wrapper_srcs, rt_srcs, shim_srcs, recomp_srcs


def build_abi(abi_name, triple):
    t0 = time.time()
    libdir = os.path.join(SDK_DIR, "usr", "lib", triple)
    libc_txt = os.path.join(libdir, "libc.txt")
    env = dict(os.environ, ZIG_LIBC=libc_txt)

    obj_dir = f"/tmp/obj_android_v1_{abi_name}"
    os.makedirs(obj_dir, exist_ok=True)

    wrapper_srcs, rt_srcs, shim_srcs, recomp_srcs = collect_sources()
    all_jobs = []
    for p in wrapper_srcs + rt_srcs + shim_srcs:
        opt = "-O2"
        extra = ["-Dmain=igi_cpu_recomp_main"] if os.path.basename(p) == "main_cpu_wrapper.c" else []
        all_jobs.append((p, opt, extra, "host"))
    for p in recomp_srcs:
        all_jobs.append((p, "-O1", [], "recomp"))

    inc_flags = [
        f"-I{PORT_ROOT}/include",
        f"-I{PROBE}/igi_recomp/runtime/include",
        f"-I{PROBE}/igi_recomp/shim/include",
        f"-I{PROBE}/gen_out",
    ]

    objs = []

    def compile_one(job):
        src, opt, extra, tag = job
        out_o = os.path.join(obj_dir, f"{tag}_{os.path.basename(src)}.o")
        if os.path.exists(out_o) and os.path.getmtime(out_o) >= os.path.getmtime(src) and PORT_ROOT not in src and "igi_patched_shim" not in src:
            return out_o
        cmd = [
            "python3", "-m", "ziglang", "cc",
            "-target", f"{triple}.24",
            opt, "-fPIC", "-D_GNU_SOURCE", "-w",
            *inc_flags,
            *extra,
            "-c", src, "-o", out_o,
        ]
        res = subprocess.run(cmd, env=env, capture_output=True, text=True)
        if res.returncode != 0:
            raise RuntimeError(f"Compile failed for {src} ({abi_name}):\n{res.stderr}")
        return out_o

    print(f"[{abi_name}] Compiling {len(all_jobs)} translation units for {triple}.24 ...")
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        futs = [ex.submit(compile_one, j) for j in all_jobs]
        for idx, fut in enumerate(concurrent.futures.as_completed(futs), 1):
            objs.append(fut.result())
            if idx % 25 == 0 or idx == len(all_jobs):
                print(f"  [{abi_name}] {idx}/{len(all_jobs)} TUs compiled ({time.time() - t0:.1f}s)")

    out_dir = f"/tmp/jniLibs_v1/{abi_name}"
    os.makedirs(out_dir, exist_ok=True)
    out_so = os.path.join(out_dir, "libigi_cpu_port.so")

    link_cmd = [
        "python3", "-m", "ziglang", "cc",
        "-target", f"{triple}.24",
        "-shared", "-fPIC",
        f"-L{libdir}",
        "-Wl,-soname,libigi_cpu_port.so",
        "-Wl,-z,max-page-size=16384",
        "-Wl,--wrap=win_path_to_host",
        "-Wl,-u,igi_cpu_recomp_main",
        "-Wl,-s",
        *sorted(objs),
        "-lOpenSLES", "-lz", "-llog", "-lm", "-lc",
        "-o", out_so,
    ]
    res = subprocess.run(link_cmd, env=env, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"Link failed for {abi_name}:\n{res.stderr}")

    sz = os.path.getsize(out_so)
    print(f"[{abi_name}] Linked {out_so} ({sz:,} bytes / {sz/1048576:.2f} MB) in {time.time() - t0:.1f}s")
    return out_so


def build_linux_host():
    t0 = time.time()
    obj_dir = "/tmp/obj_linux_host_v1"
    os.makedirs(obj_dir, exist_ok=True)
    wrapper_srcs, rt_srcs, shim_srcs, recomp_srcs = collect_sources()
    all_jobs = []
    for p in wrapper_srcs + rt_srcs + shim_srcs:
        extra = ["-Dmain=igi_cpu_recomp_main"] if os.path.basename(p) == "main_cpu_wrapper.c" else []
        all_jobs.append((p, "-O2", extra, "host"))
    for p in recomp_srcs:
        all_jobs.append((p, "-O1", [], "recomp"))
    inc_flags = [
        f"-I{PORT_ROOT}/include",
        f"-I{PROBE}/igi_recomp/runtime/include",
        f"-I{PROBE}/igi_recomp/shim/include",
        f"-I{PROBE}/gen_out",
    ]
    objs = []

    def compile_one(job):
        src, opt, extra, tag = job
        out_o = os.path.join(obj_dir, f"{tag}_{os.path.basename(src)}.o")
        if os.path.exists(out_o) and os.path.getmtime(out_o) >= os.path.getmtime(src) and PORT_ROOT not in src and "igi_patched_shim" not in src:
            return out_o
        cmd = ["gcc", opt, "-fPIC", "-D_GNU_SOURCE", "-w", *inc_flags, *extra, "-c", src, "-o", out_o]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            raise RuntimeError(f"Host compile failed for {src}:\n{res.stderr}")
        return out_o

    print(f"[linux-x86_64] Compiling {len(all_jobs)} TUs ...")
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        for fut in concurrent.futures.as_completed([ex.submit(compile_one, j) for j in all_jobs]):
            objs.append(fut.result())

    out_so = "/tmp/libigi_pc_host_linux.so"
    link_cmd = [
        "gcc", "-shared", "-fPIC",
        "-Wl,-u,igi_cpu_recomp_main",
        *sorted(objs),
        "/lib/x86_64-linux-gnu/libz.so.1", "-lpthread", "-lm",
        "-o", out_so,
    ]
    res = subprocess.run(link_cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"Host link failed:\n{res.stderr}")
    print(f"[linux-x86_64] Linked {out_so} ({os.path.getsize(out_so):,} bytes) in {time.time() - t0:.1f}s")
    return out_so


if __name__ == "__main__":
    if "--linux-host" in sys.argv:
        build_linux_host()
        sys.exit(0)
    ensure_android_sdk()
    targets = [
        ("arm64-v8a", "aarch64-linux-android"),
        ("x86_64", "x86_64-linux-android"),
    ]
    if len(sys.argv) > 1:
        targets = [t for t in targets if t[0] in sys.argv[1:]]
    for abi, tr in targets:
        build_abi(abi, tr)
