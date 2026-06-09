FROM node:24-bookworm-slim AS app
WORKDIR /app

# Install ALL deps (tsx + drizzle-kit are needed for migrate-on-boot).
COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

# Apply migrations against DATABASE_URL, then serve. Fails fast if the DB is
# unreachable, so docker-compose's depends_on healthcheck matters.
CMD ["sh", "-c", "npm run db:migrate && npm run start"]
