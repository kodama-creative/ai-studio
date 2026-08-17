import type { SkillsManager } from "@llm-space/runtime/skills";
import { ContainerModule, inject, injectable } from "inversify";

import {
  SKILLS_RPC,
  type SkillsRequests,
  type SkillsRpc,
} from "../../shared/skills-rpc";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";

export const SKILLS_MANAGER = Symbol("SkillsManager");

/** Owns Skill discovery and settings RPC for one native window. */
@injectable()
class SkillsRpcContribution implements RpcContributionApi {
  constructor(
    @inject(SKILLS_MANAGER) private readonly _skills: SkillsManager
  ) {}

  registerRpc(rpc: RpcRegistry): void {
    const requests: SkillsRequests = {
      getSettings: () => Promise.resolve(this._skills.getConfig()),
      addPath: (path) => Promise.resolve(this._skills.addPath(path)),
      removePath: (path) => Promise.resolve(this._skills.removePath(path)),
      setHidden: ({ path, skillName, hidden }) =>
        Promise.resolve(
          this._skills.setSkillHidden(path, skillName, hidden)
        ),
      setAllHidden: (path, hidden) =>
        Promise.resolve(this._skills.setAllSkillsHidden(path, hidden)),
      listAvailable: () => Promise.resolve(this._skills.listAvailableSkills()),
      list: (path) => Promise.resolve(this._skills.listSkills(path)),
      read: (path) => Promise.resolve(this._skills.readSkill(path)),
    };
    rpc.registerServer({
      namespace: SKILLS_RPC,
      requests,
      streams: {},
    } satisfies import("../../shared/namespaced-rpc").RpcServer<SkillsRpc>);
  }
}

/** Bind Skill discovery and settings RPC as one window contribution. */
export function skillsRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(SkillsRpcContribution).toSelf().inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(SkillsRpcContribution);
  });
}
