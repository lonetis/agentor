# Test runner image for agentor's dockerized test suite.
#
# Built on the Playwright base image (Node 22 + Chromium preinstalled),
# with Docker Engine layered on top so the runner can boot a fresh
# agentor stack inside its own dockerd (DinD).
FROM mcr.microsoft.com/playwright:v1.58.2-noble

# Install Docker Engine + compose plugin + a few utilities.
# get.docker.com is the official upstream installer.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl jq iptables uidmap dnsmasq \
    && curl -fsSL https://get.docker.com | sh \
    && rm -rf /var/lib/apt/lists/*

# Inner dockerd config (overlay2 + log rotation, mirrors worker entrypoint).
COPY daemon.json /etc/docker/daemon.json

# Inner agentor stack compose file. Per-user agent credential files are
# created on-demand by UserCredentialManager when each user is provisioned —
# no pre-seeded files needed. Tests requiring real agent auth skip
# themselves when no key is present in the admin user's account env vars.
COPY stack.yml /opt/test-stack/stack.yml

# Test runner entrypoint — boots dockerd, builds images, brings up the
# inner stack, runs playwright with passthrough args, tears down on exit.
COPY test-entrypoint.sh /usr/local/bin/test-entrypoint.sh
RUN chmod +x /usr/local/bin/test-entrypoint.sh

# Workdir for the playwright invocation. The host bind-mount lands here.
WORKDIR /work/tests

ENTRYPOINT ["/usr/local/bin/test-entrypoint.sh"]
CMD []
