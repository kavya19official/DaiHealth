FROM node:24-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libgomp1 python3 python3-venv tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/package*.json backend/
COPY hospital_portal/web/package*.json hospital_portal/web/
COPY hospital_portal/requirements.txt hospital_portal/
COPY synthetic_data/requirements.txt synthetic_data/
COPY ml-service/requirements.txt ml-service/
RUN npm ci --omit=dev --prefix backend && npm ci --prefix hospital_portal/web
RUN python3 -m venv hospital_portal/.venv && hospital_portal/.venv/bin/pip install --no-cache-dir \
    -r hospital_portal/requirements.txt -r synthetic_data/requirements.txt -r ml-service/requirements.txt

COPY . .
ENV PYTHONUNBUFFERED=1 NEXT_TELEMETRY_DISABLED=1 TZ=Asia/Kolkata
ENV DAI_LOCAL=true DAI_NEXT_DIST_DIR=.next-local NEXT_PUBLIC_DAI_BASE_PATH=/hospital-admin \
    NEXT_PUBLIC_DAI_HOSTED_DEMO=true API_ORIGIN=http://127.0.0.1:8100
RUN npm run build --prefix hospital_portal/web -- --webpack
RUN hospital_portal/.venv/bin/python synthetic_data/generate.py \
    && hospital_portal/.venv/bin/python synthetic_data/build_hospital_admin.py \
    && hospital_portal/.venv/bin/python -m hospital_portal.ml_service.train

ENV DAI_HOSTED_DEMO=true DAI_STATE_DIR=/var/data
EXPOSE 10000
CMD ["python3", "scripts/local.py", "run"]
