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
    CMD ["python", "-c", "from urllib.request import urlopen; urlopen('http://127.0.0.1:5000/healthz', timeout=3).close()"]
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--threads", "4", "--no-control-socket", "wsgi:app"]
