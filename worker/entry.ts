import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "./env";
import {
  deudaAhorroPatrimonio as deudaAhorroPatrimonioRpc,
  resumenMensual as resumenMensualRpc,
  ultimosMovimientos as ultimosMovimientosRpc,
} from "./mcp-rpc";

export { default } from "./index";

/**
 * Service binding for lulox-mcp. Not mounted on HTTP.
 * The binding is the trust boundary: these methods do not read a bearer token.
 */
export class McpRpc extends WorkerEntrypoint<Env> {
  resumenMensual(input: unknown) {
    return resumenMensualRpc(this.env, input);
  }

  deudaAhorroPatrimonio(input: unknown) {
    return deudaAhorroPatrimonioRpc(this.env, input);
  }

  ultimosMovimientos(input: unknown) {
    return ultimosMovimientosRpc(this.env, input);
  }
}
