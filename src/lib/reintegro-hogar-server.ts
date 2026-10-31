/**
 * Server-only payee config for hogar reintegros.
 * Never import this module from a client component. It reads REINTEGRO_PAYEES
 * from the server environment, and that value must not reach the client bundle.
 */
import { parseReintegroPayees } from "@/lib/reintegro-hogar";

/** Parsed roommate payee groups. Empty or unset config turns the feature off. */
export function reintegroPayeeGroups(): string[][] {
  return parseReintegroPayees(process.env.REINTEGRO_PAYEES);
}
