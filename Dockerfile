FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /srv/imposter

COPY requirements.txt .
RUN python -m pip install --no-cache-dir -r requirements.txt \
    && groupadd --system imposter \
    && useradd --system --gid imposter --no-create-home imposter

COPY app ./app
COPY data ./data
COPY wsgi.py ./wsgi.py

USER imposter
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
    CMD ["python", "-c", "import http.client, os; c = http.client.HTTPConnection('127.0.0.1', 5000, timeout=3); c.request('GET', '/healthz', headers={'Host': (os.getenv('TRUSTED_HOSTS') or 'localhost').split()[0].lstrip('.')}); assert c.getresponse().status == 200"]
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--worker-class", "gthread", "--workers", "1", "--threads", "128", "wsgi:app"]
