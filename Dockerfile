FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/
COPY packages/cli/package.json packages/cli/
RUN npm ci --workspace=packages/server
COPY packages/server packages/server
RUN npm run build --workspace=packages/server
ENTRYPOINT ["node", "packages/server/dist/index.js"]
