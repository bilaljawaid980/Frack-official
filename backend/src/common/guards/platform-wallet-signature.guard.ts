import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import { createHash, createPublicKey, verify } from 'crypto';

const AUTHORIZATION_WINDOW_MS = 5 * 60 * 1000;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

type SignedAdminRequest = {
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  method: string;
  originalUrl: string;
};

function getHeader(request: SignedAdminRequest, name: string): string {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

@Injectable()
export class PlatformWalletSignatureGuard implements CanActivate {
  private readonly usedNonces = new Map<string, number>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<SignedAdminRequest>();
    const expectedWalletAddress = process.env.PLATFORM_OWNER?.trim();
    if (!expectedWalletAddress) {
      throw new UnauthorizedException('Platform admin wallet is not configured.');
    }

    const walletAddress = getHeader(request, 'x-admin-wallet');
    const timestamp = getHeader(request, 'x-admin-timestamp');
    const nonce = getHeader(request, 'x-admin-nonce');
    const signatureBase64 = getHeader(request, 'x-admin-signature');

    if (!walletAddress || !timestamp || !nonce || !signatureBase64) {
      throw new UnauthorizedException('Platform admin wallet signature is required.');
    }

    const timestampMs = Number(timestamp);
    const now = Date.now();
    if (
      !Number.isSafeInteger(timestampMs) ||
      timestampMs > now + 30_000 ||
      timestampMs < now - AUTHORIZATION_WINDOW_MS
    ) {
      throw new UnauthorizedException('Platform admin wallet signature has expired.');
    }

    if (!/^[a-zA-Z0-9-]{16,128}$/.test(nonce)) {
      throw new UnauthorizedException('Platform admin wallet signature nonce is invalid.');
    }

    let walletPublicKey: PublicKey;
    let expectedWalletPublicKey: PublicKey;
    try {
      walletPublicKey = new PublicKey(walletAddress);
      expectedWalletPublicKey = new PublicKey(expectedWalletAddress);
    } catch {
      throw new UnauthorizedException('Platform admin wallet address is invalid.');
    }

    if (!walletPublicKey.equals(expectedWalletPublicKey)) {
      throw new UnauthorizedException('Platform admin wallet is not authorized.');
    }

    this.pruneUsedNonces(now);
    const replayKey = `${walletPublicKey.toBase58()}:${nonce}`;
    if (this.usedNonces.has(replayKey)) {
      throw new UnauthorizedException('Platform admin wallet signature was already used.');
    }

    const path = request.originalUrl.split('?')[0];
    const bodyHash = createHash('sha256')
      .update(JSON.stringify(request.body ?? {}))
      .digest('hex');
    const message = [
      'FRACKS_ADMIN_REQUEST',
      request.method.toUpperCase(),
      path,
      timestamp,
      nonce,
      bodyHash,
    ].join('\n');

    let signature: Buffer;
    try {
      signature = Buffer.from(signatureBase64, 'base64');
    } catch {
      throw new UnauthorizedException('Platform admin wallet signature is invalid.');
    }

    if (signature.length !== 64) {
      throw new UnauthorizedException('Platform admin wallet signature is invalid.');
    }

    const publicKey = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, walletPublicKey.toBuffer()]),
      format: 'der',
      type: 'spki',
    });
    if (!verify(null, Buffer.from(message, 'utf8'), publicKey, signature)) {
      throw new UnauthorizedException('Platform admin wallet signature is invalid.');
    }

    this.usedNonces.set(replayKey, now);
    return true;
  }

  private pruneUsedNonces(now: number) {
    for (const [key, createdAt] of this.usedNonces) {
      if (createdAt < now - AUTHORIZATION_WINDOW_MS) {
        this.usedNonces.delete(key);
      }
    }
  }
}
