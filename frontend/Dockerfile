FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM nginxinc/nginx-unprivileged:1.28-alpine
COPY nginx.conf /etc/nginx/nginx.conf
COPY --chmod=755 configure-upstream.sh /docker-entrypoint.d/40-savra-upstream.sh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
