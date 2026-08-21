FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
  fonts-dejavu-core \
    fonts-liberation \
    imagemagick \
    libreoffice-impress \
    poppler-utils \
  unzip \
  && rm -rf /var/lib/apt/lists/*

COPY examples/brand-showcase/brands /opt/report-baby/showcase-brands
RUN mkdir -p /usr/local/share/fonts/report-baby \
  && find /opt/report-baby/showcase-brands -type f \( -iname '*.ttf' -o -iname '*.otf' \) -exec cp {} /usr/local/share/fonts/report-baby/ \; \
  && fc-cache -f

WORKDIR /workspace
ENV XDG_CONFIG_HOME=/tmp/report-baby-xdg-config
ENV XDG_CACHE_HOME=/tmp/report-baby-xdg-cache

ENTRYPOINT ["node", "scripts/run-brand-showcase-qa.js"]
