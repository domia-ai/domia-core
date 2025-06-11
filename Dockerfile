FROM node:lts-slim as base

# Define env vars.
ENV WORK_DIR /app

# Create app directory.
WORKDIR $WORK_DIR

# Copy folders.
COPY package.json ./
COPY yarn.lock ./
COPY tsconfig.json ./

# Install dependencies.
RUN yarn install

# Bundle app source.
COPY . .

# Install sox, python3, pip, and system libraries
RUN apt-get update && apt-get install -y \
    sox \
    python3 \
    python3-pip \
    python3-venv \
    build-essential \
    libasound2-dev \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
RUN python3 -m pip install --upgrade pip && \
python3 -m pip install -r src/resources/python/requirements.txt

FROM base as domia-core

# Generate the sqlite db.
RUN yarn run db:migrate

# Build the app.
RUN yarn run build

USER node
CMD ["node", "build/index.js"]
