# syntax=docker/dockerfile:1

# A single workspace-aware image is built for every service. SERVICE_WORKSPACE
# selects the npm workspace to start at runtime.
FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init

FROM base AS build
COPY . .
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
ARG SERVICE_WORKSPACE
ENV SERVICE_WORKSPACE=${SERVICE_WORKSPACE}

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/services ./services
COPY --from=build --chown=node:node /app/apps ./apps

USER node
EXPOSE 3000
ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "npm run start --workspace=${SERVICE_WORKSPACE}"]
