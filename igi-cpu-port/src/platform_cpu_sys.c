/*
 * Pure CPU / System Driver Platform Layer for Project I.G.I. Static Recompilation
 * Replaces SDL2 + OpenGL context creation with a zero-GPU POSIX system driver,
 * software PCM audio thread, and shared framebuffer/input IPC for Web & Android wrappers.
 */
#include "platform.h"
#include "runtime.h"
#include <SDL.h>
#include <fcntl.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static int s_mode_w = 640;
static int s_mode_h = 480;
static int s_shown = 0;
static char s_title[128] = "Project I.G.I. [CPU Software Rasterizer]";

/* ---- Software PCM Audio Driver ---- */
static pthread_mutex_t s_audio_mtx = PTHREAD_MUTEX_INITIALIZER;
static SDL_AudioSpec s_audio_spec;
static volatile int s_audio_running = 0;
static volatile int s_audio_paused = 1;
static pthread_t s_audio_thread;

static void *audio_driver_loop(void *arg)
{
    (void)arg;
    uint8_t pcm_buf[4096];
    while (s_audio_running) {
        if (!s_audio_paused && s_audio_spec.callback) {
            pthread_mutex_lock(&s_audio_mtx);
            memset(pcm_buf, 0, sizeof(pcm_buf));
            int bytes = (int)s_audio_spec.samples * (int)s_audio_spec.channels * 2;
            if (bytes <= 0 || bytes > (int)sizeof(pcm_buf))
                bytes = 2048;
            s_audio_spec.callback(s_audio_spec.userdata, pcm_buf, bytes);
            pthread_mutex_unlock(&s_audio_mtx);
        }
        usleep(20000); /* ~50 Hz software mixer tick */
    }
    return NULL;
}

SDL_AudioDeviceID igi_sys_audio_open(const SDL_AudioSpec *want, SDL_AudioSpec *have)
{
    if (!want)
        return 0;
    s_audio_spec = *want;
    if (have)
        *have = *want;
    if (!s_audio_running) {
        s_audio_running = 1;
        pthread_create(&s_audio_thread, NULL, audio_driver_loop, NULL);
        pthread_detach(s_audio_thread);
    }
    rt_log("[cpu-sys] Software PCM audio driver initialized (%d Hz, %d ch)", want->freq, want->channels);
    return 1u;
}

void igi_sys_audio_pause(SDL_AudioDeviceID dev, int pause_on)
{
    (void)dev;
    s_audio_paused = pause_on ? 1 : 0;
}

void igi_sys_audio_lock(SDL_AudioDeviceID dev)
{
    (void)dev;
    pthread_mutex_lock(&s_audio_mtx);
}

void igi_sys_audio_unlock(SDL_AudioDeviceID dev)
{
    (void)dev;
    pthread_mutex_unlock(&s_audio_mtx);
}

/* ---- Platform Window & Video Mode ---- */
void platform_init(void)
{
    rt_log("[cpu-sys] Initialized headless POSIX/CPU system driver (no GPU/X11/SDL2)");
}

void platform_create_window(int w, int h, const char *title)
{
    if (w > 0 && h > 0) {
        s_mode_w = w;
        s_mode_h = h;
    }
    if (title)
        snprintf(s_title, sizeof(s_title), "%s", title);
    rt_log("[cpu-sys] Created virtual software window %dx%d title='%s'", s_mode_w, s_mode_h, s_title);
}

void platform_show_window(int show)
{
    s_shown = show;
    if (show) {
        user32_post_message(0x001C, 1, 0); /* WM_ACTIVATEAPP */
        user32_post_message(0x0006, 1, 0); /* WM_ACTIVATE */
    }
}

void platform_set_title(const char *title)
{
    if (title)
        snprintf(s_title, sizeof(s_title), "%s", title);
}

void platform_shutdown(void)
{
    s_audio_running = 0;
    s_audio_paused = 1;
}

void platform_set_video_mode(int w, int h)
{
    if (w > 0 && h > 0) {
        s_mode_w = w;
        s_mode_h = h;
    }
    platform_show_window(1);
    rt_log("[cpu-sys] Video mode set to %dx%d (32-bit RGBA CPU framebuffer)", s_mode_w, s_mode_h);
}

void platform_get_video_mode(int *w, int *h)
{
    if (w) *w = s_mode_w;
    if (h) *h = s_mode_h;
}

void platform_get_drawable_size(int *w, int *h)
{
    if (w) *w = s_mode_w;
    if (h) *h = s_mode_h;
}

extern void cpu_sw_export_frame(void);

void platform_swap(void)
{
    cpu_sw_export_frame();
}

void platform_gl_init(void) {}
void platform_gl_release(void) {}
void platform_service_main(void) {}
void platform_show_cursor(int show) { (void)show; }
void platform_capture_mouse(int on) { (void)on; }

/* ---- External Input Command Pipe (/tmp/igi_cpu_input.cmd) ---- */
static void poll_external_input_file(void)
{
    const char *path = getenv("IGI_CMD_PIPE");
    if (!path)
        path = "/tmp/igi_cpu_input.cmd";
    FILE *f = fopen(path, "r+");
    if (!f)
        return;
    char line[128];
    int got_any = 0;
    while (fgets(line, sizeof(line), f)) {
        got_any = 1;
        unsigned int dik = 0;
        int down = 0, mx = 0, my = 0;
        if (sscanf(line, "key %x %d", &dik, &down) == 2) {
            platform_key((uint8_t)dik, down);
        } else if (sscanf(line, "mouse %d %d", &mx, &my) == 2) {
            g_mouse.dx += mx;
            g_mouse.dy += my;
            g_mouse.x += mx;
            g_mouse.y += my;
            if (g_mouse.x < 0) g_mouse.x = 0;
            if (g_mouse.y < 0) g_mouse.y = 0;
            if (g_mouse.x >= s_mode_w) g_mouse.x = s_mode_w - 1;
            if (g_mouse.y >= s_mode_h) g_mouse.y = s_mode_h - 1;
            user32_post_message(0x0200, 0, ((uint32_t)g_mouse.y << 16) | ((uint32_t)g_mouse.x & 0xFFFFu));
        } else if (strncmp(line, "click", 5) == 0) {
            g_mouse.buttons[0] = 0x80;
            user32_post_message(0x0201, 0, ((uint32_t)g_mouse.y << 16) | ((uint32_t)g_mouse.x & 0xFFFFu));
            user32_post_message(0x0202, 0, ((uint32_t)g_mouse.y << 16) | ((uint32_t)g_mouse.x & 0xFFFFu));
            g_mouse.buttons[0] = 0;
        }
    }
    if (got_any) {
        if (ftruncate(fileno(f), 0) != 0) {}
    }
    fclose(f);
}

void platform_pump(void)
{
    static uint64_t last_ns;
    uint64_t now = SDL_GetPerformanceCounter();
    if (last_ns && now - last_ns < 2000000ULL)
        return;
    last_ns = now;
    platform_scripted_input();
    poll_external_input_file();
}

void platform_wait(void)
{
    usleep(8000);
    platform_pump();
}
