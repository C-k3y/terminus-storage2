/**
 * accessConditions.ts
 * ─────────────────────────────────────────────────────────────────
 * Builds the Lit Protocol Unified Access Control Conditions that
 * govern when encrypted vault files can be decrypted.
 *
 * TWO condition sets are exported:
 *
 *  1. buildDeceasedConditions(vaultPDA)
 *     ── Checks the Solana vault account's `state` field equals
 *        VaultState::Unlocked (value = 3).  Used for full-asset
 *        and private-document release (FR9: DECEASED path, FR10).
 *
 *  2. buildIncapacitatedConditions(vaultPDA)
 *     ── Checks the vault is in VaultState::ChallengePeriod (2).
 *        Used for monthly allowance release (FR9: INCAPACITATED).
 *
 * ─── Vault State Enum (must match Rust contract) ─────────────────
 *   0 = Active
 *   1 = AwaitingProof
 *   2 = ChallengePeriod
 *   3 = Unlocked  ← this is what Lit waits for
 *   4 = Cancelled
 *
 * ─── IMPORTANT: Coordinate with Dev 1 ────────────────────────────
 *   STATE_BYTE_OFFSET must equal the byte index of the `state: VaultState`
 *   field in the serialised Anchor account struct.
 *   Typical layout (add up field sizes before `state`):
 *     8   bytes  — Anchor discriminator
 *     32  bytes  — owner: Pubkey
 *     32  bytes  — beneficiary: Pubkey
 *     32  bytes  — medical_fiduciary: Pubkey
 *     8   bytes  — created_at: i64
 *     8   bytes  — heartbeat_deadline: i64
 *     8   bytes  — challenge_ends_at: i64
 *     1   byte   — state: VaultState  ← offset 128
 * ─────────────────────────────────────────────────────────────────
 */

import type { UnifiedAccessControlConditions } from '../types.js';
import type { LitSolanaChain, SolanaNetwork } from '../types.js';

// ── Byte layout constants — update if Rust struct changes ─────────
const STATE_BYTE_OFFSET = 128;
const UNLOCKED_STATE_VALUE = 3;       // VaultState::Unlocked
const CHALLENGE_PERIOD_STATE_VALUE = 2; // VaultState::ChallengePeriod

/**
 * Returns unified Lit access conditions that unlock ONLY when the
 * Solana vault account has reached the `Unlocked` (3) state.
 */
export function buildDeceasedConditions(
  vaultPDA: string,
  network: LitSolanaChain = resolveChain()
): UnifiedAccessControlConditions {
  if (!vaultPDA) {
    throw new Error('[AccessConditions] vaultPDA must be a non-empty base-58 string.');
  }

  return [
    {
      conditionType: 'solRpc',
      method: 'getAccountInfo',
      params: [vaultPDA, { encoding: 'base64' }],
      chain: network,
      returnValueTest: {
        key: '$.value[0].data[0]',
        comparator: 'contains',
        value: buildExpectedStateSlice(STATE_BYTE_OFFSET, UNLOCKED_STATE_VALUE),
      },
    },
  ];
}

/**
 * Returns access conditions for the INCAPACITATED path.
 * The vault must be in ChallengePeriod (2) state.
 */
export function buildIncapacitatedConditions(
  vaultPDA: string,
  network: LitSolanaChain = resolveChain()
): UnifiedAccessControlConditions {
  if (!vaultPDA) {
    throw new Error('[AccessConditions] vaultPDA must be a non-empty base-58 string.');
  }

  return [
    {
      conditionType: 'solRpc',
      method: 'getAccountInfo',
      params: [vaultPDA, { encoding: 'base64' }],
      chain: network,
      returnValueTest: {
        key: '$.value[0].data[0]',
        comparator: 'contains',
        value: buildExpectedStateSlice(STATE_BYTE_OFFSET, CHALLENGE_PERIOD_STATE_VALUE),
      },
    },
  ];
}

/**
 * Returns conditions for the owner's authenticated session.
 * The owner can always decrypt their own files (e.g. to update them).
 */
export function buildOwnerConditions(
  ownerSolanaAddress: string,
  network: LitSolanaChain = resolveChain()
): UnifiedAccessControlConditions {
  if (!ownerSolanaAddress) {
    throw new Error('[AccessConditions] ownerSolanaAddress must be a non-empty string.');
  }

  return [
    {
      conditionType: 'solRpc',
      method: 'getBalance',
      params: [':userAddress'],
      chain: network,
      returnValueTest: {
        key: '$.value',
        comparator: '>',
        value: '0',
      },
    },
  ];
}

// ── Internal helpers ───────────────────────────────────────────────

/**
 * Encodes the expected state byte as a base64 string for Lit's
 * `contains` comparator to match against the raw account data.
 */
function buildExpectedStateSlice(offset: number, stateVal: number): string {
  const buf = Buffer.alloc(1);
  buf.writeUInt8(stateVal, 0);
  return buf.toString('base64');
}

/** Maps SOLANA_NETWORK env var to Lit chain identifier. */
function resolveChain(): LitSolanaChain {
  const net = (process.env['SOLANA_NETWORK'] ?? 'devnet') as SolanaNetwork;
  const map: Record<SolanaNetwork, LitSolanaChain> = {
    'mainnet-beta': 'solana',
    'devnet': 'solanaDevnet',
    'testnet': 'solanaTestnet',
  };
  return map[net] ?? 'solanaDevnet';
}
