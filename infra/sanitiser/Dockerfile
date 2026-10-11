# Isolated image sanitiser (ADR-041 §2.1/§2.2). One image per container process: stdin -> stdout + exit code.
# Built by `node scripts/sanitiser-image.mjs` from a minimal context (this directory's manifests + the compiled
# packages/image-sanitiser/dist); never from the repository root. The runner adds --network none, --read-only,
# --cap-drop ALL, no-new-privileges, memory/CPU/pids limits and a wall clock. No secrets, keys or env are passed in.
FROM node:24.20.0-trixie-slim@sha256:50c3b2f6988dfc307b86e5301d69611af31f4789bdf232863b07d3b02fe55ae0 AS deps
WORKDIR /opt/sanitiser
COPY package.json package-lock.json ./
# Integrity-checked install of sharp 0.35.5 + its prebuilt linux-x64 libvips; install scripts are not run.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force

FROM node:24.20.0-trixie-slim@sha256:50c3b2f6988dfc307b86e5301d69611af31f4789bdf232863b07d3b02fe55ae0
WORKDIR /opt/sanitiser
COPY --from=deps /opt/sanitiser/node_modules ./node_modules
COPY package.json ./package.json
COPY dist/ ./dist/
ENV NODE_ENV=production
USER 65532:65532
ENTRYPOINT ["node", "--max-old-space-size=192", "/opt/sanitiser/dist/cli.js"]
