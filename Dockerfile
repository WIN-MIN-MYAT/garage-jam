# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY client/package.json client/package-lock.json ./client/
COPY server/package.json server/package-lock.json ./server/
RUN npm ci --prefix client && npm ci --prefix server

FROM deps AS build
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8082
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY server ./server
COPY sender ./sender
COPY client/src/stream-shared ./client/src/stream-shared
COPY --from=build /app/client/dist ./client/dist
COPY package.json ./
RUN mkdir -p /app/server/data
EXPOSE 8082
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8082)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
