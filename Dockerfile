FROM python:3.10-slim

# Create a non-root user and give him a home directory with proper permissions
RUN groupadd -r appuser && useradd -r -g appuser -m -d /home/appuser appuser

WORKDIR /app

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Definir la ruta donde Playwright guardará los navegadores para que sean accesibles
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Instalar Playwright y Chromium globalmente en esa carpeta compartida
RUN playwright install chromium && playwright install-deps chromium
RUN chmod -R 777 /ms-playwright

# Copy source code
COPY . .

# Change ownership so appuser can write cache.db and debug files
RUN chown -R appuser:appuser /app

# Switch to non-root user for security
USER appuser

EXPOSE 5000

CMD ["python", "app.py"]