# syntax=docker/dockerfile:1
# Musik — trình phát nhạc tự host, chạy trong hub Lazybutts tại musik.lazybutts.com.
# Server Express 5 + SQLite có sẵn của Node (node:sqlite) phục vụ luôn bản build
# React; dữ liệu (musik.db + uploads/) nằm ở volume /data trên Mac mini.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Typecheck + build client (dist/), rồi bundle server TypeScript thành một file JS
# (thư viện giữ ở node_modules) để image chạy bằng node thuần, không cần tsx.
RUN npm run build \
 && node_modules/.bin/esbuild server/index.ts --bundle --platform=node --format=esm \
      --target=node22 --packages=external --outfile=build/server.js

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 MUSIK_DATA_DIR=/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/build ./build
COPY --from=build /app/dist ./dist
# Run as the unprivileged "node" user. A brand-new volume mounted at /data inherits this ownership; a volume created
# by an older (root) image needs a one-time `chown -R 1000:1000` — see README, "Docker".
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
# Healthy when the server answers and its database can be queried.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "build/server.js"]
