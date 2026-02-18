#!/bin/bash
set -e

mkdir -p ~/.codex
# Docker may create this dir as root when bind-mounting credential files
sudo chown agent:agent ~/.codex

# OAuth credentials are bind-mounted at ~/.codex/auth.json
# (shared across all workers via .cred/codex.json on the host)

# API key auth — OPENAI_API_KEY is read from the environment directly by the CLI
