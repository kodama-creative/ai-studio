import type {
  SkillContent,
  SkillInfo,
  SkillsSettings,
} from "@llm-space/core";

import { defineRpcNamespace } from "./namespaced-rpc";
import type { RequestRpcShape } from "./rpc-shape";

export interface SkillsRequests {
  getSettings(): Promise<SkillsSettings>;
  addPath(path: string): Promise<SkillsSettings>;
  removePath(path: string): Promise<SkillsSettings>;
  setHidden(input: {
    path: string;
    skillName: string;
    hidden: boolean;
  }): Promise<SkillsSettings>;
  setAllHidden(path: string, hidden: boolean): Promise<SkillsSettings>;
  listAvailable(): Promise<SkillInfo[]>;
  list(path: string): Promise<SkillInfo[]>;
  read(path: string): Promise<SkillContent>;
}

export type SkillsRpc = RequestRpcShape<SkillsRequests>;

export const SKILLS_RPC = defineRpcNamespace<SkillsRpc>("skills", {
  requests: {
    getSettings: true,
    addPath: true,
    removePath: true,
    setHidden: true,
    setAllHidden: true,
    listAvailable: true,
    list: true,
    read: true,
  },
  streams: {},
  events: {},
});
