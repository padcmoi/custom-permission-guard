FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
ENV CI=true

WORKDIR /workspace

COPY package.json README.md ./
COPY dist ./dist
COPY poc/shared ./poc/shared
COPY poc/nest-single ./poc/nest-single

WORKDIR /workspace/poc/nest-single
RUN pnpm install --no-frozen-lockfile --shamefully-hoist

CMD ["pnpm", "start"]
