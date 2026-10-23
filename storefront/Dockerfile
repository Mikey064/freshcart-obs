# STAGE 1: Build
FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN npm run build

# STAGE 2: Runtime
FROM nginx:1.29-alpine-otel AS final

RUN apk update && apk upgrade --no-cache


RUN sed -i '1i load_module modules/ngx_otel_module.so;' /etc/nginx/nginx.conf

COPY --from=build /app/dist /usr/share/nginx/html

# Copy the nginx file to this default folder
COPY ./nginx.conf /etc/nginx/conf.d/default.conf

RUN chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /etc/nginx/conf.d && \
    chown -R nginx:nginx /var/run 2>/dev/null || true && \
    touch /var/run/nginx.pid && \
    chown nginx:nginx /var/run/nginx.pid

USER nginx

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]