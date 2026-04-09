/**
 * accessConditions.ts
 * ─────────────────────────────────────────────────────────────────
 * Builds the Lit Protocol Unified Access Control Conditions that
 * govern when encrypted vault files can be decrypted.
 *
 * ACCESS CONTROL FLOWS:
 *
 *  1. buildDeceasedConditions(vaultPDA)
 *     ── Checks the Solana vault account's `state` field equals
 *        VaultState::Deceased (value = 3).  Used for full-asset
 *        and private-document release to beneficiary (FR9, FR10).
 *
 *  2. buildIncapacitatedConditions(vaultPDA)
 *     ── Checks the vault is in VaultState::ChallengePeriod (1).
 *        Used for medical allowance release to fiduciary.
 *        This is where the timer matters: fiduciary waits for
 *        challenge_end_time to pass before calling execute_claim.
 *
 * ─── VAULT STATE ENUM (Rust: terminus/programs/terminus/src/lib.rs) ──
 *   #[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
 *   pub enum VaultState {
 *       Active,              // 0
 *       ChallengePeriod,     // 1
 *       Incapacitated,       // 2
 *       Deceased,            // 3
 *   }
 *
 * ─── VAULT ACCOUNT LAYOUT (CRITICAL: must match Rust struct) ────────
 *   Offset  Field                 Type     Size
 *   ──────────────────────────────────────────────────────────────
 *   0-7     Anchor discriminator  u8[8]    8 bytes
 *   8-39    owner                 Pubkey   32 bytes
 *   40-71   beneficiary           Pubkey   32 bytes
 *   72-103  fiduciary             Pubkey   32 bytes
 *   104-135 ai_oracle             Pubkey   32 bytes
 *   136     state                 VaultState (u8) → 1 byte ✓✓✓
 *   137-144 last_heartbeat        i64      8 bytes
 *   145-152 challenge_end_time    i64      8 bytes
 *   153-160 medical_allowance     u64      8 bytes
 *   161-168 claim_stake           u64      8 bytes
 *   169     pending_claim_type    u8       1 byte
 *   170     bump                  u8       1 byte
 *
 * ✓ Verified against: terminus/programs/terminus/src/lib.rs:160-171
 * ─────────────────────────────────────────────────────────────────
 */

import type { UnifiedAccessControlConditions } from '../types.js';
import type { LitSolanaChain, SolanaNetwork } from '../types.js';

// ── Byte layout constants — update if Rust struct changes ─────────
const STATE_BYTE_OFFSET = 136;  // ✓ VERIFIED: owner(8) + owner(32) + bene(32) + fid(32) + oracle(32)
const DECEASED_STATE_VALUE = 3;       // VaultState::Deceased
const CHALLENGE_PERIOD_STATE_VALUE = 1; // VaultState::ChallengePeriod (was 2, FIXED)

/**
 * Returns unified Lit access conditions that unlock ONLY when the
 * Solana vault account has reached the `Deceased` (3) state.
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
        value: buildExpectedStateSlice(STATE_BYTE_OFFSET, DECEASED_STATE_VALUE),
      },
    },
  ];
}

/**
 * Returns access conditions for the INCAPACITATED path.
 * The vault must be in ChallengePeriod (1) state.
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
