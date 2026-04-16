import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import forge from 'node-forge';

const CERT_DIR_NAME = 'selfsigned-certs';
const CA_KEY_FILE = 'ca.key';
const CA_CERT_FILE = 'ca.crt';
const CA_VALIDITY_YEARS = 10;
const DOMAIN_CERT_VALIDITY_YEARS = 5;

export class SelfSignedCertManager {
  private dataDir: string;
  private certDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.certDir = join(dataDir, CERT_DIR_NAME);
  }

  async init(selfSignedDomains: string[]): Promise<void> {
    if (selfSignedDomains.length === 0) return;

    await mkdir(this.certDir, { recursive: true });
    await this.ensureCaCert();

    for (const domain of selfSignedDomains) {
      await this.ensureDomainCert(domain);
    }

    useLogger().info(`[selfsigned-certs] initialized CA + ${selfSignedDomains.length} domain cert(s)`);
  }

  /**
   * Generate a wildcard certificate for an arbitrary host (typically a
   * subdomain like `sub.domain.com`) signed by the self-signed CA. The cert
   * covers both `host` and `*.host` so it can serve any single-label prefix.
   * Idempotent — skips generation if the cert already exists on disk.
   */
  async ensureWildcardCertForHost(host: string): Promise<void> {
    await mkdir(this.certDir, { recursive: true });
    await this.ensureCaCert();
    await this.ensureDomainCert(host);
  }

  async getCaCertPem(): Promise<string> {
    return readFile(join(this.certDir, CA_CERT_FILE), 'utf-8');
  }

  getCertPath(domain: string): string {
    return join(this.certDir, `${domain}.crt`);
  }

  getKeyPath(domain: string): string {
    return join(this.certDir, `${domain}.key`);
  }

  /** Paths relative to /data (for use inside the Traefik container where /data is mounted) */
  getTraefikCertPath(domain: string): string {
    return `/data/${CERT_DIR_NAME}/${domain}.crt`;
  }

  getTraefikKeyPath(domain: string): string {
    return `/data/${CERT_DIR_NAME}/${domain}.key`;
  }

  private async ensureCaCert(): Promise<void> {
    const keyPath = join(this.certDir, CA_KEY_FILE);
    const certPath = join(this.certDir, CA_CERT_FILE);

    if (await this.fileExists(keyPath) && await this.fileExists(certPath)) return;

    useLogger().info('[selfsigned-certs] generating CA certificate...');
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();

    cert.publicKey = keys.publicKey;
    cert.serialNumber = generateSerial();
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + CA_VALIDITY_YEARS);

    const attrs = [
      { name: 'commonName', value: 'Agentor Self-Signed CA' },
      { name: 'organizationName', value: 'Agentor' },
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);

    cert.setExtensions([
      { name: 'basicConstraints', cA: true, critical: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
      { name: 'subjectKeyIdentifier' },
    ]);

    cert.sign(keys.privateKey, forge.md.sha256.create());

    await writeFile(keyPath, forge.pki.privateKeyToPem(keys.privateKey));
    await writeFile(certPath, forge.pki.certificateToPem(cert));
    useLogger().info('[selfsigned-certs] CA certificate generated');
  }

  private async ensureDomainCert(domain: string): Promise<void> {
    const certPath = this.getCertPath(domain);
    const keyPath = this.getKeyPath(domain);

    if (await this.fileExists(certPath) && await this.fileExists(keyPath)) return;

    useLogger().info(`[selfsigned-certs] generating wildcard certificate for ${domain}...`);

    const caKeyPem = await readFile(join(this.certDir, CA_KEY_FILE), 'utf-8');
    const caCertPem = await readFile(join(this.certDir, CA_CERT_FILE), 'utf-8');
    const caKey = forge.pki.privateKeyFromPem(caKeyPem);
    const caCert = forge.pki.certificateFromPem(caCertPem);

    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();

    cert.publicKey = keys.publicKey;
    cert.serialNumber = generateSerial();
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + DOMAIN_CERT_VALIDITY_YEARS);

    cert.setSubject([
      { name: 'commonName', value: `*.${domain}` },
      { name: 'organizationName', value: 'Agentor' },
    ]);
    cert.setIssuer(caCert.subject.attributes);

    cert.setExtensions([
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectKeyIdentifier' },
      { name: 'authorityKeyIdentifier', keyIdentifier: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: domain },
          { type: 2, value: `*.${domain}` },
        ],
      },
    ]);

    cert.sign(caKey, forge.md.sha256.create());

    await writeFile(keyPath, forge.pki.privateKeyToPem(keys.privateKey));
    await writeFile(certPath, forge.pki.certificateToPem(cert));
    useLogger().info(`[selfsigned-certs] wildcard certificate for ${domain} generated`);
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }
}

function generateSerial(): string {
  const bytes = forge.random.getBytesSync(16);
  return forge.util.bytesToHex(bytes);
}
