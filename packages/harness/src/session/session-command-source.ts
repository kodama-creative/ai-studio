import type { ChannelAddress } from "../shared/channel-address";

export interface SessionCommandSource extends ChannelAddress {
  readonly deliveryId?: string;
}
