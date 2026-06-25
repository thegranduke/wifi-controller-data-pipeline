FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json .
RUN npm install
COPY . .
RUN npm run build

FROM node:18-alpine
WORKDIR /app
COPY package*.json .
RUN npm install
COPY --from=build /app/dist ./dist
COPY vite.config.js .
# VITE_API_URL is read at container start (not build time) and written to config.js
CMD ["sh", "-c", "printf 'window.__API_URL__=\"%s\";' \"${VITE_API_URL:-}\" > dist/config.js && npm run preview -- --host 0.0.0.0 --port ${PORT:-4173}"]
