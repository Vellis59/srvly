# Build
FROM node:20-alpine AS build
RUN apk add --no-cache g++ make python3
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN mkdir -p public && npm run build

# Run
FROM node:20-alpine
RUN apk add --no-cache docker-cli curl git
WORKDIR /app
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/next.config.js ./

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
