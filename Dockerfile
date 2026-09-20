FROM python:3.10-slim

# Create a non-root user and give him a home directory with proper permissions
RUN groupadd -r appuser && useradd -r -g appuser -m -d /home/appuser appuser

WORKDIR /app

# Copy requirements and install Python dependencies (forcing CPU-only torch to skip ~4.5GB CUDA packages)
COPY requirements.txt .
RUN pip install --no-cache-dir torch --extra-index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir -r requirements.txt

# Define the path where Playwright will store browsers to make them accessible
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Install Playwright and Chromium globally in the shared folder
RUN playwright install chromium && playwright install-deps chromium
RUN chmod -R 777 /ms-playwright

# Install curl and standalone Tailwind CLI
RUN apt-get update && apt-get install -y --no-install-recommends curl && \
    curl -sLO https://github.com/tailwindlabs/tailwindcss/releases/download/v3.4.17/tailwindcss-linux-x64 && \
    chmod +x tailwindcss-linux-x64 && \
    mv tailwindcss-linux-x64 /usr/local/bin/tailwindcss && \
    apt-get purge -y --auto-remove curl && \
    rm -rf /var/lib/apt/lists/*

# Copy source code
COPY . .

# Compile Tailwind CSS in production mode
RUN tailwindcss -i static/css/input.css -o static/css/output.css --minify

# Change ownership so appuser can write cache.db, debug files, and dagster home
RUN mkdir -p /dagster_home/logs && chown -R appuser:appuser /app /dagster_home

# Switch to non-root user for security
USER appuser

EXPOSE 5000

CMD ["python", "app.py"]