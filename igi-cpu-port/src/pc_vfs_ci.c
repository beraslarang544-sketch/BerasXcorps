/*
 * Windows-to-Android Case-Insensitive VFS Layer, Retail CD-Check Synthesizer,
 * and Native Streaming 400 MB+ PC Archive (.obb / .zip) Extractor (zlib).
 *
 * Ensures 100% Windows NTFS path compatibility on Android ext4/f2fs when running
 * retail PC IGI.exe (US & EU releases), including automatic synthesis of the
 * 1-byte CD check marker files ANYS.AFP, MPZM.AFP, and YMBE.AFP.
 */
#include "runtime.h"

#include <ctype.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>
#include <unistd.h>
/* Standard C ABI declarations for system libz (Android libz.so & POSIX libz.so.1) */
typedef unsigned int uInt;
typedef unsigned long uLong;
typedef struct z_stream_s {
    const uint8_t *next_in;
    uInt avail_in;
    uLong total_in;
    uint8_t *next_out;
    uInt avail_out;
    uLong total_out;
    const char *msg;
    void *state;
    void *zalloc;
    void *zfree;
    void *opaque;
    int data_type;
    uLong adler;
    uLong reserved;
} z_stream;
#define Z_OK 0
#define Z_STREAM_END 1
#define Z_DATA_ERROR (-3)
#define Z_NO_FLUSH 0
#define MAX_WBITS 15
extern int inflateInit2_(z_stream *strm, int windowBits, const char *version, int stream_size);
extern int inflate(z_stream *strm, int flush);
extern int inflateEnd(z_stream *strm);
#define inflateInit2(strm, wb) inflateInit2_((strm), (wb), "1.2.11", (int)sizeof(z_stream))

extern char g_game_dir[1024];
extern void __real_win_path_to_host(const char *win, char *out, size_t out_size);

static volatile int s_unpack_active = 0;
static volatile int s_unpack_pct = 0;
static volatile int s_unpack_done = 0;
static char s_unpack_status[160] = "Ready";

int igi_pc_unpack_progress(char *status_out, size_t status_cap)
{
    if (status_out && status_cap > 0) {
        snprintf(status_out, status_cap, "%s", s_unpack_status);
    }
    return s_unpack_active ? s_unpack_pct : (s_unpack_done ? 100 : -1);
}

/* Recursively create parent directories */
static void mkdir_p(const char *dir_path)
{
    char tmp[1024];
    snprintf(tmp, sizeof(tmp), "%s", dir_path);
    for (char *p = tmp + 1; *p; p++) {
        if (*p == '/') {
            *p = '\0';
            mkdir(tmp, 0755);
            *p = '/';
        }
    }
    mkdir(tmp, 0755);
}

/* Ensure retail PC IGI CD-ROM check marker files exist so EU & US IGI.exe never fail */
void igi_pc_ensure_cd_markers(const char *pc_dir)
{
    if (!pc_dir || !pc_dir[0])
        return;
    mkdir_p(pc_dir);
    static const char *const markers[3] = { "ANYS.AFP", "MPZM.AFP", "YMBE.AFP" };
    for (int i = 0; i < 3; i++) {
        char p[1100];
        snprintf(p, sizeof(p), "%s/%s", pc_dir, markers[i]);
        struct stat st;
        if (stat(p, &st) != 0) {
            int fd = open(p, O_WRONLY | O_CREAT | O_TRUNC, 0644);
            if (fd >= 0) {
                uint8_t one = 0x01;
                if (write(fd, &one, 1) < 0) {}
                close(fd);
            }
        }
    }
}

/* Resolve each component of `path` case-insensitively on POSIX filesystems */
void igi_resolve_case_insensitive(char *path, size_t cap)
{
    struct stat st;
    if (!path || !path[0] || stat(path, &st) == 0)
        return;

    char built[1100];
    char work[1100];
    snprintf(work, sizeof(work), "%s", path);

    size_t bpos = 0;
    char *cur = work;
    if (*cur == '/') {
        built[bpos++] = '/';
        built[bpos] = '\0';
        while (*cur == '/') cur++;
    } else {
        built[0] = '.';
        built[1] = '\0';
        bpos = 1;
    }

    while (*cur) {
        char *slash = strchr(cur, '/');
        if (slash) *slash = '\0';

        char candidate[1200];
        if (bpos == 1 && built[0] == '/')
            snprintf(candidate, sizeof(candidate), "/%s", cur);
        else
            snprintf(candidate, sizeof(candidate), "%s/%s", built, cur);

        if (stat(candidate, &st) == 0) {
            snprintf(built, sizeof(built), "%s", candidate);
            bpos = strlen(built);
        } else {
            DIR *d = opendir(built);
            int matched = 0;
            if (d) {
                struct dirent *de;
                while ((de = readdir(d)) != NULL) {
                    if (strcasecmp(de->d_name, cur) == 0) {
                        if (bpos == 1 && built[0] == '/')
                            snprintf(built, sizeof(built), "/%s", de->d_name);
                        else
                            snprintf(built, sizeof(built), "%s/%s", built, de->d_name);
                        bpos = strlen(built);
                        matched = 1;
                        break;
                    }
                }
                closedir(d);
            }
            if (!matched) {
                /* Keep original remaining tail (e.g. file being created for write) */
                snprintf(built, sizeof(built), "%s", candidate);
                if (slash) {
                    size_t bl = strlen(built);
                    snprintf(built + bl, sizeof(built) - bl, "/%s", slash + 1);
                }
                snprintf(path, cap, "%s", built);
                return;
            }
        }

        if (!slash) break;
        cur = slash + 1;
        while (*cur == '/') cur++;
    }
    snprintf(path, cap, "%s", built);
}

/* Linker wrapper for kernel32.c win_path_to_host (-Wl,--wrap=win_path_to_host) */
void __wrap_win_path_to_host(const char *win, char *out, size_t out_size)
{
    __real_win_path_to_host(win, out, out_size);
    if (!out || !out[0])
        return;

    /* Synthesize CD-ROM check marker on demand if requested */
    const char *base = strrchr(out, '/');
    base = base ? (base + 1) : out;
    if (strcasecmp(base, "ANYS.AFP") == 0 ||
        strcasecmp(base, "MPZM.AFP") == 0 ||
        strcasecmp(base, "YMBE.AFP") == 0) {
        igi_pc_ensure_cd_markers(g_game_dir);
    }

    igi_resolve_case_insensitive(out, out_size);
}

/* ============================================================================
 * Minimal Streaming ZIP / OBB Unpacker (Store + Deflate via system libz)
 * Supports 400 MB+ PC game archives via file path OR detached Android SAF fd!
 * ============================================================================ */
static uint16_t z_u16(const uint8_t *p) { return (uint16_t)(p[0] | ((uint16_t)p[1] << 8)); }
static uint32_t z_u32(const uint8_t *p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

int igi_pc_extract_zip_fd(int fd, const char *dst_root)
{
    if (fd < 0 || !dst_root)
        return -1;

    off_t file_sz = lseek(fd, 0, SEEK_END);
    if (file_sz < 22)
        return -1;

    s_unpack_active = 1;
    s_unpack_done = 0;
    s_unpack_pct = 1;
    snprintf(s_unpack_status, sizeof(s_unpack_status), "Scanning PC archive (%lld MB)...",
             (long long)(file_sz / (1024 * 1024)));

    /* Locate End of Central Directory (EOCD) in final 65 KB */
    size_t tail_len = file_sz < 65558 ? (size_t)file_sz : 65558u;
    uint8_t *tail = (uint8_t *)malloc(tail_len);
    if (!tail) { s_unpack_active = 0; return -1; }
    if (pread(fd, tail, tail_len, file_sz - (off_t)tail_len) != (ssize_t)tail_len) {
        free(tail);
        s_unpack_active = 0;
        return -1;
    }

    int eocd_pos = -1;
    for (int i = (int)tail_len - 22; i >= 0; i--) {
        if (tail[i] == 0x50 && tail[i + 1] == 0x4B && tail[i + 2] == 0x05 && tail[i + 3] == 0x06) {
            eocd_pos = i;
            break;
        }
    }
    if (eocd_pos < 0) {
        free(tail);
        snprintf(s_unpack_status, sizeof(s_unpack_status), "Invalid ZIP/OBB archive");
        s_unpack_active = 0;
        return -1;
    }

    uint16_t total_entries = z_u16(tail + eocd_pos + 10);
    uint32_t cd_size       = z_u32(tail + eocd_pos + 12);
    uint32_t cd_offset     = z_u32(tail + eocd_pos + 16);
    free(tail);

    uint8_t *cd = (uint8_t *)malloc(cd_size ? cd_size : 1u);
    if (!cd) { s_unpack_active = 0; return -1; }
    if (pread(fd, cd, cd_size, (off_t)cd_offset) != (ssize_t)cd_size) {
        free(cd);
        s_unpack_active = 0;
        return -1;
    }

    mkdir_p(dst_root);

    /* Detect optional single top-level folder prefix (e.g. "ProjectIGI/IGI.exe" -> strip "ProjectIGI/") */
    char strip_prefix[128] = {0};
    uint32_t scan_off = 0;
    for (uint16_t e = 0; e < total_entries && scan_off + 46 <= cd_size; e++) {
        if (z_u32(cd + scan_off) != 0x02014B50u) break;
        uint16_t nlen = z_u16(cd + scan_off + 28);
        uint16_t elen = z_u16(cd + scan_off + 30);
        uint16_t clen = z_u16(cd + scan_off + 32);
        if (scan_off + 46 + nlen <= cd_size && nlen < 240) {
            char name[256];
            memcpy(name, cd + scan_off + 46, nlen);
            name[nlen] = '\0';
            for (char *p = name; *p; p++) if (*p == '\\') *p = '/';
            const char *sl = strrchr(name, '/');
            if (sl && strcasecmp(sl + 1, "IGI.exe") == 0) {
                size_t plen = (size_t)(sl - name) + 1u;
                if (plen < sizeof(strip_prefix)) {
                    memcpy(strip_prefix, name, plen);
                    strip_prefix[plen] = '\0';
                }
                break;
            }
        }
        scan_off += 46u + nlen + elen + clen;
    }

    uint8_t *in_chunk = (uint8_t *)malloc(65536);
    uint8_t *out_chunk = (uint8_t *)malloc(65536);
    uint32_t pos = 0;
    int extracted = 0;

    for (uint16_t e = 0; e < total_entries && pos + 46 <= cd_size; e++) {
        if (z_u32(cd + pos) != 0x02014B50u) break;
        uint16_t method    = z_u16(cd + pos + 10);
        uint32_t comp_sz   = z_u32(cd + pos + 20);
        uint16_t nlen      = z_u16(cd + pos + 28);
        uint16_t elen      = z_u16(cd + pos + 30);
        uint16_t clen      = z_u16(cd + pos + 32);
        uint32_t lhoff     = z_u32(cd + pos + 42);

        if (pos + 46 + nlen <= cd_size && nlen > 0 && nlen < 500) {
            char rel[512];
            memcpy(rel, cd + pos + 46, nlen);
            rel[nlen] = '\0';
            for (char *p = rel; *p; p++) if (*p == '\\') *p = '/';

            const char *clean_rel = rel;
            if (strip_prefix[0] && strncasecmp(rel, strip_prefix, strlen(strip_prefix)) == 0)
                clean_rel = rel + strlen(strip_prefix);
            while (*clean_rel == '/') clean_rel++;

            if (clean_rel[0] && strstr(clean_rel, "..") == NULL) {
                char out_path[1200];
                snprintf(out_path, sizeof(out_path), "%s/%s", dst_root, clean_rel);
                size_t olen = strlen(out_path);
                if (out_path[olen - 1] == '/') {
                    mkdir_p(out_path);
                } else {
                    char parent[1200];
                    snprintf(parent, sizeof(parent), "%s", out_path);
                    char *last_sl = strrchr(parent, '/');
                    if (last_sl) { *last_sl = '\0'; mkdir_p(parent); }

                    uint8_t lhdr[30];
                    if (pread(fd, lhdr, 30, (off_t)lhoff) == 30 && z_u32(lhdr) == 0x04034B50u) {
                        uint16_t ln = z_u16(lhdr + 26);
                        uint16_t le = z_u16(lhdr + 28);
                        off_t data_off = (off_t)lhoff + 30 + ln + le;

                        int out_fd = open(out_path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
                        if (out_fd >= 0) {
                            if (method == 0) {
                                uint32_t rem = comp_sz;
                                while (rem > 0) {
                                    uint32_t step = rem > 65536u ? 65536u : rem;
                                    ssize_t got = pread(fd, in_chunk, step, data_off);
                                    if (got <= 0) break;
                                    if (write(out_fd, in_chunk, (size_t)got) < 0) break;
                                    data_off += got;
                                    rem -= (uint32_t)got;
                                }
                                extracted++;
                            } else if (method == 8) {
                                z_stream zs;
                                memset(&zs, 0, sizeof(zs));
                                if (inflateInit2(&zs, -MAX_WBITS) == Z_OK) {
                                    uint32_t rem = comp_sz;
                                    while (rem > 0) {
                                        uint32_t step = rem > 65536u ? 65536u : rem;
                                        ssize_t got = pread(fd, in_chunk, step, data_off);
                                        if (got <= 0) break;
                                        data_off += got;
                                        rem -= (uint32_t)got;
                                        zs.next_in = in_chunk;
                                        zs.avail_in = (uInt)got;
                                        do {
                                            zs.next_out = out_chunk;
                                            zs.avail_out = 65536u;
                                            int zr = inflate(&zs, Z_NO_FLUSH);
                                            size_t have = 65536u - zs.avail_out;
                                            if (have > 0 && write(out_fd, out_chunk, have) < 0) { zr = Z_DATA_ERROR; }
                                            if (zr == Z_STREAM_END || zr < 0) { rem = 0; break; }
                                        } while (zs.avail_out == 0);
                                    }
                                    inflateEnd(&zs);
                                    extracted++;
                                }
                            }
                            close(out_fd);
                        }
                    }
                }
            }
            s_unpack_pct = (int)(((uint32_t)(e + 1) * 100u) / (total_entries ? total_entries : 1u));
            snprintf(s_unpack_status, sizeof(s_unpack_status), "Unpacking PC Data (%d%%): %s",
                     s_unpack_pct, clean_rel);
        }
        pos += 46u + nlen + elen + clen;
    }

    free(in_chunk);
    free(out_chunk);
    free(cd);

    igi_pc_ensure_cd_markers(dst_root);
    s_unpack_pct = 100;
    s_unpack_done = 1;
    s_unpack_active = 0;
    snprintf(s_unpack_status, sizeof(s_unpack_status), "Extracted %d PC files ready!", extracted);
    return extracted;
}

int igi_pc_extract_zip_path(const char *zip_path, const char *dst_root)
{
    int fd = open(zip_path, O_RDONLY);
    if (fd < 0)
        return -1;
    int rc = igi_pc_extract_zip_fd(fd, dst_root);
    close(fd);
    return rc;
}
