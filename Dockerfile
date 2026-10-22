# LearningCompanion API (Cloud Run). Build context = repo root, because the server
# imports the @learning-companion/shared workspace and seeds content/starter-sources.json.
# Node 24 matches the repo's engines field and .nvmrc.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --no-audit --no-fund
COPY shared ./shared
COPY server ./server
# Build shared -> server, then drop dev dependencies (TypeScript, Vite, test tools).
RUN npm run build -w @learning-companion/shared \
  && npm run build -w @learning-companion/server \
  && npm prune --omit=dev --no-audit --no-fund

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/shared ./shared
COPY --from=build /app/server ./server
COPY content ./content
RUN useradd -m -u 1001 appuser && chown -R appuser:appuser /app
USER appuser
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||8080)+'/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"
CMD ["node", "server/dist/index.js"]
