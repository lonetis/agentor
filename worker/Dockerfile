FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# Basic packages + desktop dependencies
RUN apt-get update && apt-get install -y \
    git \
    tmux \
    curl \
    wget \
    build-essential \
    python3 \
    python3-pip \
    python3-venv \
    ripgrep \
    fd-find \
    sudo \
    ca-certificates \
    locales \
    gnupg2 \
    xvfb \
    fluxbox \
    x11vnc \
    novnc \
    websockify \
    procps \
    fonts-liberation \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libgbm1 \
    libasound2t64 \
    jq \
    neovim \
    vim \
    nano \
    less \
    htop \
    btop \
    tree \
    unzip \
    zip \
    tar \
    gzip \
    openssh-client \
    rsync \
    strace \
    dnsutils \
    net-tools \
    iputils-ping \
    file \
    man-db \
    && rm -rf /var/lib/apt/lists/*

# Node.js 22 LTS + npm
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Playwright + bundled Chromium & Firefox (version-matched for reliability)
RUN npm install -g playwright && \
    npx playwright install --with-deps chromium firefox

# GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && \
    chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list && \
    apt-get update && apt-get install -y --no-install-recommends gh && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Chromium (from Debian bookworm — Ubuntu 24.04 only ships a snap wrapper)
RUN curl -fsSL https://ftp-master.debian.org/keys/archive-key-12.asc \
      | gpg --dearmor -o /usr/share/keyrings/debian-bookworm.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/debian-bookworm.gpg] http://deb.debian.org/debian bookworm main" \
      > /etc/apt/sources.list.d/debian-bookworm.list && \
    printf 'Package: *\nPin: origin deb.debian.org\nPin-Priority: 1\n\nPackage: chromium chromium-common chromium-sandbox\nPin: origin deb.debian.org\nPin-Priority: 500\n' \
      > /etc/apt/preferences.d/debian-chromium && \
    apt-get update && apt-get install -y --no-install-recommends chromium && \
    apt-get clean && rm -rf /var/lib/apt/lists/* && \
    rm -f /etc/apt/sources.list.d/debian-bookworm.list /etc/apt/preferences.d/debian-chromium

# Firefox (from Mozilla PPA — Ubuntu 24.04 only ships a snap wrapper)
RUN install -d -m 0755 /etc/apt/keyrings && \
    curl -fsSL https://packages.mozilla.org/apt/repo-signing-key.gpg \
      -o /etc/apt/keyrings/packages.mozilla.org.asc && \
    echo "deb [signed-by=/etc/apt/keyrings/packages.mozilla.org.asc] https://packages.mozilla.org/apt mozilla main" \
      > /etc/apt/sources.list.d/mozilla.list && \
    printf 'Package: *\nPin: origin packages.mozilla.org\nPin-Priority: 1000\n' \
      > /etc/apt/preferences.d/mozilla && \
    apt-get update && apt-get install -y --no-install-recommends firefox && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# microsocks (SOCKS5 proxy)
RUN apt-get update && apt-get install -y --no-install-recommends microsocks && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Network firewall: dnsmasq (DNS filtering + ipset integration) + ipset + iptables
RUN apt-get update && apt-get install -y --no-install-recommends dnsmasq ipset iptables && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Docker Engine (for Docker-in-Docker support, opt-in per environment)
RUN curl -fsSL https://get.docker.com | sh && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Codex CLI
RUN npm install -g @openai/codex

# Gemini CLI
RUN npm install -g @google/gemini-cli

# code-server (VS Code in browser)
RUN curl -fsSL https://code-server.dev/install.sh | sh

# Prefer IPv4 for localhost in getaddrinfo (fixes SOCKS5 proxy resolving
# localhost to ::1 when services only listen on IPv4)
RUN echo "precedence ::ffff:0:0/96 100" > /etc/gai.conf

# Generate UTF-8 locale
RUN locale-gen en_US.UTF-8
ENV LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
ENV DISPLAY=:99

# Pre-create X11 socket directory with correct permissions (Xvfb runs as non-root)
RUN mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix

# Create non-root agent user with passwordless sudo
RUN userdel -r ubuntu 2>/dev/null || true && \
    useradd -m -s /bin/bash -u 1000 agent && \
    echo "agent ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers && \
    usermod -aG docker agent

COPY --chmod=755 entrypoint.sh /home/agent/entrypoint.sh
COPY --chmod=755 loading-screen.sh /home/agent/loading-screen.sh
COPY --chmod=755 apps/ /home/agent/apps/

# Git identity wrapper — shadows /usr/bin/git, detects the calling agent
# via /proc process tree and sets author/committer from agents/*/git-identity
COPY --chmod=755 git-wrapper.sh /usr/local/bin/git

RUN mkdir -p /workspace /home/agent/pids /home/agent/profiles && \
    chown -R agent:agent /workspace /home/agent/pids /home/agent/profiles

EXPOSE 6080 8443

USER agent

# Claude CLI (installed as agent user — goes to ~/.local/bin)
RUN curl -fsSL https://claude.ai/install.sh | bash
ENV PATH="/home/agent/.local/bin:${PATH}"

# Agent setup/start scripts
COPY --chown=agent:agent agents/ /home/agent/agents/
RUN chmod +x /home/agent/agents/*/setup.sh

WORKDIR /workspace

ENTRYPOINT ["/home/agent/entrypoint.sh"]
