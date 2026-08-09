import type { ChannelAddress } from "../shared/channel-address";

export class ChannelAccessDeniedError extends Error {
  constructor(address: ChannelAddress) {
    super(
      `Access to Channel "${address.channelId}" address "${address.address}" was denied.`
    );
    this.name = "ChannelAccessDeniedError";
  }
}
