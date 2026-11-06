FROM node:22-alpine AS frontend-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/index.html frontend/tsconfig.json frontend/vite.config.ts ./
COPY frontend/src ./src
COPY frontend/public ./public
RUN npm run build

FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    APP_ENV=production DATA_MODE=real PORT=10000 \
    FRONTEND_DIST=/app/static QUESTIONNAIRE_FILE=/app/configuration/savra-integrada-v2.json
WORKDIR /app
COPY backend/requirements.production.lock.txt ./
RUN pip install --no-cache-dir -r requirements.production.lock.txt \
    && useradd --uid 10001 --create-home savra
COPY --chown=savra:savra backend/app ./app
COPY --chown=savra:savra backend/migrations ./migrations
COPY --chown=savra:savra backend/alembic.ini ./
COPY --chown=savra:savra backend/configuration/forms-v1.json ./configuration/forms-v1.json
COPY --chown=savra:savra backend/configuration/savra-integrada-v2.json ./configuration/savra-integrada-v2.json
COPY --chown=savra:savra scripts/database_manifest.py ./tools/database_manifest.py
COPY --from=frontend-build --chown=savra:savra /build/frontend/dist ./static
USER savra
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','10000')+'/api/health',timeout=4)"
CMD ["python", "-m", "app.startup"]
