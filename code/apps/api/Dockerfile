FROM node:22-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
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

# Install all deps (including dev for tsc builds)
RUN pnpm install --frozen-lockfile

# SOURCE_COMMIT is injected by Coolify — busts cache on new commits
ARG SOURCE_COMMIT
# Copy all source
COPY . .

# Build workspace packages first (order matters: types → crypto → db → rest)
RUN pnpm --filter=@themisos/types build
RUN pnpm --filter=@themisos/crypto build
RUN pnpm --filter=@themisos/db build
RUN pnpm --filter=@themisos/greek-utils build
RUN pnpm --filter=@themisos/rules-engine build

# Build the API
RUN pnpm --filter=@themisos/api build

ENV NODE_ENV=production
EXPOSE 4100

# Run compiled JS directly — no tsx needed
CMD ["node", "/app/apps/api/dist/server.js"]
