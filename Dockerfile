FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Client generation needs a URL in Prisma's config, but never connects to it.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm install
COPY . .
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm run generate
RUN npm run build && npm prune --omit=dev


FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/data ./data
COPY --from=build /app/package.json ./package.json


RUN useradd --create-home --uid 10001 setcraft && chown -R setcraft:setcraft /app
USER setcraft
ENV NODE_ENV=production
EXPOSE 8000
CMD ["node", "--use-system-ca", "dist/server.js"]
