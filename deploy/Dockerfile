# Warsha Studio, workshop edition: the server and the editor in one image.
# Build from the repository root:  docker compose -f deploy/docker-compose.yml build
FROM node:22.12-alpine AS build
WORKDIR /src/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY server/ ./
RUN npm run build && npm prune --omit=dev
# three.js is served by the server itself, so the editor needs no outside CDN here
WORKDIR /vendor
RUN npm pack three@0.147.0 --silent && tar xzf three-0.147.0.tgz && mkdir -p /out/three \
 && cp package/build/three.min.js /out/three/ && cp -r package/examples /out/three/examples \
 && find /out/three/examples -type f ! -name '*.js' -delete

FROM node:22.12-alpine
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 EDITOR_DIR=/app/editor PUBLIC_DIR=/app/server/public
WORKDIR /app
COPY --from=build /src/server/dist server/dist
COPY --from=build /src/server/node_modules server/node_modules
COPY --from=build /src/server/package.json server/package.json
COPY --from=build /src/server/drizzle server/drizzle
COPY --from=build /src/server/public server/public
COPY --from=build /out/three editor/vendor/three
COPY index.html og.jpg editor/
COPY js editor/js
COPY assets editor/assets
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1
CMD ["node", "server/dist/main.js"]
