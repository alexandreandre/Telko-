# Étape 1 : build frontend
FROM node:20-alpine AS build

WORKDIR /app
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* .npmrc* ./ 2>/dev/null || true
RUN npm install

COPY . .
# VITE_API_URL vient de l'argument de build passé par GitHub Actions
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

# Étape 2 : Nginx pour servir les fichiers statiques
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html

# Config de base (SPA React)
RUN rm /etc/nginx/conf.d/default.conf
COPY <<'EOF' /etc/nginx/conf.d/default.conf
server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri /index.html;
    }
}
EOF

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]