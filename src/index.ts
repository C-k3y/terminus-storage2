/**
 * index.ts — Terminus Storage & Encryption Module
 * ─────────────────────────────────────────────────────────────────
 * Public API. Import from this file everywhere else.
 *
 * @example
 * import {
 *   storeVaultFile,
 *   retrieveVaultFile,
 *   generateAuthSigFromSigner,
 *   TerminusDecryptionError,
 * } from 'terminus-storage';
 * ─────────────────────────────────────────────────────────────────
 */

// ── High-level vault API ───────────────────────────────────────────
export {
  storeVaultFile,
  storeVaultText,
  retrieveVaultFile,
  retrieveAllVaultFiles,
} from './vault/vaultStorage.js';

// ── Auth helpers ───────────────────────────────────────────────────
export {
  generateAuthSigFromSigner,
  generateSessionSigs,
  generateAuthSigFromPrivateKey,
} from './lit/authHelpers.js';

// ── Lit client ─────────────────────────────────────────────────────
export { getLitClient, disconnectLit } from './lit/litClient.js';

// ── Storacha helpers ───────────────────────────────────────────────
export {
  fetchVaultMetadata,
  fetchEncryptedFile,
  toIpfsGatewayUrl,
} from './storacha/upload.js';

// ── Access condition builders ──────────────────────────────────────
export {
  buildDeceasedConditions,
  buildIncapacitatedConditions,
  buildOwnerConditions,
} from './lit/accessConditions.js';

// ── Error classes ──────────────────────────────────────────────────
export { TerminusDecryptionError } from './lit/decrypt.js';
export { StorachaConfigError } from './storacha/storageClient.js';

// ── All types ──────────────────────────────────────────────────────
export type {
  VaultState,
  ConditionType,
  SolanaNetwork,
  LitSolanaChain,
  LitNetworkName,
  EncryptedVaultFile,
  StoreResult,
  VaultFileMetadata,
  VaultUploadResult,
  DecryptedVaultFile,
  DecryptedFileEntry,
  UploadProgressEvent,
  DownloadProgressEvent,
  EncryptVaultFileParams,
  EncryptVaultTextParams,
  DecryptVaultFileParams,
  StoreVaultFileParams,
  StoreVaultTextParams,
  RetrieveVaultFileParams,
  RetrieveAllVaultFilesParams,
  RetrieveAllResult,
  DecryptionErrorCode,
} from './types.js';
