FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.lock.txt .
RUN pip install --no-cache-dir -r requirements.lock.txt && useradd --create-home savra
COPY --chown=savra:savra app ./app
COPY --chown=savra:savra configuration ./configuration
COPY --chown=savra:savra migrations ./migrations
COPY --chown=savra:savra tests ./tests
COPY --chown=savra:savra alembic.ini pytest.ini ./
USER savra
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && python -m app.cli bootstrap && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-access-log --no-proxy-headers"]
