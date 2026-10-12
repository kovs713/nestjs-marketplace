# One image for all services; SERVICE is picked at runtime.
# build:  docker build -f infra/docker/Dockerfile -t marketplace:dev .
# run:    docker run -e SERVICE=catalog-service -e DATABASE_URL=... marketplace:dev

# build
FROM oven/bun:1 AS build
WORKDIR /app

# separate deps; patches must be present for --frozen-lockfile
COPY package.json bun.lock ./
COPY patches ./patches
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# runtime: Debian matches oven/bun (glibc); alpine/musl can break native deps
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./

COPY --from=build /app/libs ./libs
COPY --from=build /app/apps ./apps
COPY --from=build /app/infra/docker/migrate.sh ./infra/docker/migrate.sh

EXPOSE 3000 50051

USER node

CMD ["sh", "-c", "node dist/apps/${SERVICE}/main.js"]
