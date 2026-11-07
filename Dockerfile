# Somnium server image: the API and the web app in one container.
# Build:  docker build -t somnium .
FROM node:22-alpine AS build
WORKDIR /src
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/engine/package.json packages/engine/
COPY packages/shared/package.json packages/shared/
RUN corepack pnpm install --frozen-lockfile --filter @somnium/server... --filter @somnium/web...
COPY . .
# the version the web app shows (Settings); the release workflow passes it
ARG SOMNIUM_VERSION=
ENV SOMNIUM_VERSION=$SOMNIUM_VERSION
RUN corepack pnpm --filter @somnium/web exec vite build
RUN corepack pnpm deploy --filter @somnium/server --prod /out \
 && cp -r apps/web/dist /out/web \
 && node -p "require('./package.json').version" > /out/VERSION

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data WEB_DIR=/app/web
COPY --from=build /out /app
RUN addgroup -S somnium && adduser -S somnium -G somnium && mkdir -p /data && chown somnium:somnium /data
USER somnium
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/api/version >/dev/null || exit 1
CMD ["node", "--import", "tsx", "src/index.ts"]
