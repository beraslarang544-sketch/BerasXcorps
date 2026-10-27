/*
 * Pure CPU Software Direct3D 7 & DirectDraw 7 Rasterizer for Project I.G.I.
 * Zero GPU / OpenGL dependencies:
 * - Full 4x4 row-vector D3D7 World * View * Projection pipeline + near-plane clipping
 * - Perspective-correct barycentric rasterizer with 32-bit float Z-buffer
 * - DirectDraw guest Surface texture sampling (ARGB8888, RGB565, A1R5G5B5, Paletted8)
 *   with hardware-matching 2x2 fixed-point bilinear filtering & nearest font snapping
 * - 2-stage multi-texturing (diffuse + lightmap + D3DTA_TFACTOR), color-key, alpha test/blend,
 *   exact D3D7 vertex specular fog & material lighting
 * - Thread-safe double-buffered ARGB8888 front buffer for Android JNI Canvas presentation
 */
#include "platform.h"
#include "render.h"
#include "runtime.h"

#include <math.h>
#include <pthread.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

RenderState g_rs;
uint32_t g_rs_serial = 1;
uint32_t g_rs_parts = 0;
uint32_t g_light_serial = 1;
uint32_t g_frame_serial = 0;
uint32_t g_tex_epoch = 1;
int g_pack_thread = 0;

/* Render queue single-thread CPU symbols (rq_fast.h) */
int rq_on = 0;
RqChunk *rq_rec_chunk = NULL;
uint64_t rq_rec_cmds = 0;
static _Alignas(16) uint8_t s_rq_scratch[8192];
static void (*s_rq_fn)(const void *);
static uint8_t *s_rq_databuf = NULL;
static size_t s_rq_datacap = 0;

void *rq_begin(void (*fn)(const void *args), size_t size)
{
    s_rq_fn = fn;
    if (size > sizeof(s_rq_scratch))
        return malloc(size);
    return s_rq_scratch;
}
void rq_end(void)
{
    if (s_rq_fn)
        s_rq_fn(s_rq_scratch);
    s_rq_fn = NULL;
}
void rq_exec(void (*fn)(const void *args), const void *args, size_t size)
{
    (void)size;
    if (fn)
        fn(args);
}
void *rq_data(size_t n)
{
    if (n > s_rq_datacap) {
        free(s_rq_databuf);
        s_rq_datacap = n + 4096u;
        s_rq_databuf = (uint8_t *)malloc(s_rq_datacap);
    }
    return s_rq_databuf;
}
uint64_t rq_mark(void) { return 0; }
int rq_passed(uint64_t mark) { (void)mark; return 1; }
void rq_sync(void) {}
void render_shutdown(void) {}

/* ---- Software Framebuffer, Z-Buffer & Thread-Safe Front Buffer ---- */
static int s_fb_w = 640;
static int s_fb_h = 480;
static uint32_t *s_color_buf = NULL; /* RGBA8: R in low byte [R, G, B, A] */
static float *s_depth_buf = NULL;

static pthread_mutex_t s_front_mtx = PTHREAD_MUTEX_INITIALIZER;
static uint32_t *s_front_argb = NULL; /* Android Bitmap ARGB_8888 (0xAARRGGBB) */
static int s_front_w = 0;
static int s_front_h = 0;

static void (*s_overlay_hook)(int w, int h) = NULL;
static int s_show_hud_banner = 0;

static uint32_t s_stat_draws = 0;
static uint32_t s_stat_tris = 0;
static uint32_t s_last_draws = 0;
static uint32_t s_last_tris = 0;

void cpu_sw_set_overlay_hook(void (*hook)(int w, int h)) { s_overlay_hook = hook; }
void cpu_sw_set_hud_banner(int enabled) { s_show_hud_banner = enabled; }

const uint32_t *cpu_sw_framebuffer(int *w, int *h)
{
    if (w) *w = s_fb_w;
    if (h) *h = s_fb_h;
    return s_color_buf;
}

/* Thread-safe copy/scale of latest presented frame into Android ARGB_8888 buffer */
int cpu_sw_copy_front_argb(uint32_t *dst_argb, int dst_w, int dst_h)
{
    if (!dst_argb || dst_w <= 0 || dst_h <= 0)
        return 0;
    pthread_mutex_lock(&s_front_mtx);
    if (!s_front_argb || s_front_w <= 0 || s_front_h <= 0) {
        pthread_mutex_unlock(&s_front_mtx);
        return 0;
    }
    if (s_front_w == dst_w && s_front_h == dst_h) {
        memcpy(dst_argb, s_front_argb, (size_t)dst_w * (size_t)dst_h * sizeof(uint32_t));
    } else {
        for (int y = 0; y < dst_h; y++) {
            int sy = (y * s_front_h) / dst_h;
            const uint32_t *srow = s_front_argb + sy * s_front_w;
            uint32_t *drow = dst_argb + y * dst_w;
            for (int x = 0; x < dst_w; x++) {
                drow[x] = srow[(x * s_front_w) / dst_w];
            }
        }
    }
    pthread_mutex_unlock(&s_front_mtx);
    return dst_w * dst_h;
}

uint32_t cpu_sw_front_seq(void)
{
    return s_front_seq;
}

void cpu_sw_stats(uint32_t *frames, uint32_t *draws, uint32_t *tris)
{
    if (frames) *frames = g_frame_serial;
    if (draws)  *draws  = s_last_draws;
    if (tris)   *tris   = s_last_tris;
}

int cpu_sw_copy_front_argb(uint32_t *dst_argb, int dst_w, int dst_h)
{
    if (!dst_argb || dst_w <= 0 || dst_h <= 0)
        return 0;
    pthread_mutex_lock(&s_front_mtx);
    if (!s_front_argb || s_front_w <= 0 || s_front_h <= 0) {
        pthread_mutex_unlock(&s_front_mtx);
        return 0;
    }
    if (dst_w == s_front_w && dst_h == s_front_h) {
        memcpy(dst_argb, s_front_argb, (size_t)dst_w * (size_t)dst_h * sizeof(uint32_t));
    } else {
        for (int y = 0; y < dst_h; y++) {
            int sy = (y * s_front_h) / dst_h;
            const uint32_t *srow = s_front_argb + sy * s_front_w;
            uint32_t *drow = dst_argb + y * dst_w;
            for (int x = 0; x < dst_w; x++) {
                int sx = (x * s_front_w) / dst_w;
                drow[x] = srow[sx];
            }
        }
    }
    pthread_mutex_unlock(&s_front_mtx);
    return dst_w * dst_h;
}

static void ensure_fb(int w, int h)
{
    if (w <= 0) w = 640;
    if (h <= 0) h = 480;
    if (s_color_buf && s_fb_w == w && s_fb_h == h)
        return;
    free(s_color_buf);
    free(s_depth_buf);
    s_fb_w = w;
    s_fb_h = h;
    s_color_buf = (uint32_t *)calloc((size_t)w * (size_t)h, sizeof(uint32_t));
    s_depth_buf = (float *)malloc((size_t)w * (size_t)h * sizeof(float));
    for (int i = 0; i < w * h; i++) {
        s_color_buf[i] = 0xFF141810u;
        s_depth_buf[i] = 1.0f;
    }
}

/* ---- Minimal 5x7 Bitmap Font & 2D Rect Primitives ---- */
static void draw_rect_solid(int x0, int y0, int w, int h, uint32_t rgba)
{
    if (!s_color_buf) return;
    int x1 = x0 + w, y1 = y0 + h;
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 > s_fb_w) x1 = s_fb_w;
    if (y1 > s_fb_h) y1 = s_fb_h;
    uint32_t a = (rgba >> 24) & 0xFFu;
    for (int y = y0; y < y1; y++) {
        uint32_t *row = s_color_buf + y * s_fb_w;
        for (int x = x0; x < x1; x++) {
            if (a == 255u) {
                row[x] = rgba;
            } else {
                uint32_t dst = row[x];
                uint32_t r = (((rgba & 0xFFu) * a) + ((dst & 0xFFu) * (255u - a))) >> 8;
                uint32_t g = ((((rgba >> 8) & 0xFFu) * a) + (((dst >> 8) & 0xFFu) * (255u - a))) >> 8;
                uint32_t b = ((((rgba >> 16) & 0xFFu) * a) + (((dst >> 16) & 0xFFu) * (255u - a))) >> 8;
                row[x] = 0xFF000000u | (b << 16) | (g << 8) | r;
            }
        }
    }
}

void cpu_sw_draw_rect(int x0, int y0, int w, int h, uint32_t rgba)
{
    draw_rect_solid(x0, y0, w, h, rgba);
}

static uint8_t glyph_row(char c, int row)
{
    static const uint8_t font_digits[10][7] = {
        {0x0E,0x11,0x13,0x15,0x19,0x11,0x0E}, {0x04,0x0C,0x04,0x04,0x04,0x04,0x0E},
        {0x0E,0x11,0x01,0x02,0x04,0x08,0x1F}, {0x1F,0x02,0x04,0x02,0x01,0x11,0x0E},
        {0x02,0x06,0x0A,0x12,0x1F,0x02,0x02}, {0x1F,0x10,0x1E,0x01,0x01,0x11,0x0E},
        {0x06,0x08,0x10,0x1E,0x11,0x11,0x0E}, {0x1F,0x01,0x02,0x04,0x08,0x08,0x08},
        {0x0E,0x11,0x11,0x0E,0x11,0x11,0x0E}, {0x0E,0x11,0x11,0x0F,0x01,0x02,0x0C}
    };
    static const uint8_t font_alpha[26][7] = {
        {0x0E,0x11,0x11,0x1F,0x11,0x11,0x11}, {0x1E,0x11,0x11,0x1E,0x11,0x11,0x1E},
        {0x0E,0x11,0x10,0x10,0x10,0x11,0x0E}, {0x1C,0x12,0x11,0x11,0x11,0x12,0x1C},
        {0x1F,0x10,0x10,0x1E,0x10,0x10,0x1F}, {0x1F,0x10,0x10,0x1E,0x10,0x10,0x10},
        {0x0E,0x11,0x10,0x17,0x11,0x11,0x0F}, {0x11,0x11,0x11,0x1F,0x11,0x11,0x11},
        {0x0E,0x04,0x04,0x04,0x04,0x04,0x0E}, {0x07,0x02,0x02,0x02,0x12,0x12,0x0C},
        {0x11,0x12,0x14,0x18,0x14,0x12,0x11}, {0x10,0x10,0x10,0x10,0x10,0x10,0x1F},
        {0x11,0x1B,0x15,0x15,0x11,0x11,0x11}, {0x11,0x19,0x15,0x13,0x11,0x11,0x11},
        {0x0E,0x11,0x11,0x11,0x11,0x11,0x0E}, {0x1E,0x11,0x11,0x1E,0x10,0x10,0x10},
        {0x0E,0x11,0x11,0x11,0x15,0x12,0x0D}, {0x1E,0x11,0x11,0x1E,0x14,0x12,0x11},
        {0x0F,0x10,0x10,0x0E,0x01,0x01,0x1E}, {0x1F,0x04,0x04,0x04,0x04,0x04,0x04},
        {0x11,0x11,0x11,0x11,0x11,0x11,0x0E}, {0x11,0x11,0x11,0x11,0x11,0x0A,0x04},
        {0x11,0x11,0x11,0x15,0x15,0x1B,0x11}, {0x11,0x11,0x0A,0x04,0x0A,0x11,0x11},
        {0x11,0x11,0x0A,0x04,0x04,0x04,0x04}, {0x1F,0x01,0x02,0x04,0x08,0x10,0x1F}
    };
    if (c >= 'a' && c <= 'z') c = (char)(c - 32);
    if (c >= '0' && c <= '9') return font_digits[c - '0'][row];
    if (c >= 'A' && c <= 'Z') return font_alpha[c - 'A'][row];
    if (c == ':') return (row == 2 || row == 4) ? 0x04 : 0;
    if (c == '.') return (row == 6) ? 0x04 : 0;
    if (c == '-') return (row == 3) ? 0x0E : 0;
    if (c == '+') return (row == 3) ? 0x1F : ((row >= 1 && row <= 5) ? 0x04 : 0);
    if (c == '|') return 0x04;
    if (c == '/') return (uint8_t)(1u << (row < 5 ? row : 4));
    if (c == '[') return (row == 0 || row == 6) ? 0x0E : 0x08;
    if (c == ']') return (row == 0 || row == 6) ? 0x0E : 0x02;
    if (c == '(') return (row == 0 || row == 6) ? 0x06 : 0x08;
    if (c == ')') return (row == 0 || row == 6) ? 0x0C : 0x02;
    if (c == '>') return (row == 3) ? 0x02 : ((row == 2 || row == 4) ? 0x04 : ((row == 1 || row == 5) ? 0x08 : 0));
    if (c == '<') return (row == 3) ? 0x08 : ((row == 2 || row == 4) ? 0x04 : ((row == 1 || row == 5) ? 0x02 : 0));
    if (c == '_') return (row == 6) ? 0x1F : 0;
    if (c == ',') return (row == 5) ? 0x04 : ((row == 6) ? 0x08 : 0);
    if (c == '!') return (row <= 4 || row == 6) ? 0x04 : 0;
    if (c == '%') return (row == 0) ? 0x19 : ((row == 6) ? 0x13 : (uint8_t)(1u << (row < 5 ? row : 4)));
    return 0;
}

void cpu_sw_draw_rect(int x0, int y0, int w, int h, uint32_t rgba)
{
    draw_rect_solid(x0, y0, w, h, rgba);
}

void cpu_sw_draw_text(int x, int y, const char *s, uint32_t rgba)
{
    if (!s_color_buf || !s) return;
    for (; *s; s++, x += 6) {
        if (*s == ' ') continue;
        for (int r = 0; r < 7; r++) {
            uint8_t bits = glyph_row(*s, r);
            int py = y + r;
            if (py < 0 || py >= s_fb_h) continue;
            for (int col = 0; col < 5; col++) {
                if (bits & (1u << (4 - col))) {
                    int px = x + col;
                    if (px >= 0 && px < s_fb_w)
                        s_color_buf[py * s_fb_w + px] = rgba;
                }
            }
        }
    }
}

void cpu_sw_export_frame(void)
{
    if (!s_color_buf) return;
    const char *fb_path = getenv("IGI_FB_PATH");
    if (!fb_path)
        fb_path = "/tmp/igi_cpu_fb.ppm";
    char tmp_path[512];
    snprintf(tmp_path, sizeof(tmp_path), "%s.tmp", fb_path);
    FILE *f = fopen(tmp_path, "wb");
    if (!f) return;
    fprintf(f, "P6\n%d %d\n255\n", s_fb_w, s_fb_h);
    uint8_t *rgb = (uint8_t *)malloc((size_t)s_fb_w * 3u);
    if (rgb) {
        for (int y = 0; y < s_fb_h; y++) {
            const uint32_t *src = s_color_buf + y * s_fb_w;
            for (int x = 0; x < s_fb_w; x++) {
                uint32_t c = src[x];
                rgb[x * 3 + 0] = (uint8_t)(c & 0xFFu);
                rgb[x * 3 + 1] = (uint8_t)((c >> 8) & 0xFFu);
                rgb[x * 3 + 2] = (uint8_t)((c >> 16) & 0xFFu);
            }
            fwrite(rgb, 1, (size_t)s_fb_w * 3u, f);
        }
        free(rgb);
    }
    fclose(f);
    rename(tmp_path, fb_path);
}

/* ---- Direct3D 7 Renderer Interface ---- */
int render_diag_mode(void) { return 0; }
void render_pk_draw_begin(int diag, int trace) { (void)diag; (void)trace; }
int render_diag_no_vb_cache(void) { return 0; }
int render_diag_no_compact(void) { return 0; }
int render_pk_no_compact(void) { return 0; }
void render_diag_cycle(void) {}
int render_overlay_enabled(void) { return 1; }
void render_apply_settings(void) {}
void render_onscreen_buttons(const struct ButtonsCmd *c) { (void)c; }

void render_init(int w, int h)
{
    ensure_fb(w, h);
    memset(&g_rs, 0, sizeof(g_rs));
    g_rs_serial++;
    g_light_serial++;
    g_rs.rs[7]   = 1u;          /* D3DRENDERSTATE_ZENABLE */
    g_rs.rs[8]   = 3u;          /* D3DFILL_SOLID */
    g_rs.rs[14]  = 1u;          /* D3DRENDERSTATE_ZWRITEENABLE */
    g_rs.rs[19]  = 2u;          /* D3DBLEND_ONE */
    g_rs.rs[20]  = 1u;          /* D3DBLEND_ZERO */
    g_rs.rs[22]  = 3u;          /* D3DCULL_CCW */
    g_rs.rs[23]  = 4u;          /* D3DCMP_LESSEQUAL */
    g_rs.rs[25]  = 8u;          /* D3DCMP_ALWAYS */
    g_rs.rs[60]  = 0xFFFFFFFFu; /* D3DRENDERSTATE_TEXTUREFACTOR */
    g_rs.rs[137] = 1u;          /* D3DRENDERSTATE_LIGHTING */
    g_rs.rs[141] = 1u;          /* D3DRENDERSTATE_COLORVERTEX */
    g_rs.rs[145] = 1u;          /* D3DRENDERSTATE_DIFFUSEMATERIALSOURCE = COLOR1 */
    g_rs.rs[146] = 2u;          /* D3DRENDERSTATE_SPECULARMATERIALSOURCE = COLOR2 */
    for (int i = 0; i < 16; i += 5)
        g_rs.world[i] = g_rs.view[i] = g_rs.proj[i] = 1.0f;
    for (int s = 0; s < MAX_STAGES; s++) {
        StageState *st = &g_rs.stage[s];
        st->colorop   = (s == 0) ? 4u : 1u; /* MODULATE / DISABLE */
        st->colorarg1 = 2u;                 /* D3DTA_TEXTURE */
        st->colorarg2 = 1u;                 /* D3DTA_CURRENT */
        st->alphaop   = (s == 0) ? 2u : 1u; /* SELECTARG1 / DISABLE */
        st->alphaarg1 = 2u;
        st->alphaarg2 = 1u;
        st->texcoordindex = (uint32_t)s;
        st->addressu = st->addressv = 1u;
        st->magfilter = st->minfilter = st->mipfilter = 1u;
    }
    g_rs.vp_x = 0; g_rs.vp_y = 0; g_rs.vp_w = s_fb_w; g_rs.vp_h = s_fb_h;
    g_rs.vp_minz = 0.0f; g_rs.vp_maxz = 1.0f;
    g_rs.mat_diffuse[0] = g_rs.mat_diffuse[1] = g_rs.mat_diffuse[2] = g_rs.mat_diffuse[3] = 1.0f;
}

void render_state_changing(void)
{
    g_rs_serial++;
}

void render_flush(void) {}

void render_begin_frame(void)
{
    ensure_fb(s_fb_w, s_fb_h);
    s_stat_draws = 0;
    s_stat_tris = 0;
}

void render_present(void)
{
    s_last_draws = s_stat_draws;
    s_last_tris  = s_stat_tris;
    g_frame_serial++;

    if (s_overlay_hook)
        s_overlay_hook(s_fb_w, s_fb_h);

    if (s_show_hud_banner) {
        char hud[128];
        snprintf(hud, sizeof(hud), "[IGI PC D3D7] FRM:%u DRW:%u TRI:%u %dx%d",
                 g_frame_serial, s_last_draws, s_last_tris, s_fb_w, s_fb_h);
        draw_rect_solid(4, 4, (int)strlen(hud) * 6 + 8, 13, 0xB8101812u);
        cpu_sw_draw_text(8, 7, hud, 0xFF88FF55u);
    }

    if (s_color_buf && s_fb_w > 0 && s_fb_h > 0) {
        pthread_mutex_lock(&s_front_mtx);
        if (!s_front_argb || s_front_w != s_fb_w || s_front_h != s_fb_h) {
            free(s_front_argb);
            s_front_w = s_fb_w;
            s_front_h = s_fb_h;
            s_front_argb = (uint32_t *)malloc((size_t)s_fb_w * (size_t)s_fb_h * sizeof(uint32_t));
        }
        if (s_front_argb) {
            int total = s_fb_w * s_fb_h;
            for (int i = 0; i < total; i++) {
                uint32_t c = s_color_buf[i];
                /* Convert internal RGBA8 (0xAABBGGRR) -> Android ARGB_8888 (0xAARRGGBB) */
                s_front_argb[i] = 0xFF000000u |
                                  ((c & 0x000000FFu) << 16) |
                                  (c & 0x0000FF00u) |
                                  ((c >> 16) & 0x000000FFu);
            }
        }
        pthread_mutex_unlock(&s_front_mtx);
    }

    platform_swap();
}

void render_clear(uint32_t nrects, const Rect *rects, uint32_t flags, uint32_t color, float z)
{
    ensure_fb(s_fb_w, s_fb_h);
    uint32_t rgba = ((color & 0xFF000000u)) |
                    ((color & 0x000000FFu) << 16) |
                    ((color & 0x0000FF00u)) |
                    ((color >> 16) & 0x000000FFu) | 0xFF000000u;
    uint32_t count = nrects ? nrects : 1u;
    for (uint32_t i = 0; i < count; i++) {
        int x0 = nrects ? rects[i].l : 0;
        int y0 = nrects ? rects[i].t : 0;
        int x1 = nrects ? rects[i].r : s_fb_w;
        int y1 = nrects ? rects[i].b : s_fb_h;
        if (x0 < 0) x0 = 0;
        if (y0 < 0) y0 = 0;
        if (x1 > s_fb_w) x1 = s_fb_w;
        if (y1 > s_fb_h) y1 = s_fb_h;
        for (int y = y0; y < y1; y++) {
            uint32_t *crow = s_color_buf + y * s_fb_w;
            float    *zrow = s_depth_buf + y * s_fb_w;
            for (int x = x0; x < x1; x++) {
                if (flags & 1u) crow[x] = rgba;
                if (flags & 2u) zrow[x] = z;
            }
        }
    }
}

void render_fill(const Rect *r, uint32_t rgba)
{
    ensure_fb(s_fb_w, s_fb_h);
    int x0 = r ? r->l : 0;
    int y0 = r ? r->t : 0;
    int x1 = r ? r->r : s_fb_w;
    int y1 = r ? r->b : s_fb_h;
    draw_rect_solid(x0, y0, x1 - x0, y1 - y0, rgba | 0xFF000000u);
}

void render_texture_release(Surface *s)
{
    if (s) s->gl_tex = 0;
}

uint32_t render_texture_get(Surface *s)
{
    if (!s) return 0;
    if (!s->gl_tex) s->gl_tex = 1u;
    s->dirty = 0;
    return s->gl_tex;
}

/* Sample pixel from DirectDraw guest Surface (host or guest g_mem backed) */
static inline uint32_t sample_texel_raw(const Surface *s, int tx, int ty, uint32_t bpp)
{
    const uint8_t *p = g_mem + s->mem + (uint32_t)ty * s->pitch + (uint32_t)tx * bpp;
    uint32_t c = pixel_to_rgba(&s->pf, p);
    if (s->has_ck) {
        uint32_t raw = 0;
        memcpy(&raw, p, bpp <= 4u ? bpp : 4u);
        if (raw >= s->ck_lo && raw <= s->ck_hi)
            c &= 0x00FFFFFFu;
    }
    return c;
}

static inline int wrap_or_clamp_coord(int c, int dim, uint32_t addr)
{
    if (addr == 3u)
        return c < 0 ? 0 : (c >= dim ? dim - 1 : c);
    c %= dim;
    return c < 0 ? c + dim : c;
}

static inline uint32_t sample_surface(const Surface *s, float u, float v,
                                      uint32_t addr_u, uint32_t addr_v, int bilinear)
{
    if (!s || !s->mem || s->w == 0 || s->h == 0)
        return 0xFFFFFFFFu;
    uint32_t bpp = s->pf.bits ? (s->pf.bits / 8u) : 4u;
    int w = (int)s->w, h = (int)s->h;

    if (bilinear && !s->has_ck && w > 1 && h > 1) {
        float fu = u * (float)w - 0.5f;
        float fv = v * (float)h - 0.5f;
        int x0 = (int)floorf(fu);
        int y0 = (int)floorf(fv);
        uint32_t fx = (uint32_t)((fu - (float)x0) * 256.0f) & 0xFFu;
        uint32_t fy = (uint32_t)((fv - (float)y0) * 256.0f) & 0xFFu;
        int x1 = wrap_or_clamp_coord(x0 + 1, w, addr_u);
        int y1 = wrap_or_clamp_coord(y0 + 1, h, addr_v);
        x0 = wrap_or_clamp_coord(x0, w, addr_u);
        y0 = wrap_or_clamp_coord(y0, h, addr_v);

        uint32_t c00 = sample_texel_raw(s, x0, y0, bpp);
        uint32_t c10 = sample_texel_raw(s, x1, y0, bpp);
        uint32_t c01 = sample_texel_raw(s, x0, y1, bpp);
        uint32_t c11 = sample_texel_raw(s, x1, y1, bpp);

        uint32_t w00 = (256u - fx) * (256u - fy);
        uint32_t w10 = fx * (256u - fy);
        uint32_t w01 = (256u - fx) * fy;
        uint32_t w11 = fx * fy;

        uint32_t r = ((c00 & 0xFFu) * w00 + (c10 & 0xFFu) * w10 + (c01 & 0xFFu) * w01 + (c11 & 0xFFu) * w11) >> 16;
        uint32_t g = (((c00 >> 8) & 0xFFu) * w00 + (((c10 >> 8) & 0xFFu) * w10) + (((c01 >> 8) & 0xFFu) * w01) + (((c11 >> 8) & 0xFFu) * w11)) >> 16;
        uint32_t b = (((c00 >> 16) & 0xFFu) * w00 + (((c10 >> 16) & 0xFFu) * w10) + (((c01 >> 16) & 0xFFu) * w01) + (((c11 >> 16) & 0xFFu) * w11)) >> 16;
        uint32_t a = (((c00 >> 24) & 0xFFu) * w00 + (((c10 >> 24) & 0xFFu) * w10) + (((c01 >> 24) & 0xFFu) * w01) + (((c11 >> 24) & 0xFFu) * w11)) >> 16;
        return (a << 24) | (b << 16) | (g << 8) | r;
    }

    if (addr_u == 3u) {
        if (u < 0.0f) u = 0.0f; else if (u > 1.0f) u = 1.0f;
    } else {
        u = u - floorf(u);
    }
    if (addr_v == 3u) {
        if (v < 0.0f) v = 0.0f; else if (v > 1.0f) v = 1.0f;
    } else {
        v = v - floorf(v);
    }
    int tx = (int)floorf(u * (float)w);
    int ty = (int)floorf(v * (float)h);
    if (tx < 0) tx = 0; else if (tx >= w) tx = w - 1;
    if (ty < 0) ty = 0; else if (ty >= h) ty = h - 1;
    return sample_texel_raw(s, tx, ty, bpp);
}

void render_blit(Surface *src, const Rect *sr, const Rect *dr, int use_ck)
{
    ensure_fb(s_fb_w, s_fb_h);
    if (!src || src->w == 0 || src->h == 0)
        return;

    /* AVI movie decoded frame path (avifil32 / msvfw32 cutscenes & logos) */
    if (src->video && src->video->rgba) {
        const uint32_t *vpx = src->video->rgba(src->video);
        if (vpx && src->video->width > 0 && src->video->height > 0) {
            int vw = src->video->width, vh = src->video->height;
            int dx0 = dr ? dr->l : 0, dy0 = dr ? dr->t : 0;
            int dx1 = dr ? dr->r : s_fb_w, dy1 = dr ? dr->b : s_fb_h;
            int dw = dx1 - dx0, dh = dy1 - dy0;
            if (dw > 0 && dh > 0) {
                for (int y = 0; y < dh; y++) {
                    int py = dy0 + y;
                    if (py < 0 || py >= s_fb_h) continue;
                    int sy = (y * vh) / dh;
                    for (int x = 0; x < dw; x++) {
                        int px = dx0 + x;
                        if (px < 0 || px >= s_fb_w) continue;
                        int sx = (x * vw) / dw;
                        s_color_buf[py * s_fb_w + px] = vpx[sy * vw + sx] | 0xFF000000u;
                    }
                }
            }
            return;
        }
    }

    if (!src->mem)
        return;
    int sx0 = sr ? sr->l : 0, sy0 = sr ? sr->t : 0;
    int sx1 = sr ? sr->r : (int)src->w, sy1 = sr ? sr->b : (int)src->h;
    int dx0 = dr ? dr->l : 0, dy0 = dr ? dr->t : 0;
    int dx1 = dr ? dr->r : s_fb_w, dy1 = dr ? dr->b : s_fb_h;
    int dw = dx1 - dx0, dh = dy1 - dy0;
    int sw = sx1 - sx0, sh = sy1 - sy0;
    if (dw <= 0 || dh <= 0 || sw <= 0 || sh <= 0) return;

    uint32_t bpp = src->pf.bits ? (src->pf.bits / 8u) : 4u;
    for (int y = 0; y < dh; y++) {
        int py = dy0 + y;
        if (py < 0 || py >= s_fb_h) continue;
        int sy = sy0 + (y * sh) / dh;
        if (sy < 0 || (uint32_t)sy >= src->h) continue;
        for (int x = 0; x < dw; x++) {
            int px = dx0 + x;
            if (px < 0 || px >= s_fb_w) continue;
            int sx = sx0 + (x * sw) / dw;
            if (sx < 0 || (uint32_t)sx >= src->w) continue;
            const uint8_t *p = g_mem + src->mem + (uint32_t)sy * src->pitch + (uint32_t)sx * bpp;
            if (use_ck && src->has_ck) {
                uint32_t raw = 0;
                memcpy(&raw, p, bpp <= 4u ? bpp : 4u);
                if (raw >= src->ck_lo && raw <= src->ck_hi)
                    continue;
            }
            s_color_buf[py * s_fb_w + px] = pixel_to_rgba(&src->pf, p) | 0xFF000000u;
        }
    }
}

void render_readback(Surface *s)
{
    if (!s || !s->mem || !s_color_buf) return;
    uint32_t bpp = s->pf.bits ? (s->pf.bits / 8u) : 4u;
    uint32_t w = s->w < (uint32_t)s_fb_w ? s->w : (uint32_t)s_fb_w;
    uint32_t h = s->h < (uint32_t)s_fb_h ? s->h : (uint32_t)s_fb_h;
    for (uint32_t y = 0; y < h; y++) {
        uint8_t *dst = g_mem + s->mem + y * s->pitch;
        const uint32_t *src = s_color_buf + y * (uint32_t)s_fb_w;
        for (uint32_t x = 0; x < w; x++) {
            uint32_t px = rgba_to_pixel(&s->pf, src[x]);
            memcpy(dst + x * bpp, &px, bpp);
        }
    }
}

void render_writeback(Surface *s)
{
    render_blit(s, NULL, NULL, 0);
}

void render_set_bounds(const float *lo, const float *hi) { (void)lo; (void)hi; }
void render_vb_release(void **slot) { if (slot) *slot = NULL; }
int render_draw_vb(void **slot, uint32_t gen, const RVertex *all, uint32_t count, uint32_t start, int prim,
                   uint32_t nv, const uint16_t *idx, uint32_t ni, int has_normal, int has_color, int has_spec,
                   int ntex)
{
    (void)slot; (void)gen; (void)all; (void)count; (void)start; (void)prim;
    (void)nv; (void)idx; (void)ni; (void)has_normal; (void)has_color; (void)has_spec; (void)ntex;
    return 0;
}
int render_draw_guest(int prim, const GuestVerts *g, uint32_t nv, const uint16_t *idx, uint32_t ni)
{
    (void)prim; (void)g; (void)nv; (void)idx; (void)ni;
    return 0;
}
int render_draw_dynvb(uint32_t lock_id, uint32_t start, const GuestVerts *g, uint32_t nv, int prim,
                      const uint16_t *idx, uint32_t ni)
{
    (void)lock_id; (void)start; (void)g; (void)nv; (void)prim; (void)idx; (void)ni;
    return 0;
}
void render_pk_prepare(int pretransformed, int has_normal) { (void)pretransformed; (void)has_normal; }
void render_pk_recorded(void) {}

/* ---- 3D Vertex Transform & Clipping ---- */
typedef struct SwVert {
    float sx, sy, sz, inv_w;
    float cx, cy, cz, cw;
    float r, g, b, a;
    float fog;
    float u0, v0, u1, v1;
} SwVert;

static void mat4_mul_d3d(float out[16], const float a[16], const float b[16])
{
    float r[16];
    for (int i = 0; i < 4; i++) {
        for (int j = 0; j < 4; j++) {
            r[i * 4 + j] = a[i * 4 + 0] * b[0 * 4 + j] +
                           a[i * 4 + 1] * b[1 * 4 + j] +
                           a[i * 4 + 2] * b[2 * 4 + j] +
                           a[i * 4 + 3] * b[3 * 4 + j];
        }
    }
    memcpy(out, r, sizeof(r));
}

static void clip_to_screen(SwVert *sv)
{
    float inv_w = (fabsf(sv->cw) > 1e-7f) ? (1.0f / sv->cw) : 1.0f;
    float ndc_x = sv->cx * inv_w;
    float ndc_y = sv->cy * inv_w;
    float ndc_z = sv->cz * inv_w;
    float vpw = g_rs.vp_w > 0 ? (float)g_rs.vp_w : (float)s_fb_w;
    float vph = g_rs.vp_h > 0 ? (float)g_rs.vp_h : (float)s_fb_h;
    sv->sx = (float)g_rs.vp_x + (ndc_x * 0.5f + 0.5f) * vpw;
    sv->sy = (float)g_rs.vp_y + (0.5f - ndc_y * 0.5f) * vph;
    sv->sz = g_rs.vp_minz + ndc_z * (g_rs.vp_maxz - g_rs.vp_minz);
    sv->inv_w = inv_w > 0.0f ? inv_w : 1e-5f;
}

static void draw_line_2d(int x0, int y0, int x1, int y1, uint32_t rgba)
{
    int dx = abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    int dy = -abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    int err = dx + dy;
    for (int steps = 0; steps < 2048; steps++) {
        if (x0 >= 0 && x0 < s_fb_w && y0 >= 0 && y0 < s_fb_h)
            s_color_buf[y0 * s_fb_w + x0] = rgba;
        if (x0 == x1 && y0 == y1) break;
        int e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
    }
}

static inline void select_d3d_arg(uint32_t arg, float dr, float dg, float db, float da,
                                  float tr, float tg, float tb, float ta,
                                  float tfr, float tfg, float tfb, float tfa,
                                  float *or_, float *og, float *ob, float *oa)
{
    uint32_t base = arg & 0x0Fu;
    if (base == 2u) { /* D3DTA_TEXTURE */
        *or_ = tr; *og = tg; *ob = tb; *oa = ta;
    } else if (base == 3u) { /* D3DTA_TFACTOR */
        *or_ = tfr; *og = tfg; *ob = tfb; *oa = tfa;
    } else { /* D3DTA_DIFFUSE (0) / D3DTA_CURRENT (1) */
        *or_ = dr; *og = dg; *ob = db; *oa = da;
    }
    if (arg & 0x10u) { /* D3DTA_COMPLEMENT */
        *or_ = 1.0f - *or_; *og = 1.0f - *og; *ob = 1.0f - *ob; *oa = 1.0f - *oa;
    }
    if (arg & 0x20u) { /* D3DTA_ALPHAREPLICATE */
        *or_ = *oa; *og = *oa; *ob = *oa;
    }
}

static void rasterize_tri(const SwVert *v0, const SwVert *v1, const SwVert *v2, int pretransformed)
{
    float area = (v1->sx - v0->sx) * (v2->sy - v0->sy) - (v1->sy - v0->sy) * (v2->sx - v0->sx);
    if (!pretransformed) {
        uint32_t cull = g_rs.rs[22];
        if (cull == 2u && area > 0.0f) return; /* D3DCULL_CW */
        if (cull == 3u && area < 0.0f) return; /* D3DCULL_CCW */
    }
    if (fabsf(area) < 1e-4f) return;

    if (g_rs.rs[8] == 2u) {
        uint32_t wc = 0xFF000000u | ((uint32_t)(v0->b * 255.0f) << 16) |
                      ((uint32_t)(v0->g * 255.0f) << 8) | (uint32_t)(v0->r * 255.0f);
        draw_line_2d((int)v0->sx, (int)v0->sy, (int)v1->sx, (int)v1->sy, wc);
        draw_line_2d((int)v1->sx, (int)v1->sy, (int)v2->sx, (int)v2->sy, wc);
        draw_line_2d((int)v2->sx, (int)v2->sy, (int)v0->sx, (int)v0->sy, wc);
        s_stat_tris++;
        return;
    }

    if (area < 0.0f) {
        const SwVert *tmp = v1; v1 = v2; v2 = tmp;
        area = -area;
    }
    float inv_area = 1.0f / area;

    float min_fx = fminf(v0->sx, fminf(v1->sx, v2->sx));
    float max_fx = fmaxf(v0->sx, fmaxf(v1->sx, v2->sx));
    float min_fy = fminf(v0->sy, fminf(v1->sy, v2->sy));
    float max_fy = fmaxf(v0->sy, fmaxf(v1->sy, v2->sy));

    int min_x = (int)floorf(min_fx); if (min_x < 0) min_x = 0;
    int max_x = (int)ceilf(max_fx);  if (max_x >= s_fb_w) max_x = s_fb_w - 1;
    int min_y = (int)floorf(min_fy); if (min_y < 0) min_y = 0;
    int max_y = (int)ceilf(max_fy);  if (max_y >= s_fb_h) max_y = s_fb_h - 1;
    if (min_x > max_x || min_y > max_y) return;

    s_stat_tris++;

    int zenable   = g_rs.rs[7] != 0;
    int zwrite    = g_rs.rs[14] != 0;
    uint32_t zfn  = g_rs.rs[23];
    int alphatest = g_rs.rs[15] != 0;
    uint32_t aref = g_rs.rs[24] & 0xFFu;
    int blend     = g_rs.rs[27] != 0;
    uint32_t sbl  = g_rs.rs[19], dbl = g_rs.rs[20];
    int fogen     = g_rs.rs[28] != 0;
    uint32_t fogc = g_rs.rs[34];
    float fog_s = 0.0f, fog_e = 1.0f;
    memcpy(&fog_s, &g_rs.rs[36], 4);
    memcpy(&fog_e, &g_rs.rs[37], 4);

    uint32_t tf = g_rs.rs[60];
    float tfr = ((tf >> 16) & 0xFFu) * (1.0f / 255.0f);
    float tfg = ((tf >> 8)  & 0xFFu) * (1.0f / 255.0f);
    float tfb = (tf         & 0xFFu) * (1.0f / 255.0f);
    float tfa = ((tf >> 24) & 0xFFu) * (1.0f / 255.0f);

    uint32_t cop0 = g_rs.stage[0].colorop;
    uint32_t aop0 = g_rs.stage[0].alphaop;
    const Surface *tex0 = (cop0 != 1u) ? g_rs.stage[0].texture : NULL;
    const Surface *tex1 = (tex0 && g_rs.stage[1].colorop != 1u) ? g_rs.stage[1].texture : NULL;
    uint32_t au0 = g_rs.stage[0].addressu, av0 = g_rs.stage[0].addressv;
    uint32_t au1 = g_rs.stage[1].addressu, av1 = g_rs.stage[1].addressv;
    int bilin0 = (g_rs.stage[0].magfilter == 2u) && !(pretransformed && tex0 && s_fb_w <= 800 && blend && !zenable);
    int bilin1 = (g_rs.stage[1].magfilter == 2u);

    float u0_0 = v0->u0 * v0->inv_w, v0_0 = v0->v0 * v0->inv_w;
    float u0_1 = v1->u0 * v1->inv_w, v0_1 = v1->v0 * v1->inv_w;
    float u0_2 = v2->u0 * v2->inv_w, v0_2 = v2->v0 * v2->inv_w;

    float u1_0 = v0->u1 * v0->inv_w, v1_0 = v0->v1 * v0->inv_w;
    float u1_1 = v1->u1 * v1->inv_w, v1_1 = v1->v1 * v1->inv_w;
    float u1_2 = v2->u1 * v2->inv_w, v1_2 = v2->v1 * v2->inv_w;

    for (int y = min_y; y <= max_y; y++) {
        float py = (float)y + 0.5f;
        uint32_t *crow = s_color_buf + y * s_fb_w;
        float    *zrow = s_depth_buf + y * s_fb_w;
        for (int x = min_x; x <= max_x; x++) {
            float px = (float)x + 0.5f;
            float w0 = ((v1->sx - px) * (v2->sy - py) - (v1->sy - py) * (v2->sx - px)) * inv_area;
            float w1 = ((v2->sx - px) * (v0->sy - py) - (v2->sy - py) * (v0->sx - px)) * inv_area;
            float w2 = 1.0f - w0 - w1;
            if (w0 < 0.0f || w1 < 0.0f || w2 < 0.0f)
                continue;

            float z = w0 * v0->sz + w1 * v1->sz + w2 * v2->sz;
            if (zenable && zfn != 8u) {
                float dz = zrow[x];
                if (zfn == 2u && !(z < dz)) continue;
                if ((zfn == 4u || zfn == 0u) && !(z <= dz)) continue;
                if (zfn == 5u && !(z > dz)) continue;
                if (zfn == 7u && !(z >= dz)) continue;
            }

            float iw = w0 * v0->inv_w + w1 * v1->inv_w + w2 * v2->inv_w;
            float w_rec = (iw > 1e-8f) ? (1.0f / iw) : 1.0f;

            float dr = w0 * v0->r + w1 * v1->r + w2 * v2->r;
            float dg = w0 * v0->g + w1 * v1->g + w2 * v2->g;
            float db = w0 * v0->b + w1 * v1->b + w2 * v2->b;
            float da = w0 * v0->a + w1 * v1->a + w2 * v2->a;

            float cr = dr, cg = dg, cb = db, ca = da;

            if (cop0 != 1u && (tex0 || g_rs.stage[0].colorarg1 != 2u)) {
                float tr = 1.0f, tg = 1.0f, tb = 1.0f, ta = 1.0f;
                if (tex0) {
                    float tu = (w0 * u0_0 + w1 * u0_1 + w2 * u0_2) * w_rec;
                    float tv = (w0 * v0_0 + w1 * v0_1 + w2 * v0_2) * w_rec;
                    uint32_t tc = sample_surface(tex0, tu, tv, au0, av0, bilin0);
                    tr = (tc & 0xFFu) * (1.0f / 255.0f);
                    tg = ((tc >> 8) & 0xFFu) * (1.0f / 255.0f);
                    tb = ((tc >> 16) & 0xFFu) * (1.0f / 255.0f);
                    ta = ((tc >> 24) & 0xFFu) * (1.0f / 255.0f);
                }
                float a1r, a1g, a1b, a1a, a2r, a2g, a2b, a2a;
                select_d3d_arg(g_rs.stage[0].colorarg1, dr, dg, db, da, tr, tg, tb, ta, tfr, tfg, tfb, tfa, &a1r, &a1g, &a1b, &a1a);
                select_d3d_arg(g_rs.stage[0].colorarg2, dr, dg, db, da, tr, tg, tb, ta, tfr, tfg, tfb, tfa, &a2r, &a2g, &a2b, &a2a);
                if (cop0 == 2u) { cr = a1r; cg = a1g; cb = a1b; }
                else if (cop0 == 3u) { cr = a2r; cg = a2g; cb = a2b; }
                else if (cop0 == 7u) { cr = fminf(1.0f, a1r + a2r); cg = fminf(1.0f, a1g + a2g); cb = fminf(1.0f, a1b + a2b); }
                else {
                    float mul = (cop0 == 5u) ? 2.0f : (cop0 == 6u ? 4.0f : 1.0f);
                    cr = fminf(1.0f, a1r * a2r * mul);
                    cg = fminf(1.0f, a1g * a2g * mul);
                    cb = fminf(1.0f, a1b * a2b * mul);
                }

                if (tex0) {
                    float aa1, aa2, dummy;
                    select_d3d_arg(g_rs.stage[0].alphaarg1, dr, dg, db, da, tr, tg, tb, ta, tfr, tfg, tfb, tfa, &dummy, &dummy, &dummy, &aa1);
                    select_d3d_arg(g_rs.stage[0].alphaarg2, dr, dg, db, da, tr, tg, tb, ta, tfr, tfg, tfb, tfa, &dummy, &dummy, &dummy, &aa2);
                    if (aop0 == 2u) ca = aa1;
                    else if (aop0 == 3u) ca = aa2;
                    else if (aop0 != 1u) ca = aa1 * aa2;
                }
            }

            if (tex1) {
                float tu1 = (w0 * u1_0 + w1 * u1_1 + w2 * u1_2) * w_rec;
                float tv1 = (w0 * v1_0 + w1 * v1_1 + w2 * v1_2) * w_rec;
                uint32_t tc1 = sample_surface(tex1, tu1, tv1, au1, av1, bilin1);
                float lr = (tc1 & 0xFFu) * (1.0f / 255.0f);
                float lg = ((tc1 >> 8) & 0xFFu) * (1.0f / 255.0f);
                float lb = ((tc1 >> 16) & 0xFFu) * (1.0f / 255.0f);
                if (g_rs.stage[1].colorop == 7u) {
                    cr = fminf(1.0f, cr + lr);
                    cg = fminf(1.0f, cg + lg);
                    cb = fminf(1.0f, cb + lb);
                } else {
                    float mul = (g_rs.stage[1].colorop == 5u) ? 2.0f : 1.0f;
                    cr = fminf(1.0f, cr * lr * mul);
                    cg = fminf(1.0f, cg * lg * mul);
                    cb = fminf(1.0f, cb * lb * mul);
                }
            }

            uint32_t ia = (uint32_t)(fminf(1.0f, fmaxf(0.0f, ca)) * 255.0f);
            if (alphatest) {
                uint32_t afn = g_rs.rs[25];
                if (afn == 5u && !(ia > aref)) continue;
                if ((afn == 7u || afn == 0u) && !(ia >= aref)) continue;
                if (afn == 2u && !(ia < aref)) continue;
                if (afn == 4u && !(ia <= aref)) continue;
            } else if (g_rs.rs[41] != 0 && ia == 0u) {
                continue;
            }

            if (fogen) {
                uint32_t fog_mode = g_rs.rs[35] ? g_rs.rs[35] : g_rs.rs[140];
                float ff = 1.0f;
                if (pretransformed || !fog_mode) {
                    ff = w0 * v0->fog + w1 * v1->fog + w2 * v2->fog;
                } else if (fog_e > fog_s + 0.001f) {
                    ff = (fog_e - w_rec) / (fog_e - fog_s);
                }
                if (ff < 0.0f) ff = 0.0f;
                if (ff > 1.0f) ff = 1.0f;
                float fr = ((fogc >> 16) & 0xFFu) * (1.0f / 255.0f);
                float fg = ((fogc >> 8) & 0xFFu) * (1.0f / 255.0f);
                float fb = (fogc & 0xFFu) * (1.0f / 255.0f);
                cr = cr * ff + fr * (1.0f - ff);
                cg = cg * ff + fg * (1.0f - ff);
                cb = cb * ff + fb * (1.0f - ff);
            }

            uint32_t ir = (uint32_t)(fminf(1.0f, fmaxf(0.0f, cr)) * 255.0f);
            uint32_t ig = (uint32_t)(fminf(1.0f, fmaxf(0.0f, cg)) * 255.0f);
            uint32_t ib = (uint32_t)(fminf(1.0f, fmaxf(0.0f, cb)) * 255.0f);

            if (blend) {
                uint32_t dst = crow[x];
                uint32_t dr0 = dst & 0xFFu, dg0 = (dst >> 8) & 0xFFu, db0 = (dst >> 16) & 0xFFu;
                if (sbl == 2u && dbl == 2u) {
                    ir = ir + dr0 > 255u ? 255u : ir + dr0;
                    ig = ig + dg0 > 255u ? 255u : ig + dg0;
                    ib = ib + db0 > 255u ? 255u : ib + db0;
                } else if (sbl == 1u && dbl == 3u) {
                    ir = (ir * dr0) >> 8;
                    ig = (ig * dg0) >> 8;
                    ib = (ib * db0) >> 8;
                } else {
                    ir = (ir * ia + dr0 * (255u - ia)) >> 8;
                    ig = (ig * ia + dg0 * (255u - ia)) >> 8;
                    ib = (ib * ia + db0 * (255u - ia)) >> 8;
                }
            }

            crow[x] = 0xFF000000u | (ib << 16) | (ig << 8) | ir;
            if (zenable && zwrite && z >= 0.0f && z <= 1.0f)
                zrow[x] = z;
        }
    }
}

static SwVert lerp_clip(const SwVert *a, const SwVert *b, float t)
{
    SwVert o;
    o.cx  = a->cx  + (b->cx  - a->cx)  * t;
    o.cy  = a->cy  + (b->cy  - a->cy)  * t;
    o.cz  = a->cz  + (b->cz  - a->cz)  * t;
    o.cw  = a->cw  + (b->cw  - a->cw)  * t;
    o.r   = a->r   + (b->r   - a->r)   * t;
    o.g   = a->g   + (b->g   - a->g)   * t;
    o.b   = a->b   + (b->b   - a->b)   * t;
    o.a   = a->a   + (b->a   - a->a)   * t;
    o.fog = a->fog + (b->fog - a->fog) * t;
    o.u0  = a->u0  + (b->u0  - a->u0)  * t;
    o.v0  = a->v0  + (b->v0  - a->v0)  * t;
    o.u1  = a->u1  + (b->u1  - a->u1)  * t;
    o.v1  = a->v1  + (b->v1  - a->v1)  * t;
    clip_to_screen(&o);
    return o;
}

static void clip_and_rasterize(SwVert a, SwVert b, SwVert c, int pretransformed)
{
    if (pretransformed) {
        rasterize_tri(&a, &b, &c, 1);
        return;
    }
    SwVert in_poly[4] = {a, b, c};
    SwVert out_poly[8];
    int n_out = 0;
    for (int i = 0; i < 3; i++) {
        const SwVert *cur = &in_poly[i];
        const SwVert *nxt = &in_poly[(i + 1) % 3];
        float d0 = cur->cz;
        float d1 = nxt->cz;
        int in0 = (d0 >= 0.0f && cur->cw > 0.005f);
        int in1 = (d1 >= 0.0f && nxt->cw > 0.005f);
        if (in0) out_poly[n_out++] = *cur;
        if (in0 != in1 && fabsf(d0 - d1) > 1e-6f) {
            float t = d0 / (d0 - d1);
            out_poly[n_out++] = lerp_clip(cur, nxt, t);
        }
    }
    if (n_out < 3) return;
    for (int i = 0; i < n_out; i++)
        clip_to_screen(&out_poly[i]);
    for (int i = 1; i + 1 < n_out; i++)
        rasterize_tri(&out_poly[0], &out_poly[i], &out_poly[i + 1], 0);
}

void render_draw(int prim, const RVertex *v, uint32_t nv, const uint16_t *idx, uint32_t ni,
                 int pretransformed, int has_normal, int has_color, int has_spec, int ntex)
{
    ensure_fb(s_fb_w, s_fb_h);
    if (!v || nv == 0) return;
    s_stat_draws++;

    static int s_dbg_mode = -1;
    if (s_dbg_mode < 0) s_dbg_mode = getenv("IGI_SKY_DBG") != NULL;
    if (s_dbg_mode && s_stat_draws <= 6) {
        fprintf(stderr, "[SKYDBG frm=%u drw=%u] pre=%d nrm=%d col=%d ntex=%d lgt=%u cv=%u ds=%u as=%u es=%u cop0=%u a1=%u a2=%u tf=%08X md=(%.2f,%.2f,%.2f) me=(%.2f,%.2f,%.2f) v0c=%08X\n",
                g_frame_serial, s_stat_draws, pretransformed, has_normal, has_color, ntex,
                g_rs.rs[137], g_rs.rs[141], g_rs.rs[145], g_rs.rs[147], g_rs.rs[148],
                g_rs.stage[0].colorop, g_rs.stage[0].colorarg1, g_rs.stage[0].colorarg2, g_rs.rs[60],
                g_rs.mat_diffuse[0], g_rs.mat_diffuse[1], g_rs.mat_diffuse[2],
                g_rs.mat_emissive[0], g_rs.mat_emissive[1], g_rs.mat_emissive[2], v[0].color);
    }

    float wv[16], wvp[16];
    if (!pretransformed) {
        mat4_mul_d3d(wv, g_rs.world, g_rs.view);
        mat4_mul_d3d(wvp, wv, g_rs.proj);
    }

    SwVert *sv = (SwVert *)malloc((size_t)nv * sizeof(SwVert));
    if (!sv) return;

    int do_light = !pretransformed && has_normal && (g_rs.rs[137] != 0);
    int uv_idx0 = (int)(g_rs.stage[0].texcoordindex & 0xFFFFu);
    int uv_idx1 = (int)(g_rs.stage[1].texcoordindex & 0xFFFFu);
    if (uv_idx0 >= ntex) uv_idx0 = 0;
    if (uv_idx1 >= ntex) uv_idx1 = 0;

    for (uint32_t i = 0; i < nv; i++) {
        const RVertex *rv = &v[i];
        SwVert *o = &sv[i];
        if (has_color) {
            o->r = (rv->color & 0xFFu) * (1.0f / 255.0f);
            o->g = ((rv->color >> 8) & 0xFFu) * (1.0f / 255.0f);
            o->b = ((rv->color >> 16) & 0xFFu) * (1.0f / 255.0f);
            o->a = ((rv->color >> 24) & 0xFFu) * (1.0f / 255.0f);
        } else {
            o->r = o->g = o->b = o->a = 1.0f;
        }
        o->fog = has_spec ? ((float)(rv->spec >> 24) * (1.0f / 255.0f)) : 1.0f;
        if (do_light) {
            int col_vert = (g_rs.rs[141] != 0) && has_color;
            float diff_r = (col_vert && g_rs.rs[145] == 1u) ? o->r : g_rs.mat_diffuse[0];
            float diff_g = (col_vert && g_rs.rs[145] == 1u) ? o->g : g_rs.mat_diffuse[1];
            float diff_b = (col_vert && g_rs.rs[145] == 1u) ? o->b : g_rs.mat_diffuse[2];
            float diff_a = (col_vert && g_rs.rs[145] == 1u) ? o->a : g_rs.mat_diffuse[3];

            float amb_m_r = (col_vert && g_rs.rs[147] == 1u) ? o->r : g_rs.mat_ambient[0];
            float amb_m_g = (col_vert && g_rs.rs[147] == 1u) ? o->g : g_rs.mat_ambient[1];
            float amb_m_b = (col_vert && g_rs.rs[147] == 1u) ? o->b : g_rs.mat_ambient[2];

            float emi_r = (col_vert && g_rs.rs[148] == 1u) ? o->r : g_rs.mat_emissive[0];
            float emi_g = (col_vert && g_rs.rs[148] == 1u) ? o->g : g_rs.mat_emissive[1];
            float emi_b = (col_vert && g_rs.rs[148] == 1u) ? o->b : g_rs.mat_emissive[2];

            uint32_t gamb = g_rs.rs[139];
            float ga_r = ((gamb >> 16) & 0xFFu) * (1.0f / 255.0f);
            float ga_g = ((gamb >> 8)  & 0xFFu) * (1.0f / 255.0f);
            float ga_b = (gamb         & 0xFFu) * (1.0f / 255.0f);

            float lr = emi_r + ga_r * amb_m_r;
            float lg = emi_g + ga_g * amb_m_g;
            float lb = emi_b + ga_b * amb_m_b;

            for (int li = 0; li < MAX_LIGHTS; li++) {
                const Light *lt = &g_rs.lights[li];
                if (!lt->enabled) continue;
                lr += lt->ambient[0] * amb_m_r;
                lg += lt->ambient[1] * amb_m_g;
                lb += lt->ambient[2] * amb_m_b;
                float ndl = 0.0f;
                if (lt->type == 3u) {
                    ndl = -(rv->nx * lt->dir[0] + rv->ny * lt->dir[1] + rv->nz * lt->dir[2]);
                } else {
                    float dx = lt->pos[0] - rv->x, dy = lt->pos[1] - rv->y, dz = lt->pos[2] - rv->z;
                    float d2 = dx * dx + dy * dy + dz * dz;
                    if (d2 > 1e-6f) {
                        float inv_d = 1.0f / sqrtf(d2);
                        ndl = (rv->nx * dx + rv->ny * dy + rv->nz * dz) * inv_d;
                    }
                }
                if (ndl > 0.0f) {
                    lr += ndl * lt->diffuse[0] * diff_r;
                    lg += ndl * lt->diffuse[1] * diff_g;
                    lb += ndl * lt->diffuse[2] * diff_b;
                }
            }
            o->r = fminf(1.0f, fmaxf(0.0f, lr));
            o->g = fminf(1.0f, fmaxf(0.0f, lg));
            o->b = fminf(1.0f, fmaxf(0.0f, lb));
            o->a = fminf(1.0f, fmaxf(0.0f, diff_a));
        }
        o->u0 = (ntex >= 1) ? rv->uv[uv_idx0][0] : 0.0f;
        o->v0 = (ntex >= 1) ? rv->uv[uv_idx0][1] : 0.0f;
        o->u1 = (ntex >= 1) ? rv->uv[uv_idx1][0] : 0.0f;
        o->v1 = (ntex >= 1) ? rv->uv[uv_idx1][1] : 0.0f;

        if (pretransformed) {
            o->sx = rv->x + 0.5f;
            o->sy = rv->y + 0.5f;
            o->sz = rv->z;
            o->inv_w = (rv->w > 1e-7f) ? rv->w : 1.0f;
            o->cx = rv->x; o->cy = rv->y; o->cz = rv->z; o->cw = 1.0f;
        } else {
            o->cx = rv->x * wvp[0] + rv->y * wvp[4] + rv->z * wvp[8]  + wvp[12];
            o->cy = rv->x * wvp[1] + rv->y * wvp[5] + rv->z * wvp[9]  + wvp[13];
            o->cz = rv->x * wvp[2] + rv->y * wvp[6] + rv->z * wvp[10] + wvp[14];
            o->cw = rv->x * wvp[3] + rv->y * wvp[7] + rv->z * wvp[11] + wvp[15];
        }
    }

    uint32_t count = idx ? ni : nv;
    #define IDX(k) (idx ? idx[k] : (uint16_t)(k))
    if (prim == PRIM_TRIANGLES) {
        for (uint32_t k = 0; k + 2 < count; k += 3) {
            uint16_t i0 = IDX(k), i1 = IDX(k + 1), i2 = IDX(k + 2);
            if (i0 < nv && i1 < nv && i2 < nv)
                clip_and_rasterize(sv[i0], sv[i1], sv[i2], pretransformed);
        }
    } else if (prim == PRIM_TRIANGLE_STRIP) {
        for (uint32_t k = 0; k + 2 < count; k++) {
            uint16_t i0 = IDX(k), i1 = IDX(k + 1), i2 = IDX(k + 2);
            if (i0 < nv && i1 < nv && i2 < nv) {
                if (k & 1u)
                    clip_and_rasterize(sv[i1], sv[i0], sv[i2], pretransformed);
                else
                    clip_and_rasterize(sv[i0], sv[i1], sv[i2], pretransformed);
            }
        }
    } else if (prim == PRIM_TRIANGLE_FAN) {
        for (uint32_t k = 1; k + 1 < count; k++) {
            uint16_t i0 = IDX(0), i1 = IDX(k), i2 = IDX(k + 1);
            if (i0 < nv && i1 < nv && i2 < nv)
                clip_and_rasterize(sv[i0], sv[i1], sv[i2], pretransformed);
        }
    } else if (prim == PRIM_LINES) {
        for (uint32_t k = 0; k + 1 < count; k += 2) {
            uint16_t i0 = IDX(k), i1 = IDX(k + 1);
            if (i0 < nv && i1 < nv) {
                SwVert a = sv[i0], b = sv[i1];
                if (!pretransformed) { clip_to_screen(&a); clip_to_screen(&b); }
                uint32_t lc = 0xFF000000u | ((uint32_t)(a.b * 255.0f) << 16) |
                              ((uint32_t)(a.g * 255.0f) << 8) | (uint32_t)(a.r * 255.0f);
                draw_line_2d((int)a.sx, (int)a.sy, (int)b.sx, (int)b.sy, lc);
            }
        }
    } else if (prim == PRIM_LINE_STRIP) {
        for (uint32_t k = 0; k + 1 < count; k++) {
            uint16_t i0 = IDX(k), i1 = IDX(k + 1);
            if (i0 < nv && i1 < nv) {
                SwVert a = sv[i0], b = sv[i1];
                if (!pretransformed) { clip_to_screen(&a); clip_to_screen(&b); }
                uint32_t lc = 0xFF000000u | ((uint32_t)(a.b * 255.0f) << 16) |
                              ((uint32_t)(a.g * 255.0f) << 8) | (uint32_t)(a.r * 255.0f);
                draw_line_2d((int)a.sx, (int)a.sy, (int)b.sx, (int)b.sy, lc);
            }
        }
    } else if (prim == PRIM_POINTS) {
        for (uint32_t k = 0; k < count; k++) {
            uint16_t i0 = IDX(k);
            if (i0 < nv) {
                SwVert a = sv[i0];
                if (!pretransformed) {
                    if (a.cw <= 0.01f) continue;
                    clip_to_screen(&a);
                }
                int px = (int)a.sx, py = (int)a.sy;
                if (px >= 0 && px < s_fb_w && py >= 0 && py < s_fb_h) {
                    uint32_t pc = 0xFF000000u | ((uint32_t)(a.b * 255.0f) << 16) |
                                  ((uint32_t)(a.g * 255.0f) << 8) | (uint32_t)(a.r * 255.0f);
                    s_color_buf[py * s_fb_w + px] = pc;
                }
            }
        }
    }
    #undef IDX
    free(sv);
}
