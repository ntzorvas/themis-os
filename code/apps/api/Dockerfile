FROM node:22-slim
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Copy workspace config + all package.json files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
COPY packages/types/package.json packages/types/
COPY packages/crypto/package.json packages/crypto/
COPY packages/greek-utils/package.json packages/greek-utils/
COPY packages/rules-engine/package.json packages/rules-engine/
COPY packages/ui/package.json packages/ui/

# Install all deps (including dev — tsx needed at runtime for TS package imports)
RUN pnpm install --frozen-lockfile

# Copy all source
COPY . .

# Build API
RUN pnpm --filter=@themisos/api build

ENV NODE_ENV=production
EXPOSE 4100

# tsx registers TS loader so @themisos/* packages (which export .ts source) resolve correctly
CMD ["node", "--import=tsx", "apps/api/dist/apps/api/src/server.js"]
