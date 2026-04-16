import { APIRequestContext } from '@playwright/test';
import { ApiClient } from './api-client';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import WSImpl from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const WS_URL = BASE_URL.replace(/^http/, 'ws');
const AUTH_STATE_PATH = resolve(__dirname, '..', '.auth/admin-api.json');

/**
 * Build a Cookie header from the admin storage state file written by the
 * Playwright global setup. The terminal WebSocket requires a valid session.
 */
function buildAdminCookieHeader(): string {
  if (!existsSync(AUTH_STATE_PATH)) return '';
  try {
    const state = JSON.parse(readFileSync(AUTH_STATE_PATH, 'utf-8'));
    const cookies = (state?.cookies ?? []) as Array<{ name: string; value: string }>;
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  } catch {
    return '';
  }
}

/**
 * Strip ANSI escape codes from terminal output for clean pattern matching.
 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')   // OSC sequences
    .replace(/\x1b\[[\?]?[0-9;]*[hlm]/g, '') // mode set/reset
    .replace(/\x1b[()][0-9A-B]/g, '')      // charset selection
    .replace(/\x1b\[[0-9]*[ABCDJK]/g, '')  // cursor movement / erase
    .replace(/\r/g, '');                     // carriage returns
}

export interface AgentCredentials {
  claude: boolean;
  codex: boolean;
  gemini: boolean;
}

/**
 * Check which agents have credentials configured (API keys or .cred/ files).
 */
export async function checkAgentCredentials(request: APIRequestContext): Promise<AgentCredentials> {
  const api = new ApiClient(request);
  const [{ body: envVars }, { body: creds }] = await Promise.all([
    api.listOrchestratorEnvVars(),
    api.listCredentials(),
  ]);

  const vars = envVars as { name: string; configured: boolean }[];
  const hasEnv = (name: string) => vars.find(v => v.name === name)?.configured ?? false;

  const credFiles = creds as { agentId: string; configured: boolean }[];
  const hasCred = (agentId: string) => credFiles.find(c => c.agentId === agentId)?.configured ?? false;

  return {
    claude: hasEnv('ANTHROPIC_API_KEY') || hasEnv('CLAUDE_CODE_OAUTH_TOKEN') || hasCred('claude'),
    codex: hasEnv('OPENAI_API_KEY') || hasCred('codex'),
    gemini: hasEnv('GEMINI_API_KEY') || hasCred('gemini'),
  };
}

/**
 * WebSocket client for connecting to a worker's terminal.
 * Uses the `ws` package so we can pass a Cookie header for authenticated sessions.
 */
export class TerminalWsClient {
  private ws: WSImpl | null = null;
  private buffer = '';
  private rawBuffer = '';

  constructor(
    public readonly containerId: string,
    public readonly windowName = 'main',
  ) {}

  /**
   * Connect to the terminal WebSocket and wait for the connection to open.
   *
   * Retries on transient errors (e.g. 404 from a brief route-table race
   * after the container starts) — under heavy concurrency in the
   * dockerized runner the orchestrator can momentarily fail to find the
   * container, even though the container is running.
   */
  async connect(timeoutMs = 10_000): Promise<void> {
    if (this.ws) throw new Error('Already connected');

    const url = this.windowName === 'main'
      ? `${WS_URL}/ws/terminal/${this.containerId}`
      : `${WS_URL}/ws/terminal/${this.containerId}/${this.windowName}`;

    const cookieHeader = buildAdminCookieHeader();
    const headers = cookieHeader ? { Cookie: cookieHeader } : undefined;

    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await new Promise<void>((resolvePromise, reject) => {
          const timer = setTimeout(() => reject(new Error(`WebSocket connect timeout after ${timeoutMs}ms`)), timeoutMs);
          this.ws = new WSImpl(url, { headers });

          this.ws.on('open', () => {
            clearTimeout(timer);
            resolvePromise();
          });

          this.ws.on('message', (data: Buffer) => {
            const text = data.toString('utf-8');
            this.rawBuffer += text;
            this.buffer += stripAnsi(text);
          });

          this.ws.on('error', (err) => {
            clearTimeout(timer);
            reject(new Error(`WebSocket error: ${err.message}`));
          });

          this.ws.on('close', () => {
            clearTimeout(timer);
          });
        });
        return;
      } catch (e) {
        lastErr = e as Error;
        const ws = this.ws as WSImpl | null;
        if (ws) { try { ws.close(); } catch { /* ignore */ } }
        this.ws = null;
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  /**
   * Send a line of text (appends \n). Works for shell commands.
   */
  sendLine(text: string): void {
    if (!this.ws || this.ws.readyState !== WSImpl.OPEN) {
      throw new Error('WebSocket not connected');
    }
    this.ws.send(text + '\n');
  }

  /**
   * Send text and press Enter (\r). Use for TUI apps (Claude, Codex, Gemini)
   * that read raw terminal input where Enter = \r.
   */
  sendEnter(text: string): void {
    if (!this.ws || this.ws.readyState !== WSImpl.OPEN) {
      throw new Error('WebSocket not connected');
    }
    this.ws.send(text + '\r');
  }

  /**
   * Send raw text without appending newline.
   */
  sendRaw(text: string): void {
    if (!this.ws || this.ws.readyState !== WSImpl.OPEN) {
      throw new Error('WebSocket not connected');
    }
    this.ws.send(text);
  }

  /**
   * Send a resize message.
   */
  sendResize(cols: number, rows: number): void {
    if (!this.ws || this.ws.readyState !== WSImpl.OPEN) {
      throw new Error('WebSocket not connected');
    }
    this.ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  }

  /**
   * Wait for the output buffer to match a pattern (string or RegExp).
   * Checks the ANSI-stripped buffer.
   */
  async waitForOutput(pattern: string | RegExp, timeoutMs = 30_000): Promise<string> {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      if (regex.test(this.buffer)) {
        return this.buffer;
      }
      await new Promise(r => setTimeout(r, 100));
    }

    throw new Error(
      `Timeout waiting for pattern ${regex} after ${timeoutMs}ms.\n` +
      `Buffer (last 2000 chars):\n${this.buffer.slice(-2000)}`
    );
  }

  /**
   * Get the current clean (ANSI-stripped) buffer contents.
   */
  getBuffer(): string {
    return this.buffer;
  }

  /**
   * Get the raw buffer (with ANSI codes).
   */
  getRawBuffer(): string {
    return this.rawBuffer;
  }

  /**
   * Clear both buffers.
   */
  clearBuffer(): void {
    this.buffer = '';
    this.rawBuffer = '';
  }

  /**
   * Close the WebSocket connection.
   */
  close(): void {
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
  }
}
