FROM node:20-alpine

WORKDIR /app

# Copy package manifests and install deps (cached layer)
COPY backend/package.json backend/package-lock.json* ./backend/
WORKDIR /app/backend
RUN npm install --omit=dev 2>/dev/null || npm install

# Copy source
WORKDIR /app
COPY backend/ ./backend/
COPY database/ ./database/

WORKDIR /app/backend

EXPOSE 3131

CMD ["node", "src/server.js"]
