import type { SkillsManager } from "@llm-space/runtime/skills";
import { ContainerModule } from "inversify";

import type { RpcServer } from "../../shared/namespaced-rpc";
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
import { desktopToken } from "../di/tokens";

export const SKILLS_MANAGER = desktopToken<SkillsManager>("skills", "manager");

class SkillsRpcServer implements RpcServer<SkillsRpc> {
  readonly namespace = SKILLS_RPC;
  readonly streams = {};
  readonly requests: SkillsRequests;

  constructor(skills: SkillsManager) {
    this.requests = {
      getSettings: () => Promise.resolve(skills.getConfig()),
      addPath: (path) => Promise.resolve(skills.addPath(path)),
      removePath: (path) => Promise.resolve(skills.removePath(path)),
      setHidden: ({ path, skillName, hidden }) =>
        Promise.resolve(skills.setSkillHidden(path, skillName, hidden)),
      setAllHidden: (path, hidden) =>
        Promise.resolve(skills.setAllSkillsHidden(path, hidden)),
      listAvailable: () => Promise.resolve(skills.listAvailableSkills()),
      list: (path) => Promise.resolve(skills.listSkills(path)),
      read: (path) => Promise.resolve(skills.readSkill(path)),
    };
  }
}

/** Owns Skill discovery and settings RPC for one native window. */
class SkillsRpcContribution implements RpcContributionApi {
  constructor(private readonly _skills: SkillsManager) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new SkillsRpcServer(this._skills));
  }
}

/** Bind Skill discovery and settings RPC as one window contribution. */
export function skillsRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(SkillsRpcContribution)
      .toDynamicValue(
        (context) =>
          new SkillsRpcContribution(
            context.get<SkillsManager>(SKILLS_MANAGER)
          )
      )
      .inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(SkillsRpcContribution);
  });
}
