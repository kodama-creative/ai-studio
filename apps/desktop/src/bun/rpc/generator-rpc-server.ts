import {
  GENERATOR_RPC,
  type GeneratorRpc,
} from "../../shared/generator-rpc";
import type { RpcServer } from "../../shared/namespaced-rpc";
import type { ProjectGeneratorApplicationApi } from "../application/project-generator-application";

/** Typed transport adapter for generated-project orchestration. */
export class GeneratorRpcServer implements RpcServer<GeneratorRpc> {
  readonly namespace = GENERATOR_RPC;
  readonly streams = {};

  constructor(readonly requests: ProjectGeneratorApplicationApi) {}
}
