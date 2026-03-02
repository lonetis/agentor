import { APIRequestContext } from '@playwright/test';
import { ApiClient } from './api-client';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const WS_URL = BASE_URL.replace(/^http/, 'ws');

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
  const { body } = await api.listOrchestratorEnvVars();

  const vars = body as { name: string; configured: boolean }[];
  const has = (name: string) => vars.find(v => v.name === name)?.configured ?? false;

  return {
    claude: has('ANTHROPIC_API_KEY') || has('.cred/claude.json'),
    codex: has('OPENAI_API_KEY') || has('.cred/codex.json'),
    gemini: has('GEMINI_API_KEY') || has('.cred/gemini.json'),
  };
}

/**
 * WebSocket client for connecting to a worker's terminal.
 * Uses Node.js native WebSocket (available in Node 22+).
 */
export class TerminalWsClient {
  private ws: WebSocket | null = null;
  private buffer = '';
  private rawBuffer = '';
  private connectPromise: Promise<void> | null = null;

  constructor(
    public readonly containerId: string,
    public readonly windowName = 'main',
  ) {}

  /**
   * Connect to the terminal WebSocket and wait for the connection to open.
   */
  async connect(timeoutMs = 10_000): Promise<void> {
    if (this.ws) throw new Error('Already connected');

    const url = this.windowName === 'main'
      ? `${WS_URL}/ws/terminal/${this.containerId}`
      : `${WS_URL}/ws/terminal/${this.containerId}/${this.windowName}`;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`WebSocket connect timeout after ${timeoutMs}ms`)), timeoutMs);

      this.ws = new WebSocket(url);
      this.ws.binaryType = 'arraybuffer';

      this.ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      });

      this.ws.addEventListener('message', (event) => {
        let text: string;
        if (event.data instanceof ArrayBuffer) {
          text = new TextDecoder().decode(event.data);
        } else {
          text = String(event.data);
        }
        this.rawBuffer += text;
        this.buffer += stripAnsi(text);
      });

      this.ws.addEventListener('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`WebSocket error: ${err}`));
      });

      this.ws.addEventListener('close', () => {
        clearTimeout(timer);
      });
    });

    return this.connectPromise;
  }

  /**
   * Send a line of text (appends \n). Works for shell commands.
   */
  sendLine(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    this.ws.send(text + '\n');
  }

  /**
   * Send text and press Enter (\r). Use for TUI apps (Claude, Codex, Gemini)
   * that read raw terminal input where Enter = \r.
   */
  sendEnter(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    this.ws.send(text + '\r');
  }

  /**
   * Send raw text without appending newline.
   */
  sendRaw(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    this.ws.send(text);
  }

  /**
   * Send a resize message.
   */
  sendResize(cols: number, rows: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
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
      await new Promise(r => setTimeout(r, 200));
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
