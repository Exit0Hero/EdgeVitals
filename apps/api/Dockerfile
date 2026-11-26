# syntax=docker/dockerfile:1
# EdgeVitals API image. Build from the repository root:
#   docker build -f apps/api/Dockerfile -t edgevitals-api .
# Pin the base image by digest in your registry mirror for reproducible builds.
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /src
# npm validates the whole workspace lockfile, so every workspace manifest is copied.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/
COPY packages/domain/package.json packages/domain/
COPY packages/measurement/package.json packages/measurement/
# Behind a TLS-intercepting proxy, pass its CA without baking it into a layer:
#   docker build --secret id=npm_ca,src=/path/to/ca.pem ...
RUN --mount=type=secret,id=npm_ca,required=false \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci --workspace @edgevitals/api --include-workspace-root --ignore-scripts --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/domain packages/domain
COPY apps/api apps/api
RUN npm run build --workspace @edgevitals/api

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=4000 \
    HOST=0.0.0.0
WORKDIR /app
# Only the native password-hashing addon is needed at runtime; everything else is bundled.
COPY --from=build /src/node_modules/@node-rs ./node_modules/@node-rs
COPY --from=build /src/apps/api/package.json ./package.json
COPY --from=build /src/apps/api/dist ./dist
COPY --from=build /src/apps/api/migrations ./migrations
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# Run `node dist/migrate.js` as a one-off release job before rolling out new versions.
CMD ["node", "--enable-source-maps", "dist/server.js"]
