FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY adapters ./adapters
COPY packages ./packages
COPY services ./services

RUN npm ci --omit=dev

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080

EXPOSE 8080

CMD ["npm", "run", "start:identity"]
