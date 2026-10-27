/*
 * Full PC-Parity System Platform Layer for Project I.G.I. (Android & POSIX)
 *
 * - Native Android OpenSL ES 44.1 kHz 16-bit Stereo DirectSound output (libOpenSLES)
 *   + Tactical multi-voice PCM SFX & wind synth when external .res audio is absent
 * - Thread-safe JNI -> Engine input ring buffer (Keyboard DIK, Mouse Buttons,
 *   Relative Freelook, and Exact PC Menu Cursor Snap via igi_menu_cursor)
 * - Zero-GPU software display mode switching (640x480, 800x600, 1024x768)
 */
#include "igi_fixes.h"
#include "pad_input.h"
#include "platform.h"
#include "runtime.h"

#include <SDL.h>
#include <fcntl.h>
#include <math.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#ifdef __ANDROID__
#include <SLES/OpenSLES.h>
#include <SLES/OpenSLES_Android.h>
#endif

static int s_mode_w = 640;
static int s_mode_h = 480;
static int s_shown = 0;
static char s_title[128] = "Project I.G.I.: I'm Going In (PC Full Port)";
int g_pc_guest_running = 0;

/* ============================================================================
 * Built-In Tactical 44.1 kHz Stereo SFX & Ambient Wind Synthesizer
 * ============================================================================ */
typedef struct SynthVoice {
    int active;
    int kind;     /* 1=gunshot, 2=suppressed, 3=sniper, 4=footstep, 5=ui_click, 6=objective */
    int pos;
    int len;
    float gain;
} SynthVoice;

static SynthVoice s_voices[8];
static uint32_t s_rng = 0x16102000u;
static volatile int s_synth_ambient_on = 1;

static inline float frand_signed(void)
{
    s_rng = s_rng * 1664525u + 1013904223u;
    return ((int32_t)(s_rng >> 8) / 8388608.0f) - 1.0f;
}

void igi_synth_set_ambient(int on)
{
    s_synth_ambient_on = on;
}

void igi_synth_trigger_sfx(int kind, float gain)
{
    int slot = 0;
    for (int i = 0; i < 8; i++) {
        if (!s_voices[i].active) { slot = i; break; }
    }
    SynthVoice *v = &s_voices[slot];
    v->kind = kind;
    v->pos = 0;
    v->gain = gain;
    switch (kind) {
    case 1: v->len = 6200; break;  /* Assault rifle / pistol crack */
    case 2: v->len = 3200; break;  /* MP5SD3 suppressed thump */
    case 3: v->len = 13500; break; /* Dragunov SVD / LAW-80 boom */
    case 4: v->len = 1900; break;  /* Snow/concrete boot step */
    case 5: v->len = 1100; break;  /* Anya computer terminal beep */
    case 6: v->len = 14000; break; /* Objective complete tactical chime */
    default: v->len = 2000; break;
    }
    v->active = 1;
}

static void mix_tactical_synth(int16_t *stereo, int frames)
{
    static float wind_lp = 0.0f;
    for (int i = 0; i < frames; i++) {
        float mix_l = 0.0f, mix_r = 0.0f;

        if (s_synth_ambient_on && !g_pc_guest_running) {
            float wn = frand_signed() * 0.018f;
            wind_lp = wind_lp * 0.985f + wn * 0.015f;
            mix_l += wind_lp;
            mix_r += wind_lp * 0.92f;
        }

        for (int k = 0; k < 8; k++) {
            SynthVoice *v = &s_voices[k];
            if (!v->active) continue;
            float t = (float)v->pos / 44100.0f;
            float env = 1.0f - ((float)v->pos / (float)v->len);
            env = env * env;
            float s = 0.0f;
            if (v->kind == 1) {
                s = (frand_signed() * 0.75f + sinf(t * 780.0f * (0.4f + env))) * env;
            } else if (v->kind == 2) {
                s = (frand_signed() * 0.35f + sinf(t * 420.0f)) * env * 0.7f;
            } else if (v->kind == 3) {
                s = (frand_signed() * 0.85f + sinf(t * 310.0f * (0.3f + env))) * env;
            } else if (v->kind == 4) {
                s = frand_signed() * env * 0.25f;
            } else if (v->kind == 5) {
                s = sinf(t * 6.28318f * 1480.0f) * env * 0.35f;
            } else if (v->kind == 6) {
                float freq = (v->pos < v->len / 2) ? 880.0f : 1320.0f;
                s = sinf(t * 6.28318f * freq) * env * 0.40f;
            }
            s *= v->gain;
            mix_l += s;
            mix_r += s;
            if (++v->pos >= v->len)
                v->active = 0;
        }

        int32_t l = (int32_t)stereo[i * 2 + 0] + (int32_t)(mix_l * 16000.0f);
        int32_t r = (int32_t)stereo[i * 2 + 1] + (int32_t)(mix_r * 16000.0f);
        if (l > 32767) l = 32767; else if (l < -32768) l = -32768;
        if (r > 32767) r = 32767; else if (r < -32768) r = -32768;
        stereo[i * 2 + 0] = (int16_t)l;
        stereo[i * 2 + 1] = (int16_t)r;
    }
}

/* ============================================================================
 * DirectSound Host Audio Driver (Android OpenSL ES + POSIX Fallback Thread)
 * ============================================================================ */
static pthread_mutex_t s_audio_mtx = PTHREAD_MUTEX_INITIALIZER;
static SDL_AudioSpec s_audio_spec;
static volatile int s_audio_running = 0;
static volatile int s_audio_paused = 1;

#define AUDIO_BUF_FRAMES 1024
#define AUDIO_BUF_BYTES  (AUDIO_BUF_FRAMES * 2 * 2) /* 44.1 kHz 16-bit Stereo */

static void render_audio_chunk(uint8_t *buf, int bytes)
{
    memset(buf, 0, (size_t)bytes);
    pthread_mutex_lock(&s_audio_mtx);
    if (!s_audio_paused && s_audio_spec.callback) {
        s_audio_spec.callback(s_audio_spec.userdata, buf, bytes);
    }
    mix_tactical_synth((int16_t *)buf, bytes / 4);
    pthread_mutex_unlock(&s_audio_mtx);
}

#ifdef __ANDROID__
static SLObjectItf s_sl_engine_obj = NULL;
static SLEngineItf s_sl_engine = NULL;
static SLObjectItf s_sl_mix_obj = NULL;
static SLObjectItf s_sl_player_obj = NULL;
static SLPlayItf s_sl_play = NULL;
static SLAndroidSimpleBufferQueueItf s_sl_bq = NULL;
static int16_t s_sl_bufs[2][AUDIO_BUF_FRAMES * 2];
static int s_sl_cur_buf = 0;
static int s_sl_ready = 0;

static void opensl_bq_callback(SLAndroidSimpleBufferQueueItf bq, void *ctx)
{
    (void)ctx;
    int16_t *dst = s_sl_bufs[s_sl_cur_buf];
    s_sl_cur_buf ^= 1;
    render_audio_chunk((uint8_t *)dst, AUDIO_BUF_BYTES);
    (*bq)->Enqueue(bq, dst, AUDIO_BUF_BYTES);
}

void igi_android_audio_start(void)
{
    if (s_sl_ready) return;
    if (slCreateEngine(&s_sl_engine_obj, 0, NULL, 0, NULL, NULL) != SL_RESULT_SUCCESS) return;
    if ((*s_sl_engine_obj)->Realize(s_sl_engine_obj, SL_BOOLEAN_FALSE) != SL_RESULT_SUCCESS) return;
    if ((*s_sl_engine_obj)->GetInterface(s_sl_engine_obj, SL_IID_ENGINE, &s_sl_engine) != SL_RESULT_SUCCESS) return;
    if ((*s_sl_engine)->CreateOutputMix(s_sl_engine, &s_sl_mix_obj, 0, NULL, NULL) != SL_RESULT_SUCCESS) return;
    if ((*s_sl_mix_obj)->Realize(s_sl_mix_obj, SL_BOOLEAN_FALSE) != SL_RESULT_SUCCESS) return;

    SLDataLocator_AndroidSimpleBufferQueue loc_bq = { SL_DATALOCATOR_ANDROIDSIMPLEBUFFERQUEUE, 2 };
    SLDataFormat_PCM fmt_pcm = {
        SL_DATAFORMAT_PCM, 2, SL_SAMPLINGRATE_44_1,
        SL_PCMSAMPLEFORMAT_FIXED_16, SL_PCMSAMPLEFORMAT_FIXED_16,
        SL_SPEAKER_FRONT_LEFT | SL_SPEAKER_FRONT_RIGHT,
        SL_BYTEORDER_LITTLEENDIAN
    };
    SLDataSource audio_src = { &loc_bq, &fmt_pcm };
    SLDataLocator_OutputMix loc_outmix = { SL_DATALOCATOR_OUTPUTMIX, s_sl_mix_obj };
    SLDataSink audio_snk = { &loc_outmix, NULL };

    const SLInterfaceID ids[1] = { SL_IID_ANDROIDSIMPLEBUFFERQUEUE };
    const SLboolean req[1] = { SL_BOOLEAN_TRUE };
    if ((*s_sl_engine)->CreateAudioPlayer(s_sl_engine, &s_sl_player_obj, &audio_src, &audio_snk,
                                          1, ids, req) != SL_RESULT_SUCCESS) return;
    if ((*s_sl_player_obj)->Realize(s_sl_player_obj, SL_BOOLEAN_FALSE) != SL_RESULT_SUCCESS) return;
    if ((*s_sl_player_obj)->GetInterface(s_sl_player_obj, SL_IID_PLAY, &s_sl_play) != SL_RESULT_SUCCESS) return;
    if ((*s_sl_player_obj)->GetInterface(s_sl_player_obj, SL_IID_ANDROIDSIMPLEBUFFERQUEUE, &s_sl_bq) != SL_RESULT_SUCCESS) return;
    if ((*s_sl_bq)->RegisterCallback(s_sl_bq, opensl_bq_callback, NULL) != SL_RESULT_SUCCESS) return;

    memset(s_sl_bufs, 0, sizeof(s_sl_bufs));
    (*s_sl_play)->SetPlayState(s_sl_play, SL_PLAYSTATE_PLAYING);
    (*s_sl_bq)->Enqueue(s_sl_bq, s_sl_bufs[0], AUDIO_BUF_BYTES);
    (*s_sl_bq)->Enqueue(s_sl_bq, s_sl_bufs[1], AUDIO_BUF_BYTES);
    s_sl_ready = 1;
    rt_log("[opensl-es] Native Android 44.1 kHz 16-bit Stereo DirectSound stream active");
}
#else
static pthread_t s_audio_thread;
static void *audio_driver_loop(void *arg)
{
    (void)arg;
    uint8_t pcm_buf[AUDIO_BUF_BYTES];
    while (s_audio_running) {
        render_audio_chunk(pcm_buf, AUDIO_BUF_BYTES);
        usleep(23000);
    }
    return NULL;
}
void igi_android_audio_start(void) {}
#endif

SDL_AudioDeviceID igi_sys_audio_open(const SDL_AudioSpec *want, SDL_AudioSpec *have)
{
    if (!want) return 0;
    pthread_mutex_lock(&s_audio_mtx);
    s_audio_spec = *want;
    s_audio_spec.freq = 44100;
    s_audio_spec.channels = 2;
    s_audio_spec.samples = AUDIO_BUF_FRAMES;
    if (have) *have = s_audio_spec;
    pthread_mutex_unlock(&s_audio_mtx);

#ifdef __ANDROID__
    igi_android_audio_start();
#else
    if (!s_audio_running) {
        s_audio_running = 1;
        pthread_create(&s_audio_thread, NULL, audio_driver_loop, NULL);
        pthread_detach(s_audio_thread);
    }
#endif
    rt_log("[audio] PC DirectSound 44.1 kHz Stereo mixer linked");
    return 1u;
}

void igi_sys_audio_pause(SDL_AudioDeviceID dev, int pause_on)
{
    (void)dev;
    s_audio_paused = pause_on ? 1 : 0;
}

void igi_sys_audio_lock(SDL_AudioDeviceID dev) { (void)dev; pthread_mutex_lock(&s_audio_mtx); }
void igi_sys_audio_unlock(SDL_AudioDeviceID dev) { (void)dev; pthread_mutex_unlock(&s_audio_mtx); }

/* ============================================================================
 * Thread-Safe JNI Input Queue -> DirectInput8 / Win32 / PC Menu Cursor Bridge
 * ============================================================================ */
typedef struct IgiQueuedEvent {
    int kind; /* 1=key, 2=mouse_btn, 3=mouse_rel, 4=menu_snap_pos, 5=menu_tap_click */
    int a;
    int b;
} IgiQueuedEvent;

#define INPUT_Q_CAP 256
static pthread_mutex_t s_input_mtx = PTHREAD_MUTEX_INITIALIZER;
static IgiQueuedEvent s_input_q[INPUT_Q_CAP];
static uint32_t s_iq_head = 0;
static uint32_t s_iq_tail = 0;
static int s_tap_hold_polls = 0;

static void iq_push(int kind, int a, int b)
{
    pthread_mutex_lock(&s_input_mtx);
    if ((s_iq_tail - s_iq_head) < INPUT_Q_CAP) {
        IgiQueuedEvent *ev = &s_input_q[s_iq_tail % INPUT_Q_CAP];
        ev->kind = kind;
        ev->a = a;
        ev->b = b;
        s_iq_tail++;
    }
    pthread_mutex_unlock(&s_input_mtx);
}

void igi_input_push_key(uint8_t dik, int down) { iq_push(1, (int)dik, down ? 1 : 0); }
void igi_input_push_mouse_btn(int btn, int down) { iq_push(2, btn, down ? 1 : 0); }
void igi_input_push_mouse_rel(int dx, int dy) { if (dx || dy) iq_push(3, dx, dy); }
void igi_input_push_menu_snap(int gx, int gy) { iq_push(4, gx, gy); }
void igi_input_push_menu_tap(void) { iq_push(5, 0, 0); }

static void post_win32_mouse_move(void)
{
    if (g_mouse.x < 0) g_mouse.x = 0;
    if (g_mouse.y < 0) g_mouse.y = 0;
    if (g_mouse.x >= s_mode_w) g_mouse.x = s_mode_w - 1;
    if (g_mouse.y >= s_mode_h) g_mouse.y = s_mode_h - 1;
    user32_post_message(0x0200, 0, ((uint32_t)g_mouse.y << 16) | ((uint32_t)g_mouse.x & 0xFFFFu));
}

static void drain_input_queue(void)
{
    if (s_tap_hold_polls > 0) {
        if (--s_tap_hold_polls == 0) {
            pad_mouse_button(0, 0);
            user32_post_message(0x0202, 0, ((uint32_t)g_mouse.y << 16) | ((uint32_t)g_mouse.x & 0xFFFFu));
        }
    }

    for (;;) {
        IgiQueuedEvent ev;
        int has = 0;
        pthread_mutex_lock(&s_input_mtx);
        if (s_iq_head != s_iq_tail) {
            ev = s_input_q[s_iq_head % INPUT_Q_CAP];
            s_iq_head++;
            has = 1;
        }
        pthread_mutex_unlock(&s_input_mtx);
        if (!has) break;

        if (ev.kind == 1) {
            if (g_pc_guest_running)
                pad_key((uint8_t)ev.a, ev.b);
            else
                platform_key((uint8_t)ev.a, ev.b);
        } else if (ev.kind == 2) {
            if (g_pc_guest_running) {
                pad_mouse_button(ev.a, ev.b);
            } else if (ev.a >= 0 && ev.a < 4) {
                g_mouse.buttons[ev.a] = ev.b ? 0x80 : 0;
            }
            uint32_t lp = ((uint32_t)g_mouse.y << 16) | ((uint32_t)g_mouse.x & 0xFFFFu);
            if (ev.a == 0)
                user32_post_message(ev.b ? 0x0201u : 0x0202u, ev.b ? 1u : 0u, lp);
            else if (ev.a == 1)
                user32_post_message(ev.b ? 0x0204u : 0x0205u, ev.b ? 2u : 0u, lp);
        } else if (ev.kind == 3) {
            g_mouse.dx += ev.a;
            g_mouse.dy += ev.b;
            g_mouse.x += ev.a;
            g_mouse.y += ev.b;
            post_win32_mouse_move();
        } else if (ev.kind == 4) {
            int32_t cx = g_mouse.x, cy = g_mouse.y;
            if (g_pc_guest_running && igi_menu_cursor(&cx, &cy)) {
                cx += g_mouse.dx;
                cy += g_mouse.dy;
            }
            int32_t gx = ev.a < 0 ? 0 : (ev.a >= s_mode_w ? s_mode_w - 1 : ev.a);
            int32_t gy = ev.b < 0 ? 0 : (ev.b >= s_mode_h ? s_mode_h - 1 : ev.b);
            g_mouse.dx += gx - cx;
            g_mouse.dy += gy - cy;
            g_mouse.x = gx;
            g_mouse.y = gy;
            post_win32_mouse_move();
        } else if (ev.kind == 5) {
            if (g_pc_guest_running && !pad_capturing_key()) {
                pad_mouse_button(0, 1);
                s_tap_hold_polls = 4;
                uint32_t lp = ((uint32_t)g_mouse.y << 16) | ((uint32_t)g_mouse.x & 0xFFFFu);
                user32_post_message(0x0201u, 1u, lp);
            }
        }
    }
}

/* ---- Platform Window & Video Mode ---- */
void platform_init(void)
{
#ifdef __ANDROID__
    igi_android_audio_start();
#endif
    rt_log("[platform] PC Full Port system layer ready");
}

void platform_create_window(int w, int h, const char *title)
{
    if (w > 0 && h > 0) {
        s_mode_w = w;
        s_mode_h = h;
    }
    if (title)
        snprintf(s_title, sizeof(s_title), "%s", title);
    rt_log("[platform] Window %dx%d title='%s'", s_mode_w, s_mode_h, s_title);
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

extern void render_init(int w, int h);

void platform_set_video_mode(int w, int h)
{
    if (w > 0 && h > 0) {
        s_mode_w = w;
        s_mode_h = h;
        render_init(w, h);
    }
    platform_show_window(1);
    rt_log("[platform] PC Display Mode set to %dx%d", s_mode_w, s_mode_h);
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
    if (g_pc_guest_running)
        igi_end_frame();
#ifndef __ANDROID__
    if (getenv("IGI_EXPORT_PPM"))
        cpu_sw_export_frame();
#endif
    platform_pump();
}

void platform_gl_init(void) {}
void platform_gl_release(void) {}
void platform_service_main(void) {}
void platform_show_cursor(int show) { (void)show; }
void platform_capture_mouse(int on) { (void)on; }

/* Optional Linux file pipe for external harness testing */
static void poll_external_input_file(void)
{
#ifndef __ANDROID__
    const char *path = getenv("IGI_CMD_PIPE");
    if (!path) return;
    FILE *f = fopen(path, "r+");
    if (!f) return;
    char line[128];
    int got_any = 0;
    while (fgets(line, sizeof(line), f)) {
        got_any = 1;
        unsigned int dik = 0;
        int down = 0, mx = 0, my = 0;
        if (sscanf(line, "key %x %d", &dik, &down) == 2) {
            igi_input_push_key((uint8_t)dik, down);
        } else if (sscanf(line, "mouse %d %d", &mx, &my) == 2) {
            igi_input_push_mouse_rel(mx, my);
        } else if (strncmp(line, "click", 5) == 0) {
            igi_input_push_menu_tap();
        }
    }
    if (got_any) {
        if (ftruncate(fileno(f), 0) != 0) {}
    }
    fclose(f);
#endif
}

void platform_pump(void)
{
    drain_input_queue();
    if (g_pc_guest_running)
        pad_tick();
    platform_scripted_input();
    poll_external_input_file();
}

void platform_wait(void)
{
    usleep(8000);
    platform_pump();
}
