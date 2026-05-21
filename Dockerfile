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

# Dépendances système requises par les binaires ffmpeg/ffprobe statiques.
# (libstdc++ déjà présent ; libc6 itou. On installe juste tini pour PID 1 propre.)
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
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
