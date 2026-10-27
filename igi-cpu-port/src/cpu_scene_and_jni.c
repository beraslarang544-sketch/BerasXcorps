/*
 * Mission 01 ("Trainyard") Real-Asset Direct3D 7 CPU Software Scene Driver
 * + Android JNI Native Wrapper Bridge (libigi_cpu_port.so)
 *
 * Drives the exact Direct3D 7 CPU Software Rasterizer (render_cpu_sw.c)
 * using real extracted Project I.G.I. textures, terrain.hmp elevation data,
 * and objects.qsc buildings, trainyard tracks, guards, and objectives.
 */
#include "platform.h"
#include "render.h"
#include "runtime.h"
#include "mission1_embedded_assets.h"

#ifdef __ANDROID__
#include <jni.h>
#include <android/log.h>
#endif

#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

extern const uint32_t *cpu_sw_framebuffer(int *w, int *h);
extern void cpu_sw_stats(uint32_t *frames, uint32_t *draws, uint32_t *tris);
extern void cpu_sw_draw_text(int x, int y, const char *s, uint32_t rgba);

#define MAX_M1_ENTITIES 512

typedef struct M1Entity {
    int type; /* 1=Building, 2=HumanSoldier, 3=Train/Track, 4=Camera, 5=Objective, 6=Player */
    float x, y, z; /* meters relative to compound center */
    float sx, sy, sz;
} M1Entity;

static Surface s_tex_ground;
static Surface s_tex_wall;
static Surface s_tex_sky;
static uint8_t s_hmp_grid[128 * 128];
static M1Entity s_ents[MAX_M1_ENTITIES];
static int s_num_ents = 0;
static int s_scene_ready = 0;

static float s_cam_x = -28.0f;
static float s_cam_y = 14.5f;
static float s_cam_z = -42.0f;
static float s_cam_yaw = 0.62f;
static float s_cam_pitch = -0.16f;
static float s_sim_time = 0.0f;

static void alloc_rgba_surface(Surface *s, uint32_t w, uint32_t h, const uint32_t *pixels)
{
    memset(s, 0, sizeof(*s));
    s->refs = 1;
    s->w = w;
    s->h = h;
    s->pitch = w * 4u;
    s->pf = pixfmt_rgb(32);
    s->pf.flags = DDPF_RGB | DDPF_ALPHAPIXELS;
    s->pf.a = 0xFF000000u;
    s->pf.r = 0x000000FFu;
    s->pf.g = 0x0000FF00u;
    s->pf.b = 0x00FF0000u;
    s->mem = scratch_alloc(w * h * 4u, 16);
    memcpy(g_mem + s->mem, pixels, (size_t)w * h * 4u);
}

/* Load uncompressed 24/32-bit TGA exported by igi1conv from terrain.tex */
static int load_tga_to_surface(Surface *s, const char *path)
{
    FILE *f = fopen(path, "rb");
    if (!f) return 0;
    uint8_t hdr[18];
    if (fread(hdr, 1, 18, f) != 18) { fclose(f); return 0; }
    int w = hdr[12] | (hdr[13] << 8);
    int h = hdr[14] | (hdr[15] << 8);
    int bpp = hdr[16];
    if (w <= 0 || h <= 0 || w > 1024 || h > 1024 || (bpp != 16 && bpp != 24 && bpp != 32)) {
        fclose(f);
        return 0;
    }
    fseek(f, 18 + hdr[0], SEEK_SET);
    uint32_t *rgba = (uint32_t *)malloc((size_t)w * (size_t)h * 4u);
    if (!rgba) { fclose(f); return 0; }
    int bytes = bpp / 8;
    int flip_y = (hdr[17] & 0x20) == 0;
    for (int y = 0; y < h; y++) {
        int dy = flip_y ? (h - 1 - y) : y;
        for (int x = 0; x < w; x++) {
            uint8_t px[4] = {0, 0, 0, 255};
            if (fread(px, 1, (size_t)bytes, f) != (size_t)bytes) break;
            if (bpp == 16) {
                uint16_t v = (uint16_t)(px[0] | (px[1] << 8));
                uint32_t r = ((v >> 10) & 0x1Fu) * 255u / 31u;
                uint32_t g = ((v >> 5)  & 0x1Fu) * 255u / 31u;
                uint32_t b = (v         & 0x1Fu) * 255u / 31u;
                rgba[dy * w + x] = 0xFF000000u | (b << 16) | (g << 8) | r;
            } else {
                rgba[dy * w + x] = ((uint32_t)px[3] << 24) | ((uint32_t)px[0] << 16) |
                                   ((uint32_t)px[1] << 8) | (uint32_t)px[2];
            }
        }
    }
    fclose(f);
    alloc_rgba_surface(s, (uint32_t)w, (uint32_t)h, rgba);
    free(rgba);
    return 1;
}

static void generate_procedural_fallback_tex(Surface *s, int style)
{
    uint32_t px[64 * 64];
    for (int y = 0; y < 64; y++) {
        for (int x = 0; x < 64; x++) {
            uint32_t n = (uint32_t)((x * 37 + y * 91) ^ (x * y));
            if (style == 0) { /* Mossy snow rock */
                uint32_t g = 75u + (n & 47u);
                px[y * 64 + x] = 0xFF000000u | ((g - 15u) << 16) | ((g + 12u) << 8) | g;
            } else if (style == 1) { /* Industrial concrete bunker wall */
                int seam = (y % 16 == 0) || ((x + (y / 16) * 16) % 32 == 0);
                uint32_t v = seam ? 55u : (115u + (n & 31u));
                px[y * 64 + x] = 0xFF000000u | ((v + 6u) << 16) | (v << 8) | (v - 4u);
            } else { /* Overcast Nordic sky */
                uint32_t c = 135u + ((uint32_t)(x ^ y) & 31u);
                px[y * 64 + x] = 0xFF000000u | ((c + 35u) << 16) | ((c + 12u) << 8) | c;
            }
        }
    }
    alloc_rgba_surface(s, 64, 64, px);
}

static float sample_terrain_h(float wx, float wz)
{
    float gx = (wx + 128.0f) * 0.5f;
    float gz = (wz + 128.0f) * 0.5f;
    int ix = (int)gx;
    int iz = (int)gz;
    if (ix < 0) ix = 0; else if (ix > 127) ix = 127;
    if (iz < 0) iz = 0; else if (iz > 127) iz = 127;
    /* Blend gentle surrounding hills outside flat compound yard */
    float dist_center = sqrtf(wx * wx + wz * wz);
    float ridge = (dist_center > 42.0f) ? ((dist_center - 42.0f) * 0.22f *
                   (0.6f + 0.4f * sinf(wx * 0.08f) * cosf(wz * 0.07f))) : 0.0f;
    float hmp_mod = ((float)s_hmp_grid[iz * 128 + ix] - 128.0f) * 0.015f;
    return ridge + hmp_mod;
}

static void parse_mission1_objects(const char *qsc_path)
{
    FILE *f = fopen(qsc_path, "r");
    if (!f) return;
    char line[1024];
    double sum_x = 0.0, sum_y = 0.0;
    int count_center = 0;
    typedef struct RawEnt { int type; double wx, wy, wz; } RawEnt;
    RawEnt raw[MAX_M1_ENTITIES];
    int n_raw = 0;

    while (fgets(line, sizeof(line), f) && n_raw < MAX_M1_ENTITIES) {
        const char *tn = strstr(line, "Task_New(");
        if (!tn)
            continue;
        const char *q1 = strchr(tn, '"');
        if (!q1) continue;
        const char *q2 = strchr(q1 + 1, '"');
        if (!q2) continue;
        char cls[64] = {0};
        size_t clen = (size_t)(q2 - (q1 + 1));
        if (clen >= sizeof(cls)) clen = sizeof(cls) - 1;
        memcpy(cls, q1 + 1, clen);

        const char *q3 = strchr(q2 + 1, '"');
        if (!q3) continue;
        const char *q4 = strchr(q3 + 1, '"');
        if (!q4) continue;
        const char *comma = strchr(q4 + 1, ',');
        if (!comma) continue;

        double x = 0, y = 0, z = 0;
        if (sscanf(comma + 1, " %lf , %lf , %lf", &x, &y, &z) < 3)
            continue;
        if (fabs(x) < 500.0 && fabs(y) < 500.0)
            continue;

        int t = 0;
        if (strcmp(cls, "Building") == 0) t = 1;
        else if (strcmp(cls, "HumanSoldier") == 0) t = 2;
        else if (strcmp(cls, "SplineObjWaypoint") == 0 || strcmp(cls, "Train") == 0) t = 3;
        else if (strcmp(cls, "SecurityCamera") == 0) t = 4;
        else if (strcmp(cls, "ComputerHilight") == 0) t = 5;
        else if (strcmp(cls, "HumanPlayer") == 0) t = 6;
        if (!t) continue;

        raw[n_raw].type = t;
        raw[n_raw].wx = x / 4096.0;
        raw[n_raw].wy = y / 4096.0;
        raw[n_raw].wz = z / 4096.0;
        if (t == 1 || t == 2 || t == 6) {
            sum_x += raw[n_raw].wx;
            sum_y += raw[n_raw].wy;
            count_center++;
        }
        n_raw++;
    }
    fclose(f);

    double cx = count_center ? (sum_x / count_center) : 0.0;
    double cy = count_center ? (sum_y / count_center) : 0.0;
    s_num_ents = 0;
    for (int i = 0; i < n_raw && s_num_ents < MAX_M1_ENTITIES; i++) {
        float rx = (float)((raw[i].wx - cx) * 0.35);
        float rz = (float)((raw[i].wy - cy) * 0.35);
        if (fabsf(rx) > 120.0f || fabsf(rz) > 120.0f)
            continue;
        M1Entity *e = &s_ents[s_num_ents++];
        e->type = raw[i].type;
        e->x = rx;
        e->z = rz;
        e->y = sample_terrain_h(rx, rz);
        if (e->type == 1) { e->sx = 5.5f; e->sy = 4.8f; e->sz = 6.2f; }
        else if (e->type == 2) { e->sx = 0.55f; e->sy = 1.85f; e->sz = 0.55f; }
        else if (e->type == 3) { e->sx = 2.6f; e->sy = 2.8f; e->sz = 5.8f; }
        else if (e->type == 5) { e->sx = 0.8f; e->sy = 3.2f; e->sz = 0.8f; }
        else { e->sx = 0.7f; e->sy = 1.8f; e->sz = 0.7f; }

        if (e->type == 6) {
            s_cam_x = e->x - 10.0f;
            s_cam_z = e->z - 14.0f;
            s_cam_y = e->y + 6.5f;
        }
    }
}

static void alloc_rgb565_embedded_surface(Surface *s, uint32_t w, uint32_t h, const uint16_t *rgb565)
{
    uint32_t *rgba = (uint32_t *)malloc((size_t)w * (size_t)h * 4u);
    if (!rgba) return;
    for (uint32_t i = 0; i < w * h; i++) {
        uint16_t v = rgb565[i];
        uint32_t r = ((v >> 11) & 0x1Fu) * 255u / 31u;
        uint32_t g = ((v >> 5)  & 0x3Fu) * 255u / 63u;
        uint32_t b = (v         & 0x1Fu) * 255u / 31u;
        rgba[i] = 0xFF000000u | (b << 16) | (g << 8) | r;
    }
    alloc_rgba_surface(s, w, h, rgba);
    free(rgba);
}

void igi_cpu_scene_init(const char *assets_root, int width, int height)
{
    if (!g_mem)
        mem_init();
    platform_init();
    platform_set_video_mode(width, height);
    render_init(width, height);

    memcpy(s_hmp_grid, g_m1_embedded_hmp, sizeof(s_hmp_grid));
    char path[1024];
    if (assets_root) {
        snprintf(path, sizeof(path), "%s/missions/location0/level1/terrain/terrain.hmp", assets_root);
        FILE *hf = fopen(path, "rb");
        if (hf) {
            fseek(hf, 0, SEEK_END);
            long sz = ftell(hf);
            if (sz >= 16384) {
                fseek(hf, sz - 16384, SEEK_SET);
                if (fread(s_hmp_grid, 1, 16384, hf) != 16384) {}
            }
            fclose(hf);
        }
    }

    int ok_g = 0, ok_w = 0;
    s_num_ents = 0;
    if (assets_root) {
        snprintf(path, sizeof(path), "%s/../reverse_inspection/textures_png/level1_terrain_tiles/terrain.#07.tga", assets_root);
        ok_g = load_tga_to_surface(&s_tex_ground, path);
        snprintf(path, sizeof(path), "%s/../reverse_inspection/textures_png/level1_terrain_tiles/terrain.#17.tga", assets_root);
        ok_w = load_tga_to_surface(&s_tex_wall, path);
        snprintf(path, sizeof(path), "%s/missions/location0/level1/objects.qsc", assets_root);
        parse_mission1_objects(path);
    }
    if (!ok_g) {
        alloc_rgb565_embedded_surface(&s_tex_ground, 64, 64, g_m1_embedded_ground_565);
        ok_g = 1;
    }
    if (!ok_w) {
        alloc_rgb565_embedded_surface(&s_tex_wall, 64, 64, g_m1_embedded_wall_565);
        ok_w = 1;
    }
    generate_procedural_fallback_tex(&s_tex_sky, 2);

    if (s_num_ents == 0) {
        for (int i = 0; i < EMBEDDED_M1_ENT_COUNT && s_num_ents < MAX_M1_ENTITIES; i++) {
            M1Entity *e = &s_ents[s_num_ents++];
            e->type = g_m1_embedded_ents[i].type;
            e->x = g_m1_embedded_ents[i].rx;
            e->z = g_m1_embedded_ents[i].rz;
            e->y = sample_terrain_h(e->x, e->z);
            if (e->type == 1) { e->sx = 5.5f; e->sy = 4.8f; e->sz = 6.2f; }
            else if (e->type == 2) { e->sx = 0.55f; e->sy = 1.85f; e->sz = 0.55f; }
            else if (e->type == 3) { e->sx = 2.6f; e->sy = 2.8f; e->sz = 5.8f; }
            else if (e->type == 5) { e->sx = 0.8f; e->sy = 3.2f; e->sz = 0.8f; }
            else { e->sx = 0.7f; e->sy = 1.8f; e->sz = 0.7f; }

            if (e->type == 6) {
                s_cam_x = -26.0f;
                s_cam_z = -38.0f;
                s_cam_y = sample_terrain_h(s_cam_x, s_cam_z) + 11.5f;
                s_cam_yaw = atan2f(-s_cam_x, -s_cam_z);
                s_cam_pitch = -0.18f;
            }
        }
    }
    s_scene_ready = 1;
#ifdef __ANDROID__
    __android_log_print(ANDROID_LOG_INFO, "IGICpuPort",
        "[cpu-scene] Mission 1 Trainyard initialized: %d entities, %dx%d software D3D7 target",
        s_num_ents, width, height);
#endif
    rt_log("[cpu-scene] Mission 1 Trainyard initialized: %d entities, %dx%d software D3D7 target",
           s_num_ents, width, height);
}

static void set_identity(float m[16])
{
    memset(m, 0, 16 * sizeof(float));
    m[0] = m[5] = m[10] = m[15] = 1.0f;
}

static void set_look_view(float m[16], float ex, float ey, float ez, float yaw, float pitch)
{
    float cy = cosf(yaw), sy = sinf(yaw);
    float cp = cosf(pitch), sp = sinf(pitch);
    float fx = sy * cp, fy = sp, fz = cy * cp;
    /* Right = up x forward (left-handed D3D7 view space) */
    float rx = cy, ry = 0.0f, rz = -sy;
    float ux = fy * rz - fz * ry;
    float uy = fz * rx - fx * rz;
    float uz = fx * ry - fy * rx;
    memset(m, 0, 16 * sizeof(float));
    m[0] = rx; m[1] = ux; m[2] = fx;
    m[4] = ry; m[5] = uy; m[6] = fy;
    m[8] = rz; m[9] = uz; m[10] = fz;
    m[12] = -(rx * ex + ry * ey + rz * ez);
    m[13] = -(ux * ex + uy * ey + uz * ez);
    m[14] = -(fx * ex + fy * ey + fz * ez);
    m[15] = 1.0f;
}

static void set_perspective_d3d(float m[16], float fov_y, float aspect, float zn, float zf)
{
    float h = 1.0f / tanf(fov_y * 0.5f);
    float w = h / aspect;
    memset(m, 0, 16 * sizeof(float));
    m[0] = w;
    m[5] = h;
    m[10] = zf / (zf - zn);
    m[11] = 1.0f;
    m[14] = -zn * zf / (zf - zn);
}

static void emit_box(float cx, float y0, float cz, float hx, float hy, float hz, uint32_t col_top, uint32_t col_side)
{
    float y1 = y0 + hy;
    RVertex v[24];
    uint16_t idx[36];
    memset(v, 0, sizeof(v));
    const float pos[8][3] = {
        {cx - hx, y0, cz - hz}, {cx + hx, y0, cz - hz}, {cx + hx, y1, cz - hz}, {cx - hx, y1, cz - hz},
        {cx - hx, y0, cz + hz}, {cx + hx, y0, cz + hz}, {cx + hx, y1, cz + hz}, {cx - hx, y1, cz + hz}
    };
    const int faces[6][4] = {
        {0,1,2,3}, {5,4,7,6}, {4,0,3,7}, {1,5,6,2}, {3,2,6,7}, {4,5,1,0}
    };
    for (int f = 0; f < 6; f++) {
        uint32_t c = (f == 4) ? col_top : col_side;
        for (int k = 0; k < 4; k++) {
            RVertex *rv = &v[f * 4 + k];
            const float *p = pos[faces[f][k]];
            rv->x = p[0]; rv->y = p[1]; rv->z = p[2]; rv->w = 1.0f;
            rv->color = c;
            rv->uv[0][0] = (k == 1 || k == 2) ? 2.0f : 0.0f;
            rv->uv[0][1] = (k >= 2) ? 0.0f : 2.0f;
        }
        uint16_t b = (uint16_t)(f * 4);
        idx[f * 6 + 0] = b + 0; idx[f * 6 + 1] = b + 2; idx[f * 6 + 2] = b + 1;
        idx[f * 6 + 3] = b + 0; idx[f * 6 + 4] = b + 3; idx[f * 6 + 5] = b + 2;
    }
    render_draw(PRIM_TRIANGLES, v, 24, idx, 36, 0, 0, 1, 0, 1);
}

void igi_cpu_scene_step(float dt)
{
    if (!s_scene_ready)
        igi_cpu_scene_init(NULL, 640, 480);

    platform_pump();
    s_sim_time += dt;

    /* Handle keyboard/scripted input (WASD + Arrow keys) */
    float move_spd = 22.0f * dt;
    float turn_spd = 1.4f * dt;
    if (g_key_state[0xCB]) s_cam_yaw -= turn_spd; /* Left */
    if (g_key_state[0xCD]) s_cam_yaw += turn_spd; /* Right */
    if (g_key_state[0xC8]) s_cam_pitch += turn_spd * 0.6f; /* Up */
    if (g_key_state[0xD0]) s_cam_pitch -= turn_spd * 0.6f; /* Down */
    if (g_mouse.dx != 0 || g_mouse.dy != 0) {
        s_cam_yaw   += (float)g_mouse.dx * 0.005f;
        s_cam_pitch -= (float)g_mouse.dy * 0.005f;
        g_mouse.dx = g_mouse.dy = 0;
    }
    if (s_cam_pitch > 1.1f)  s_cam_pitch = 1.1f;
    if (s_cam_pitch < -1.1f) s_cam_pitch = -1.1f;

    float fx = sinf(s_cam_yaw), fz = cosf(s_cam_yaw);
    float rx = cosf(s_cam_yaw), rz = -sinf(s_cam_yaw);
    if (g_key_state[0x11]) { s_cam_x += fx * move_spd; s_cam_z += fz * move_spd; } /* W */
    if (g_key_state[0x1F]) { s_cam_x -= fx * move_spd; s_cam_z -= fz * move_spd; } /* S */
    if (g_key_state[0x1E]) { s_cam_x -= rx * move_spd; s_cam_z -= rz * move_spd; } /* A */
    if (g_key_state[0x20]) { s_cam_x += rx * move_spd; s_cam_z += rz * move_spd; } /* D */
    if (g_key_state[0x10]) { s_cam_y += move_spd; } /* Q */
    if (g_key_state[0x2C]) { s_cam_y -= move_spd; } /* Z */

    float ground_h = sample_terrain_h(s_cam_x, s_cam_z) + 2.2f;
    if (s_cam_y < ground_h) s_cam_y = ground_h;

    int fbw = 640, fbh = 480;
    cpu_sw_framebuffer(&fbw, &fbh);

    render_begin_frame();
    /* Clear target to Nordic winter haze (0xAARRGGBB) + depth=1.0 */
    render_clear(0, NULL, 3u, 0xFF8CA2B4u, 1.0f);

    set_identity(g_rs.world);
    set_look_view(g_rs.view, s_cam_x, s_cam_y, s_cam_z, s_cam_yaw, s_cam_pitch);
    set_perspective_d3d(g_rs.proj, 1.05f, (float)fbw / (float)fbh, 0.5f, 220.0f);
    g_rs.vp_x = 0; g_rs.vp_y = 0; g_rs.vp_w = fbw; g_rs.vp_h = fbh;
    g_rs.vp_minz = 0.0f; g_rs.vp_maxz = 1.0f;

    /* Enable D3D7 distance fog */
    g_rs.rs[7]  = 1u; /* ZENABLE */
    g_rs.rs[14] = 1u; /* ZWRITE */
    g_rs.rs[22] = 1u; /* CULL_NONE */
    g_rs.rs[27] = 0u; /* ALPHABLEND OFF */
    g_rs.rs[28] = 1u; /* FOGENABLE */
    g_rs.rs[34] = 0xFF8CA2B4u;
    float fog_s = 45.0f, fog_e = 155.0f;
    memcpy(&g_rs.rs[36], &fog_s, 4);
    memcpy(&g_rs.rs[37], &fog_e, 4);

    /* 1. Render Terrain Mesh Grid (36x36 quads around compound) with real terrain.tex */
    g_rs.stage[0].colorop = 4u; /* D3DTOP_MODULATE */
    g_rs.stage[0].texture = &s_tex_ground;
    g_rs.stage[1].colorop = 1u; /* DISABLED */
    const int GN = 36;
    const float STEP = 5.0f;
    const float ORIGIN = -90.0f;
    RVertex *tv = (RVertex *)malloc((size_t)(GN + 1) * (size_t)(GN + 1) * sizeof(RVertex));
    uint16_t *ti = (uint16_t *)malloc((size_t)GN * (size_t)GN * 6u * sizeof(uint16_t));
    if (tv && ti) {
        for (int gz = 0; gz <= GN; gz++) {
            for (int gx = 0; gx <= GN; gx++) {
                float wx = ORIGIN + (float)gx * STEP;
                float wz = ORIGIN + (float)gz * STEP;
                float wy = sample_terrain_h(wx, wz);
                RVertex *v = &tv[gz * (GN + 1) + gx];
                memset(v, 0, sizeof(*v));
                v->x = wx; v->y = wy; v->z = wz; v->w = 1.0f;
                /* Subtle baked shadow near compound structures */
                uint32_t shade = (uint32_t)(185.0f + fminf(65.0f, wy * 8.0f));
                v->color = 0xFF000000u | (shade << 16) | (shade << 8) | shade;
                v->uv[0][0] = (float)gx * 0.5f;
                v->uv[0][1] = (float)gz * 0.5f;
            }
        }
        uint32_t k = 0;
        for (int gz = 0; gz < GN; gz++) {
            for (int gx = 0; gx < GN; gx++) {
                uint16_t i0 = (uint16_t)(gz * (GN + 1) + gx);
                uint16_t i1 = i0 + 1;
                uint16_t i2 = i0 + (GN + 1);
                uint16_t i3 = i2 + 1;
                ti[k++] = i0; ti[k++] = i2; ti[k++] = i1;
                ti[k++] = i1; ti[k++] = i2; ti[k++] = i3;
            }
        }
        render_draw(PRIM_TRIANGLES, tv, (uint32_t)((GN + 1) * (GN + 1)), ti, k, 0, 0, 1, 0, 1);
    }
    free(tv);
    free(ti);

    /* 2. Render Mission 1 Compound Buildings, Train Cars, Guards, and Objectives */
    for (int i = 0; i < s_num_ents; i++) {
        const M1Entity *e = &s_ents[i];
        if (e->type == 1) { /* Building */
            g_rs.stage[0].colorop = 4u;
            g_rs.stage[0].texture = &s_tex_wall;
            emit_box(e->x, e->y, e->z, e->sx * 0.5f, e->sy, e->sz * 0.5f, 0xFF98A2A8u, 0xFFD8E0E4u);
        } else if (e->type == 3) { /* Freight Train Car */
            g_rs.stage[0].colorop = 4u;
            g_rs.stage[0].texture = &s_tex_wall;
            emit_box(e->x, e->y, e->z, e->sx * 0.5f, e->sy, e->sz * 0.5f, 0xFF485478u, 0xFF5A6896u);
        } else if (e->type == 2) { /* Animated Patrol Guard (HumanSoldier) */
            g_rs.stage[0].colorop = 1u; /* Untextured tactical highlight */
            float px = e->x + sinf(s_sim_time * 1.3f + (float)i) * 2.4f;
            float pz = e->z + cosf(s_sim_time * 1.3f + (float)i) * 2.4f;
            float py = sample_terrain_h(px, pz);
            emit_box(px, py, pz, 0.35f, 1.8f, 0.35f, 0xFF4444FFu, 0xFF2E38CCu);
        } else if (e->type == 5) { /* Cyan Mission Objective Beacon */
            g_rs.stage[0].colorop = 1u;
            emit_box(e->x, e->y, e->z, 0.4f, 3.6f, 0.4f, 0xFFFFFF44u, 0xFFCCDD22u);
        }
    }

    /* 3. Pre-transformed 2D I.G.I. Tactical Crosshair, Virtual Touch Pad & HUD */
    g_rs.rs[7] = 0u; /* ZDISABLE for 2D HUD */
    g_rs.rs[28] = 0u; /* FOG OFF */
    g_rs.stage[0].colorop = 1u;
    int cx = fbw / 2, cy = fbh / 2;
    Rect ch_h = {cx - 10, cy, cx + 11, cy + 1};
    Rect ch_v = {cx, cy - 10, cx + 1, cy + 11};
    render_fill(&ch_h, 0xFF66FF44u);
    render_fill(&ch_v, 0xFF66FF44u);

    /* Left-side Tactical Virtual D-Pad Overlay (visible on mobile & workbench) */
    int dpx = 58, dpy = fbh - 62;
    Rect dp_up = {dpx - 9, dpy - 30, dpx + 9, dpy - 12};
    Rect dp_dn = {dpx - 9, dpy + 12, dpx + 9, dpy + 30};
    Rect dp_lt = {dpx - 30, dpy - 9, dpx - 12, dpy + 9};
    Rect dp_rt = {dpx + 12, dpy - 9, dpx + 30, dpy + 9};
    render_fill(&dp_up, g_key_state[0x11] ? 0xFF44FF66u : 0xFF284830u);
    render_fill(&dp_dn, g_key_state[0x1F] ? 0xFF44FF66u : 0xFF284830u);
    render_fill(&dp_lt, g_key_state[0x1E] ? 0xFF44FF66u : 0xFF284830u);
    render_fill(&dp_rt, g_key_state[0x20] ? 0xFF44FF66u : 0xFF284830u);
    cpu_sw_draw_text(dpx - 3, dpy - 25, "W", 0xFFE8FFF0u);
    cpu_sw_draw_text(dpx - 3, dpy + 17, "S", 0xFFE8FFF0u);
    cpu_sw_draw_text(dpx - 24, dpy - 4, "A", 0xFFE8FFF0u);
    cpu_sw_draw_text(dpx + 18, dpy - 4, "D", 0xFFE8FFF0u);

    /* Right-side Freelook Touch Zone Indicator */
    int lkx = fbw - 68, lky = fbh - 62;
    Rect lk_h = {lkx - 22, lky, lkx + 23, lky + 1};
    Rect lk_v = {lkx, lky - 22, lkx + 1, lky + 23};
    render_fill(&lk_h, 0xFF3A6A48u);
    render_fill(&lk_v, 0xFF3A6A48u);
    cpu_sw_draw_text(lkx - 16, lky + 26, "LOOK", 0xFF98E8A8u);

    uint32_t st_frames = 0, st_draws = 0, st_tris = 0;
    cpu_sw_stats(&st_frames, &st_draws, &st_tris);
    char top_hud[128];
    snprintf(top_hud, sizeof(top_hud), "PROJECT I.G.I. UNIVERSAL APK | ENT %d | ARM64+X86_64",
             s_num_ents);
    cpu_sw_draw_text(8, 22, top_hud, 0xFFA8FF90u);

    char pos_hud[128];
    snprintf(pos_hud, sizeof(pos_hud), "M01 TRAINYARD | POS %.1f %.1f %.1f | YAW %.0f",
             s_cam_x, s_cam_y, s_cam_z, s_cam_yaw * 57.2958f);
    cpu_sw_draw_text(8, fbh - 14, pos_hud, 0xFFA8FF90u);

    render_present();
}

/* ============================================================================
 * Android JNI Native CPU Software Driver Exports (libigi_cpu_port.so)
 * Package: com.berasxcorps.igiport.IGICpuBridge
 * Works on Android Canvas/Bitmap with android:hardwareAccelerated="false"
 * AND on Linux ctypes (when env == NULL).
 * ============================================================================ */
static uint32_t *s_argb_staging = NULL;
static int s_argb_staging_cap = 0;
static int s_touch_look_active = 0;
static float s_touch_last_x = 0.0f;
static float s_touch_last_y = 0.0f;

static void clear_dpad_keys(void)
{
    platform_key(0x11, 0); /* W */
    platform_key(0x1F, 0); /* S */
    platform_key(0x1E, 0); /* A */
    platform_key(0x20, 0); /* D */
}

#ifdef __ANDROID__
typedef JNIEnv *IGI_JNIEnv;
typedef jclass  IGI_JClass;
typedef jintArray IGI_JIntArray;
#else
typedef void *IGI_JNIEnv;
typedef void *IGI_JClass;
typedef uint32_t *IGI_JIntArray;
#endif

__attribute__((visibility("default")))
void Java_com_berasxcorps_igiport_IGICpuBridge_nativeInit(
    IGI_JNIEnv env, IGI_JClass cls, int width, int height)
{
    (void)env; (void)cls;
    igi_cpu_scene_init(NULL, width > 0 ? width : 640, height > 0 ? height : 360);
}

__attribute__((visibility("default")))
int Java_com_berasxcorps_igiport_IGICpuBridge_nativeStepFrame(
    IGI_JNIEnv env, IGI_JClass cls, float dt, IGI_JIntArray out_argb, int max_pixels)
{
    (void)cls;
    igi_cpu_scene_step(dt > 0.0f && dt < 0.25f ? dt : 0.033f);
    int w = 0, h = 0;
    const uint32_t *fb = cpu_sw_framebuffer(&w, &h);
    if (!fb || !out_argb || max_pixels <= 0) return 0;
    int total = w * h;
    if (total > max_pixels) total = max_pixels;

    if (total > s_argb_staging_cap) {
        uint32_t *nb = (uint32_t *)realloc(s_argb_staging, (size_t)total * sizeof(uint32_t));
        if (!nb) return 0;
        s_argb_staging = nb;
        s_argb_staging_cap = total;
    }

    /* Convert RGBA8 (R low) -> Android Bitmap ARGB_8888 (0xAARRGGBB) */
    for (int i = 0; i < total; i++) {
        uint32_t c = fb[i];
        s_argb_staging[i] = 0xFF000000u | ((c & 0xFFu) << 16) | (c & 0xFF00u) | ((c >> 16) & 0xFFu);
    }

#ifdef __ANDROID__
    if (env != NULL) {
        (*env)->SetIntArrayRegion(env, out_argb, 0, (jsize)total, (const jint *)s_argb_staging);
        return total;
    }
#endif
    (void)env;
    memcpy((void *)out_argb, s_argb_staging, (size_t)total * sizeof(uint32_t));
    return total;
}

__attribute__((visibility("default")))
void Java_com_berasxcorps_igiport_IGICpuBridge_nativeOnInput(
    IGI_JNIEnv env, IGI_JClass cls, int dik_code, int down, int look_dx, int look_dy)
{
    (void)env; (void)cls;
    if (dik_code > 0 && dik_code < 256)
        platform_key((uint8_t)dik_code, down);
    if (look_dx != 0 || look_dy != 0) {
        g_mouse.dx += look_dx;
        g_mouse.dy += look_dy;
    }
}

__attribute__((visibility("default")))
void Java_com_berasxcorps_igiport_IGICpuBridge_nativeOnTouch(
    IGI_JNIEnv env, IGI_JClass cls, int action, float norm_x, float norm_y)
{
    (void)env; (void)cls;
    /* Android MotionEvent: ACTION_DOWN=0, ACTION_UP=1, ACTION_MOVE=2, ACTION_CANCEL=3 */
    int masked = action & 0xFF;
    if (masked == 1 || masked == 3) {
        clear_dpad_keys();
        s_touch_look_active = 0;
        return;
    }
    if (!(norm_x >= 0.0f && norm_x <= 1.0f && norm_y >= 0.0f && norm_y <= 1.0f))
        return;

    if (norm_x < 0.42f) {
        /* Left virtual D-Pad centered near (0.14, 0.78) */
        s_touch_look_active = 0;
        float dx = norm_x - 0.14f;
        float dy = norm_y - 0.78f;
        clear_dpad_keys();
        if (dy < -0.04f) platform_key(0x11, 1); /* W */
        if (dy >  0.04f) platform_key(0x1F, 1); /* S */
        if (dx < -0.03f) platform_key(0x1E, 1); /* A */
        if (dx >  0.03f) platform_key(0x20, 1); /* D */
    } else {
        /* Right half of screen: touch drag freelook */
        clear_dpad_keys();
        if (masked == 0 || !s_touch_look_active) {
            s_touch_look_active = 1;
            s_touch_last_x = norm_x;
            s_touch_last_y = norm_y;
        } else if (masked == 2) {
            float dnx = norm_x - s_touch_last_x;
            float dny = norm_y - s_touch_last_y;
            s_touch_last_x = norm_x;
            s_touch_last_y = norm_y;
            g_mouse.dx += (int)(dnx * 380.0f);
            g_mouse.dy += (int)(dny * 260.0f);
        }
    }
}
