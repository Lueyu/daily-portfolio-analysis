FROM mcr.microsoft.com/playwright:v1.64.1-noble

USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv git ripgrep ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/browser
RUN npm install --ignore-scripts --no-audit --no-fund playwright@1.64.1
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force \
    && chmod -R a+rX /workspace/node_modules
COPY agent-pyproject.toml /opt/runtime/agent-pyproject.toml
RUN python3 -m venv /opt/python \
    && /opt/python/bin/python -c "import subprocess,tomllib; p=tomllib.load(open('/opt/runtime/agent-pyproject.toml','rb')); subprocess.check_call(['/opt/python/bin/pip','install',*p['project']['dependencies'],*p['dependency-groups']['dev']])"
COPY supervisor.py /opt/runtime/supervisor.py
ENV PATH="/opt/python/bin:/workspace/node_modules/.bin:${PATH}" \
    PYTHONDONTWRITEBYTECODE=1 \
    HOME=/tmp/agent-home \
    npm_config_cache=/tmp/npm-cache \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN mkdir -p /workspace/dist /workspace/.cache /workspace/node_modules/.vite \
    /workspace/node_modules/.vite-temp /workspace/node_modules/.cache \
    && node -e "if (+process.versions.node.split('.')[0] < 22) process.exit(1)" \
    && python3 --version && rg --version && git --version
USER 1000:1000
WORKDIR /workspace
CMD ["python3", "/opt/runtime/supervisor.py"]
