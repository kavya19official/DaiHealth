FROM node:22-alpine AS build
WORKDIR /app
COPY hospital_portal/web/package*.json ./
RUN npm ci
COPY hospital_portal/web/ .
COPY frontend/ /frontend/
ENV DAI_FRONTEND_ASSET_DIR=/frontend
ARG API_ORIGIN=http://api:8000
ENV API_ORIGIN=$API_ORIGIN
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
