FROM node:lts-slim AS base

ENV WORK_DIR=/app
WORKDIR $WORK_DIR

COPY package.json ./
COPY package-lock.json ./
COPY tsconfig.json ./

RUN npm ci

COPY . .

RUN apt-get update && apt-get install -y \
    sox \
    libasound2-dev \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

FROM base AS domia-core

RUN npm run build

USER node
CMD ["node", "build/index.js"]
