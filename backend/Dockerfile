# Build from the repository root:  docker build -f backend/Dockerfile -t child-health-api .
# Stage 1 builds the dashboard (same-address API, so VITE_API_URL is empty); stage 2 installs only production
# dependencies from the lock file; the final image carries no build tools, tests or .env.

FROM node:20-alpine AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ENV VITE_API_URL=
RUN npm run build

FROM node:20-alpine AS deps
WORKDIR /build/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:20-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    SERVE_FRONTEND=1 \
    FRONTEND_DIST=/app/frontend/dist
WORKDIR /app/backend
COPY --from=deps --chown=node:node /build/backend/node_modules ./node_modules
COPY --chown=node:node backend/package.json ./
COPY --chown=node:node backend/src ./src
COPY --from=frontend --chown=node:node /build/frontend/dist /app/frontend/dist
USER node
EXPOSE 3000
# /health answers 503 when the database is down, which fails the check.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
