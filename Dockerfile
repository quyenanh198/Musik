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
EXPOSE 3000
CMD ["node", "build/server.js"]
