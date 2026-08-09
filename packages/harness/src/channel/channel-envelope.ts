import type { HarnessPrincipal } from "../session/harness-principal";
import type { ChannelAddress } from "../shared/channel-address";

export interface ChannelEnvelope extends ChannelAddress {
  readonly deliveryId: string;
  readonly message: string;
  readonly principal: HarnessPrincipal | null;
}
