import type { HarnessPrincipal } from "../session/harness-principal";
import type { ChannelAddress } from "../shared/channel-address";

export interface SessionAccessRequest extends ChannelAddress {
  readonly action: "receive";
  readonly principal: HarnessPrincipal | null;
  readonly sessionId?: string;
}

export interface SessionAccessPolicy {
  authorize(request: SessionAccessRequest): boolean | Promise<boolean>;
}
