import type { SessionCommandReceipt } from "../session/session-command-receipt";
import type { ChannelAddress } from "../shared/channel-address";

export interface ChannelReceiveReceipt
  extends SessionCommandReceipt, ChannelAddress {
  readonly bindingCreated: boolean;
}
