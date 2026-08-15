import type { SkillsManager } from "@llm-space/runtime/skills";

import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  SKILLS_RPC,
  type SkillsRequests,
  type SkillsRpc,
} from "../../shared/skills-rpc";
import type { RpcContribution } from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";

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
export class SkillsRpcContribution implements RpcContribution {
  constructor(private readonly _skills: SkillsManager) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new SkillsRpcServer(this._skills));
  }
}
