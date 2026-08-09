import type { ChannelAddress } from "../shared/channel-address";

import type {
  ChannelBinding,
  ChannelBindingClaim,
  ChannelBindingRepository,
} from "./channel-binding-repository";

export class InMemoryChannelBindingRepository implements ChannelBindingRepository {
  private readonly _bindings = new Map<string, ChannelBinding>();

  resolve(address: ChannelAddress): Promise<ChannelBinding | undefined> {
    const binding = this._bindings.get(_bindingKey(address));
    return Promise.resolve(
      binding === undefined ? undefined : structuredClone(binding)
    );
  }

  claim(binding: ChannelBinding): Promise<ChannelBindingClaim> {
    const key = _bindingKey(binding);
    const existing = this._bindings.get(key);
    if (existing !== undefined) {
      return Promise.resolve({
        status: "existing",
        binding: structuredClone(existing),
      });
    }
    this._bindings.set(key, structuredClone(binding));
    return Promise.resolve({
      status: "claimed",
      binding: structuredClone(binding),
    });
  }
}

function _bindingKey(address: ChannelAddress): string {
  return JSON.stringify([address.channelId, address.address]);
}
