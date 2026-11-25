FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npm rebuild esbuild
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4173
ENV DATA_DIR=/app/data
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/lib/categories.js ./src/lib/categories.js
COPY --from=build /app/src/lib/bankParser.js ./src/lib/bankParser.js
COPY package.json ./
COPY server ./server
RUN mkdir -p /app/data/slips && chown -R node:node /app
USER node
EXPOSE 4173
VOLUME ["/app/data"]
CMD ["node", "server/index.js"]
