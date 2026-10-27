/*
 * Pure POSIX CPU/System Driver replacement for <SDL.h>
 * Provides pthreads mutex/cond/threads, monotonic high-res clock,
 * and a headless/ring-buffer 44.1kHz PCM audio mixer thread for DirectSound7.
 */
#ifndef IGI_CPU_SYS_SDL_SHIM_H
#define IGI_CPU_SYS_SDL_SHIM_H

#include <pthread.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

typedef uint8_t Uint8;
typedef uint16_t Uint16;
typedef uint32_t Uint32;
typedef uint64_t Uint64;
typedef int16_t Sint16;
typedef int32_t Sint32;

/* ---- POSIX Mutex / Cond / Thread ---- */
typedef struct SDL_mutex { pthread_mutex_t m; } SDL_mutex;
typedef struct SDL_cond  { pthread_cond_t  c; } SDL_cond;
typedef struct SDL_Thread { pthread_t t; } SDL_Thread;

static inline SDL_mutex *SDL_CreateMutex(void) {
    SDL_mutex *m = (SDL_mutex *)calloc(1, sizeof(SDL_mutex));
    if (m) pthread_mutex_init(&m->m, NULL);
    return m;
}
static inline void SDL_LockMutex(SDL_mutex *m)   { if (m) pthread_mutex_lock(&m->m); }
static inline void SDL_UnlockMutex(SDL_mutex *m) { if (m) pthread_mutex_unlock(&m->m); }
static inline void SDL_DestroyMutex(SDL_mutex *m){ if (m) { pthread_mutex_destroy(&m->m); free(m); } }

static inline SDL_cond *SDL_CreateCond(void) {
    SDL_cond *c = (SDL_cond *)calloc(1, sizeof(SDL_cond));
    if (c) pthread_cond_init(&c->c, NULL);
    return c;
}
static inline void SDL_CondWait(SDL_cond *c, SDL_mutex *m) { if (c && m) pthread_cond_wait(&c->c, &m->m); }
static inline void SDL_CondSignal(SDL_cond *c)             { if (c) pthread_cond_signal(&c->c); }
static inline void SDL_CondBroadcast(SDL_cond *c)          { if (c) pthread_cond_broadcast(&c->c); }

struct igi_thread_wrap { int (*fn)(void *); void *data; };
static inline void *igi_thread_entry(void *arg) {
    struct igi_thread_wrap w = *(struct igi_thread_wrap *)arg;
    free(arg);
    w.fn(w.data);
    return NULL;
}
static inline SDL_Thread *SDL_CreateThread(int (*fn)(void *), const char *name, void *data) {
    (void)name;
    SDL_Thread *t = (SDL_Thread *)calloc(1, sizeof(SDL_Thread));
    struct igi_thread_wrap *w = (struct igi_thread_wrap *) malloc(sizeof(*w));
    if (!t || !w) { free(t); free(w); return NULL; }
    w->fn = fn; w->data = data;
    if (pthread_create(&t->t, NULL, igi_thread_entry, w) != 0) {
        free(t); free(w); return NULL;
    }
    pthread_detach(t->t);
    return t;
}

/* ---- Monotonic System Timer ---- */
static inline Uint64 SDL_GetPerformanceCounter(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (Uint64)ts.tv_sec * 1000000000ULL + (Uint64)ts.tv_nsec;
}
static inline Uint64 SDL_GetPerformanceFrequency(void) {
    return 1000000000ULL;
}
static inline Uint32 SDL_GetTicks(void) {
    return (Uint32)(SDL_GetPerformanceCounter() / 1000000ULL);
}
static inline void SDL_Delay(Uint32 ms) {
    usleep((useconds_t)ms * 1000u);
}
static inline const char *SDL_GetError(void) {
    return "CPU-SysDriver OK";
}

/* ---- Software Audio Device Shim (DirectSound7 PCM Mixer) ---- */
typedef uint32_t SDL_AudioDeviceID;
typedef uint16_t SDL_AudioFormat;
#define AUDIO_S16LSB 0x8010
#define AUDIO_F32SYS 0x8120

typedef void (*SDL_AudioCallback)(void *userdata, Uint8 *stream, int len);
typedef struct SDL_AudioSpec {
    int freq;
    SDL_AudioFormat format;
    Uint8 channels;
    Uint16 samples;
    SDL_AudioCallback callback;
    void *userdata;
} SDL_AudioSpec;

SDL_AudioDeviceID igi_sys_audio_open(const SDL_AudioSpec *want, SDL_AudioSpec *have);
void igi_sys_audio_pause(SDL_AudioDeviceID dev, int pause_on);
void igi_sys_audio_lock(SDL_AudioDeviceID dev);
void igi_sys_audio_unlock(SDL_AudioDeviceID dev);

#define SDL_OpenAudioDevice(devname, iscapture, want, have, allowed) igi_sys_audio_open(want, have)
#define SDL_PauseAudioDevice(dev, p) igi_sys_audio_pause(dev, p)
#define SDL_LockAudioDevice(dev)     igi_sys_audio_lock(dev)
#define SDL_UnlockAudioDevice(dev)   igi_sys_audio_unlock(dev)

#endif
