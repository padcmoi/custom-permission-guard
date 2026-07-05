FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
ENV CI=true

WORKDIR /workspace

COPY package.json README.md ./
COPY dist ./dist
COPY poc/shared ./poc/shared
COPY poc/express-multiple ./poc/express-multiple

WORKDIR /workspace/poc/express-multiple
RUN pnpm install --no-frozen-lockfile --shamefully-hoist

CMD ["pnpm", "start"]
