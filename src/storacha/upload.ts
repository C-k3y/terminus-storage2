/**
 * upload.ts
 * ─────────────────────────────────────────────────────────────────
 * Functions for uploading encrypted vault files to Storacha (IPFS).
 *
 * Upload strategy:
 *  Each vault file produces TWO uploads to IPFS:
 *
 *  1. encryptedFile  (the ciphertext — could be MBs large)
 *     → uploaded as a single file, returns CID_file
 *
 *  2. metadata.json  (small — a few KB)
 *     Bundles: encryptedSymmetricKey + accessControlConditions +
 *              dataToEncryptHash + mimeType + originalFileName + CID_file
 *     → uploaded as a single JSON file, returns CID_metadata
 *
 * The metadata CID is what gets stored on the Solana smart contract.
 * At retrieval time, we fetch metadata.json to reconstruct decrypt().
 * ─────────────────────────────────────────────────────────────────
 */

import { getStorageClient } from './storageClient.js';
import type {
  UploadEncryptedVaultFileParams,
  VaultUploadResult,
  VaultFileMetadata,
  DownloadProgressEvent,
} from '../types.js';

// ── Public API ─────────────────────────────────────────────────────

/**
 * Uploads an encrypted vault file and its metadata JSON to Storacha.
 * Returns the metadata CID — store this on the Solana smart contract.
 */
export async function uploadEncryptedVaultFile({
  encryptedFile,
  encryptedSymmetricKey,
  accessControlConditions,
  dataToEncryptHash,
  mimeType,
  originalFileName,
  conditionType,
  vaultPDA,
  onProgress,
}: UploadEncryptedVaultFileParams): Promise<VaultUploadResult> {
  const client = await getStorageClient();

  console.log(`[Storacha] Uploading encrypted file: "${originalFileName}" …`);

  // ── Upload 1: ciphertext ───────────────────────────────────────
  const encryptedFileName = `${sanitizeFileName(originalFileName)}.enc`;
  const encryptedFileForUpload = new File([encryptedFile], encryptedFileName, {
    type: 'application/octet-stream',
  });

  const fileCid = await client.uploadFile(encryptedFileForUpload, {
    onUploadChunk: onProgress ? (chunk) => onProgress({ chunk }) : undefined,
  });
  console.log(`[Storacha] ✅ Encrypted file CID: ${fileCid}`);

  // ── Upload 2: metadata JSON ────────────────────────────────────
  const metadata: VaultFileMetadata = {
    version: '1.0.0',
    terminus: true,
    vaultPDA,
    conditionType,
    originalFileName,
    mimeType,
    dataToEncryptHash,
    encryptedSymmetricKey,
    accessControlConditions,
    encryptedFileCid: fileCid.toString(),
    uploadedAt: new Date().toISOString(),
  };

  const metadataFile = new File(
    [JSON.stringify(metadata, null, 2)],
    'terminus-metadata.json',
    { type: 'application/json' }
  );

  const metadataCid = await client.uploadFile(metadataFile);
  console.log(`[Storacha] ✅ Metadata CID: ${metadataCid}`);

  return {
    metadataCid: metadataCid.toString(),
    encryptedFileCid: fileCid.toString(),
    metadataUrl: toIpfsGatewayUrl(metadataCid.toString()),
    encryptedFileUrl: toIpfsGatewayUrl(fileCid.toString()),
  };
}

/**
 * Fetches and parses the metadata JSON from IPFS by CID.
 * First step in the beneficiary decryption flow.
 */
export async function fetchVaultMetadata(metadataCid: string): Promise<VaultFileMetadata> {
  if (!metadataCid) throw new Error('[Storacha] metadataCid is required.');

  const url = toIpfsGatewayUrl(metadataCid);
  console.log(`[Storacha] Fetching metadata from: ${url}`);

  const resp = await fetchWithRetry(url, 3);
  if (!resp.ok) {
    throw new Error(`[Storacha] Failed to fetch metadata (${resp.status}): ${url}`);
  }

  const metadata = (await resp.json()) as VaultFileMetadata;

  if (!metadata.terminus) {
    throw new Error('[Storacha] Invalid metadata: missing terminus flag.');
  }

  return metadata;
}

/**
 * Downloads the encrypted ciphertext blob from IPFS.
 * Called after fetchVaultMetadata provides the encryptedFileCid.
 */
export async function fetchEncryptedFile(
  encryptedFileCid: string,
  onProgress?: (event: DownloadProgressEvent) => void
): Promise<Blob> {
  const url = toIpfsGatewayUrl(encryptedFileCid);
  console.log(`[Storacha] Downloading encrypted file from: ${url}`);

  const resp = await fetchWithRetry(url, 3);
  if (!resp.ok) {
    throw new Error(`[Storacha] Failed to fetch encrypted file (${resp.status}): ${url}`);
  }

  if (onProgress && resp.body) {
    const contentLength = parseInt(resp.headers.get('content-length') ?? '0', 10);
    const reader = resp.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (contentLength > 0) {
        onProgress({ received, total: contentLength, percent: (received / contentLength) * 100 });
      }
    }

    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    return new Blob([combined], { type: 'application/octet-stream' });
  }

  return resp.blob();
}

/**
 * Maps a raw CID to an IPFS gateway URL.
 * Uses w3s.link (Storacha's gateway) for best performance.
 */
export function toIpfsGatewayUrl(
  cid: string,
  gateway = 'https://w3s.link/ipfs'
): string {
  return `${gateway}/${cid}`;
}

// ── Internal helpers ───────────────────────────────────────────────

async function fetchWithRetry(url: string, maxRetries: number): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fetch(url);
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delayMs = 1000 * attempt;
        console.warn(`[Storacha] Fetch attempt ${attempt} failed. Retrying in ${delayMs}ms…`);
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
