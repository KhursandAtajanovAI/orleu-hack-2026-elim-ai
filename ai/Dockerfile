# ИИ-сервис «Қайда?»: FastAPI + ONNX Runtime (CPU). Сборка из корня репозитория:
#   docker build -f ai/Dockerfile -t ghcr.io/<owner>/kaida-ai .
# Модель: либо запекается при сборке (--build-arg MODEL_URL=...), либо скачивается
# при старте из переменной MODEL_URL, либо монтируется в /app/models/model.onnx.
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY ai/requirements.txt .
RUN pip install -r requirements.txt

COPY ai/app ./app
COPY contracts/waste-rules.json ./waste-rules.json

ARG MODEL_URL=""
ARG MODEL_VERSION=""
RUN mkdir -p models && if [ -n "$MODEL_URL" ]; then python -c "import urllib.request,sys; urllib.request.urlretrieve(sys.argv[1], 'models/model.onnx')" "$MODEL_URL"; fi

ENV MODEL_PATH=/app/models/model.onnx \
    MODEL_VERSION=${MODEL_VERSION} \
    WASTE_RULES_PATH=/app/waste-rules.json \
    CONF_THRESHOLD=0.35 \
    PORT=8000

RUN useradd -r -u 10001 app && chown -R app /app
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD python -c "import urllib.request,os; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8000\")}/ai/health', timeout=4)"
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers ${WORKERS:-1}"]

LABEL org.opencontainers.image.title="kaida-ai" \
      org.opencontainers.image.description="Қайда? — распознавание отходов (YOLO/ONNX)" \
      org.opencontainers.image.licenses="AGPL-3.0"
