import {
  AUXILIARY_GENERATION_RPC,
  type AuxiliaryGenerationRpc,
} from "../../shared/auxiliary-generation-rpc";
import type { RpcServer } from "../../shared/namespaced-rpc";
import type { AuxiliaryGenerationApplication } from "../application/auxiliary-generation-application";

/** Typed Desktop RPC adapter for stateless UI helper generation. */
export class AuxiliaryGenerationRpcServer
  implements RpcServer<AuxiliaryGenerationRpc>
{
  readonly namespace = AUXILIARY_GENERATION_RPC;
  readonly requests = {};
  readonly streams: AuxiliaryGenerationRpc["streams"];

  constructor(application: AuxiliaryGenerationApplication) {
    this.streams = application;
  }
}
