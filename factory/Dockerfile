# NORO AI Content Factory: API + worker + web in one image.
FROM node:22-bookworm-slim AS base
# ffmpeg for media, python for local Piper TTS, shared libs for the headless Chromium used by Remotion.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg python3 python3-venv curl ca-certificates \
      libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 libasound2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libpango-1.0-0 libcairo2 fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY . .
# Free local TTS (Piper) and the Remotion headless browser, baked into the image.
RUN bash scripts/setup-piper.sh && npx remotion browser ensure
RUN useradd -m noro && mkdir -p /app/.data/files && chown -R noro /app/.data
USER noro
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD curl -fsS http://127.0.0.1:8787/api/health || exit 1
CMD ["npx", "tsx", "server/main.ts"]
