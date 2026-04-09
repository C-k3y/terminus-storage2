/**
 * storageClient.ts
 * ─────────────────────────────────────────────────────────────────
 * Singleton wrapper around the Storacha w3up client.
 *
 * Storacha satisfies NFR3 (High Availability): files are stored on
 * IPFS via the w3up protocol, guaranteeing redundancy and
 * content-addressed retrieval even if servers go down.
 *
 * SETUP GUIDE (run once before deploying):
 *  1.  npm install -g @web3-storage/w3up-client
 *  2.  w3 login <your-email>
 *  3.  w3 space create terminus-vault-mainnet
 *  4.  w3 space ls                  ← copy the DID → STORACHA_SPACE_DID
 *  5.  w3 key create                ← copy private key → STORACHA_PRINCIPAL_KEY
 *  6.  w3 space delegation create <agent-DID> --can 'store/add' --can 'upload/add'
 *      ← produces a proof string → STORACHA_PROOF
 * ─────────────────────────────────────────────────────────────────
 */

import * as W3UpClient from '@web3-storage/w3up-client';
import { Signer } from '@web3-storage/w3up-client/principal/ed25519';
import { StoreMemory } from '@web3-storage/w3up-client/stores/memory';
import * as Proof from '@web3-storage/w3up-client/proof';

type W3Client = Awaited<ReturnType<typeof W3UpClient.create>>;

// ── Custom error ───────────────────────────────────────────────────

export class StorachaConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorachaConfigError';
  }
}

// ── Singleton state ────────────────────────────────────────────────

let _storageClient: W3Client | null = null;

/**
 * Returns (and lazily initialises) the shared Storacha w3up client.
 * Safe to call multiple times — initialisation happens only once.
 */
export async function getStorageClient(): Promise<W3Client> {
  if (_storageClient !== null) return _storageClient;

  const principalKey = process.env['STORACHA_PRINCIPAL_KEY'];
  const spaceDid = process.env['STORACHA_SPACE_DID'];
  const proofStr = process.env['STORACHA_PROOF'];

  if (!principalKey) {
    throw new StorachaConfigError(
      'STORACHA_PRINCIPAL_KEY is not set in .env. ' +
      'Run: w3 key create  and paste the private key here.'
    );
  }
  if (!spaceDid) {
    throw new StorachaConfigError(
      'STORACHA_SPACE_DID is not set in .env. ' +
      'Run: w3 space create terminus-vault  and copy the DID.'
    );
  }

  console.log('[Storacha] Initialising w3up client …');

  const principal = Signer.parse(principalKey);
  const store = new StoreMemory();

  _storageClient = await W3UpClient.create({ principal, store });

  if (proofStr) {
    const proof = await Proof.parse(proofStr);
    const space = await _storageClient.addSpace(proof);
    await _storageClient.setCurrentSpace(space.did());
    console.log(`[Storacha] ✅ Space set via proof: ${space.did()}`);
  } else {
    await _storageClient.setCurrentSpace(spaceDid as `did:${string}:${string}`);
    console.log(`[Storacha] ✅ Space set (direct): ${spaceDid}`);
  }

  return _storageClient;
}

/**
 * Resets the singleton — useful in tests.
 */
export function resetStorageClient(): void {
  _storageClient = null;
}
