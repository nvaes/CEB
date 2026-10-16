# Révision CEB — image autonome (Python + poppler)
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CEB_PDF_DIR=/pdf \
    CEB_DATA_DIR=/data \
    PORT=8080 \
    TZ=Europe/Brussels

RUN apt-get update \
 && apt-get install -y --no-install-recommends poppler-utils tzdata \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY builder/ builder/
COPY app/ app/

RUN useradd -r -u 1000 -m ceb && mkdir -p /data /pdf && chown ceb /data
USER ceb

VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python3 -c "import urllib.request,os; urllib.request.urlopen('http://127.0.0.1:%s/api/status' % os.environ.get('PORT','8080'), timeout=4)" || exit 1

CMD ["python3", "app/server.py"]
