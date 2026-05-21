# syntax=docker/dockerfile:1.7

# ─── Stage 1 : build du frontend React + install des deps prod ───────────────
# Debian (glibc) — ffmpeg-static / ffprobe-static ne fonctionnent pas sur Alpine (musl).
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Variables d'env Vite injectées au build (inline dans le bundle JS).
# Passer via --build-arg ou docker-compose.yml -> args:.
ARG VITE_API_BASE_URL=""
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_TMDB_API_KEY
ARG VITE_PREMIUM_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_TMDB_API_KEY=$VITE_TMDB_API_KEY \
    VITE_PREMIUM_URL=$VITE_PREMIUM_URL

# Couche deps mise en cache tant que package*.json ne change pas.
COPY package*.json ./
RUN npm ci

# Build frontend (tsc -b && vite build) → dist/
COPY . .
RUN npm run build


# ─── Stage 2 : runtime minimal ───────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PORT=4000 \
    ALLOWED_ORIGINS=*

# Stratégie ffmpeg DUAL (cf. CLAUDE.md §IV-25) :
# - /usr/bin/ffmpeg (apt Bookworm 5.1.x) : utilisé pour /api/stream et /api/probe.
#   Stable pour `-c:v copy + -ss + -output_ts_offset` (fMP4 fragmenté servi
#   à Chrome). Le build BtbN master a régressé ce chemin (lecteur figé après
#   seek/changement audio).
# - /usr/local/bin/ffmpeg (BtbN ffmpeg 7.x statique) : utilisé UNIQUEMENT pour
#   /api/subtitle. ffmpeg 5.1.x sort un WebVTT vide depuis MKV pour certaines
#   combinaisons de codecs (sous-titres invisibles côté UI). ffmpeg 7.x corrige.
# `ffmpeg-static` (johnvansickle) SEGFAULT sur HTTP en glibc Bookworm → écarté.
# tini : reaper PID 1 pour ne pas laisser de zombies ffmpeg en cas de kill.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates curl xz-utils ffmpeg \
 && curl -fsSL https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz \
        -o /tmp/ffmpeg.tar.xz \
 && tar -xJf /tmp/ffmpeg.tar.xz -C /tmp \
 && mv /tmp/ffmpeg-master-latest-linux64-gpl/bin/ffmpeg  /usr/local/bin/ffmpeg \
 && mv /tmp/ffmpeg-master-latest-linux64-gpl/bin/ffprobe /usr/local/bin/ffprobe \
 && chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe \
 && rm -rf /tmp/ffmpeg.tar.xz /tmp/ffmpeg-master-latest-linux64-gpl \
 && apt-get purge -y --auto-remove curl xz-utils \
 && rm -rf /var/lib/apt/lists/*

# Installer UNIQUEMENT les deps de production (ffmpeg-static + ffprobe-static
# téléchargent leurs binaires Linux au postinstall depuis cette image).
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copier le build du frontend + le serveur Express.
COPY --from=builder /app/dist ./dist
COPY server ./server

# Lancer en user non-root (sécurité).
RUN chown -R node:node /app
USER node

EXPOSE 4000

# tini = reaper PID 1, évite les zombies ffmpeg en cas de kill brutal.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/proxy.cjs"]
