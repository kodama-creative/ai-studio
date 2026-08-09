import type { HarnessPrincipal } from "../session/harness-principal";
import type { ChannelAddress } from "../shared/channel-address";

export interface ChannelBinding extends ChannelAddress {
  readonly sessionId: string;
  readonly initiator: HarnessPrincipal | null;
  readonly createdAt: number;
}

export type ChannelBindingClaim =
  | { readonly status: "claimed"; readonly binding: ChannelBinding }
  | { readonly status: "existing"; readonly binding: ChannelBinding };

export interface ChannelBindingRepository {
  resolve(address: ChannelAddress): Promise<ChannelBinding | undefined>;
  claim(binding: ChannelBinding): Promise<ChannelBindingClaim>;
}
