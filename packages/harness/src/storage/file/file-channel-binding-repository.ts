import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  ChannelBinding,
  ChannelBindingClaim,
  ChannelBindingRepository,
} from "../../channel/channel-binding-repository";
import type { ChannelAddress } from "../../shared/channel-address";

import { encodeSessionStorageKey } from "./encode-session-storage-key";
import { getFileErrorCode } from "./get-file-error-code";
import { isStoredChannelBinding } from "./stored-channel-binding";

export class FileChannelBindingRepository implements ChannelBindingRepository {
  constructor(private readonly _root: string) {}

  async resolve(address: ChannelAddress): Promise<ChannelBinding | undefined> {
    const path = this._bindingPath(address.channelId, address.address);
    try {
      const value: unknown = JSON.parse(await readFile(path, "utf8"));
      if (
        !isStoredChannelBinding(value) ||
        value.channelId !== address.channelId ||
        value.address !== address.address
      ) {
        throw new Error(`Invalid Channel binding in "${path}".`);
      }
      return value;
    } catch (error) {
      if (getFileErrorCode(error) === "ENOENT") return undefined;
      throw error;
    }
  }

  async claim(binding: ChannelBinding): Promise<ChannelBindingClaim> {
    const directory = this._channelRoot(binding.channelId);
    const destination = this._bindingPath(binding.channelId, binding.address);
    const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(temporary, `${JSON.stringify(binding, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      try {
        await link(temporary, destination);
        return { status: "claimed", binding: structuredClone(binding) };
      } catch (error) {
        if (getFileErrorCode(error) !== "EEXIST") throw error;
        const existing = await this.resolve(binding);
        if (existing === undefined) {
          throw new Error(
            `Channel binding "${binding.channelId}:${binding.address}" disappeared during claim.`,
            { cause: error }
          );
        }
        return { status: "existing", binding: existing };
      }
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private _bindingsRoot(): string {
    return join(this._root, "bindings");
  }

  private _channelRoot(channelId: string): string {
    return join(this._bindingsRoot(), encodeSessionStorageKey(channelId));
  }

  private _bindingPath(channelId: string, address: string): string {
    return join(
      this._channelRoot(channelId),
      `${encodeSessionStorageKey(address)}.json`
    );
  }
}
