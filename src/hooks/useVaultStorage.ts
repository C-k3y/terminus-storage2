/**
 * useVaultStorage.ts
 * ─────────────────────────────────────────────────────────────────
 * Typed React hook that wraps the storage/encryption module for the
 * Terminus frontend (Dev 3).
 *
 * Usage in Owner Dashboard:
 *   const { uploadFile, isUploading, uploadProgress } = useVaultStorage(vaultPDA, ownerAddress);
 *   const result = await uploadFile(file, 'deceased');
 *
 * Usage in Beneficiary Claim Portal:
 *   const { claimFile, isClaiming, decryptedFiles, downloadFile } = useVaultStorage(vaultPDA);
 *   await claimFile(metadataCid);
 *
 * NOTE: Uses Privy for wallet access. Swap useWallets() for your
 * Web3Auth equivalent if needed.
 * ─────────────────────────────────────────────────────────────────
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useWallets } from '@privy-io/react-auth'; // swap for Web3Auth if needed
import {
  storeVaultFile,
  retrieveVaultFile,
} from '../vault/vaultStorage.js';
import { generateAuthSigFromSigner } from '../lit/authHelpers.js';
import { TerminusDecryptionError } from '../lit/decrypt.js';
import type {
  StoreResult,
  DecryptedFileEntry,
  ConditionType,
  UploadProgressEvent,
  DownloadProgressEvent,
} from '../types.js';

// ── Hook return type ───────────────────────────────────────────────

export interface UseVaultStorageReturn {
  // Owner — upload flow
  uploadFile: (file: File, conditionType?: ConditionType) => Promise<StoreResult>;
  isUploading: boolean;
  uploadProgress: number;
  uploadError: string | null;

  // Beneficiary — claim flow
  claimFile: (metadataCid: string) => Promise<DecryptedFileEntry>;
  isClaiming: boolean;
  claimProgress: number;
  claimError: string | null;
  decryptedFiles: DecryptedFileEntry[];
  downloadFile: (fileEntry: DecryptedFileEntry) => void;
}

// ── Hook ───────────────────────────────────────────────────────────

/**
 * @param vaultPDA            Base-58 Solana PDA of the current vault
 * @param ownerSolanaAddress  Owner's Solana wallet address (required for upload)
 */
export function useVaultStorage(
  vaultPDA: string,
  ownerSolanaAddress?: string
): UseVaultStorageReturn {
  const { wallets } = useWallets();

  // Upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Claim state
  const [isClaiming, setIsClaiming] = useState(false);
  const [claimProgress, setClaimProgress] = useState(0);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [decryptedFiles, setDecryptedFiles] = useState<DecryptedFileEntry[]>([]);

  // Track object URLs for cleanup on unmount
  const objectUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  // ── getSigner ────────────────────────────────────────────────────
  const getSigner = useCallback(async () => {
    const wallet = wallets[0];
    if (!wallet) throw new Error('No wallet connected. Please log in first.');
    const provider = await wallet.getEthersProvider();
    return provider.getSigner();
  }, [wallets]);

  // ── uploadFile ───────────────────────────────────────────────────
  const uploadFile = useCallback(
    async (file: File, conditionType: ConditionType = 'deceased'): Promise<StoreResult> => {
      if (!vaultPDA) throw new Error('vaultPDA is required.');
      if (!ownerSolanaAddress) throw new Error('ownerSolanaAddress is required for upload.');

      setIsUploading(true);
      setUploadProgress(0);
      setUploadError(null);

      try {
        const signer = await getSigner();
        const authSig = await generateAuthSigFromSigner(signer);

        const result = await storeVaultFile({
          file,
          vaultPDA,
          ownerSolanaAddress,
          conditionType,
          authSig,
          onProgress: (e: UploadProgressEvent) => {
            if (e.percent !== undefined) setUploadProgress(Math.round(e.percent));
          },
        });

        setUploadProgress(100);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setUploadError(msg);
        throw err;
      } finally {
        setIsUploading(false);
      }
    },
    [vaultPDA, ownerSolanaAddress, getSigner]
  );

  // ── claimFile ────────────────────────────────────────────────────
  const claimFile = useCallback(
    async (metadataCid: string): Promise<DecryptedFileEntry> => {
      setIsClaiming(true);
      setClaimProgress(0);
      setClaimError(null);

      try {
        const signer = await getSigner();
        const authSig = await generateAuthSigFromSigner(signer);

        const result = await retrieveVaultFile({
          metadataCid,
          authSig,
          onProgress: (e: DownloadProgressEvent) => {
            setClaimProgress(Math.round(e.percent));
          },
        });

        objectUrlsRef.current.push(result.objectUrl);

        const entry: DecryptedFileEntry = {
          metadataCid,
          objectUrl: result.objectUrl,
          originalFileName: result.originalFileName,
          mimeType: result.mimeType,
          blob: result.blob,
          text: result.mimeType.startsWith('text/') ? await result.text() : null,
        };

        setDecryptedFiles((prev) => [...prev, entry]);
        setClaimProgress(100);
        return entry;
      } catch (err) {
        let msg: string;
        if (err instanceof TerminusDecryptionError && err.code === 'VAULT_LOCKED') {
          msg = 'Vault is not yet unlocked. The 30-day challenge period must complete first.';
        } else {
          msg = err instanceof Error ? err.message : String(err);
        }
        setClaimError(msg);
        throw err;
      } finally {
        setIsClaiming(false);
      }
    },
    [getSigner]
  );

  // ── downloadFile ─────────────────────────────────────────────────
  const downloadFile = useCallback((fileEntry: DecryptedFileEntry): void => {
    const a = document.createElement('a');
    a.href = fileEntry.objectUrl;
    a.download = fileEntry.originalFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  return {
    uploadFile,
    isUploading,
    uploadProgress,
    uploadError,
    claimFile,
    isClaiming,
    claimProgress,
    claimError,
    decryptedFiles,
    downloadFile,
  };
}
