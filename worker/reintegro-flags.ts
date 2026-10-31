import {
  isHogarReintegroDescription,
  looksLikeHogarReintegroPayee,
  parseReintegroPayees,
} from "../src/lib/reintegro-hogar";

export type ReintegroRowFlags = {
  /** Outbound-prefix payee OR bare payee. */
  reintegroHogar: boolean;
  /** Outbound-prefix payee only (the "offer to apply reintegro" prompt). */
  reintegroPayee: boolean;
};

/**
 * Per-row flags from the Worker runtime payee config.
 * Empty or unset payees yield false/false.
 */
export function reintegroFlags(
  description: string,
  rawPayees: string | undefined | null,
): ReintegroRowFlags {
  const groups = parseReintegroPayees(rawPayees);
  return {
    reintegroHogar: isHogarReintegroDescription(description, groups),
    reintegroPayee: looksLikeHogarReintegroPayee(description, groups),
  };
}
