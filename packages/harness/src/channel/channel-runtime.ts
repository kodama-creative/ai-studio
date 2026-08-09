import { KeyedOperationCoordinator } from "../internal/keyed-operation-coordinator";
import type { AgentSession, PreparedAgent } from "../runtime/harness";

import { ChannelAccessDeniedError } from "./channel-access-denied-error";
import type {
  ChannelBinding,
  ChannelBindingRepository,
} from "./channel-binding-repository";
import type { ChannelEnvelope } from "./channel-envelope";
import type { ChannelReceiveReceipt } from "./channel-receive-receipt";
import type { SessionAccessPolicy } from "./session-access-policy";

export interface CreateChannelRuntimeOptions {
  readonly agent: PreparedAgent;
  readonly accessPolicy: SessionAccessPolicy;
  readonly bindings: ChannelBindingRepository;
  readonly clock?: () => number;
  readonly generateId?: (prefix: string) => string;
}

export interface ChannelRuntime {
  receive(envelope: ChannelEnvelope): Promise<ChannelReceiveReceipt>;
}

class ChannelRuntimeImpl implements ChannelRuntime {
  private readonly _operations = new KeyedOperationCoordinator();
  private readonly _bindings: ChannelBindingRepository;
  private readonly _clock: () => number;
  private readonly _generateId: (prefix: string) => string;

  constructor(private readonly _options: CreateChannelRuntimeOptions) {
    this._bindings = _options.bindings;
    this._clock = _options.clock ?? Date.now;
    this._generateId =
      _options.generateId ??
      ((prefix) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`);
  }

  receive(envelope: ChannelEnvelope): Promise<ChannelReceiveReceipt> {
    _validateEnvelope(envelope);
    const key = JSON.stringify([envelope.channelId, envelope.address]);
    return this._operations.run(key, () => this._receive(envelope));
  }

  private async _receive(
    envelope: ChannelEnvelope
  ): Promise<ChannelReceiveReceipt> {
    let binding = await this._bindings.resolve(envelope);
    await this._authorize(envelope, binding?.sessionId);

    let session: AgentSession | undefined;
    let bindingCreated = false;
    if (binding === undefined) {
      const candidate: ChannelBinding = {
        channelId: envelope.channelId,
        address: envelope.address,
        sessionId: this._generateId("session"),
        initiator: structuredClone(envelope.principal),
        createdAt: this._clock(),
      };
      const claim = await this._bindings.claim(candidate);
      binding = claim.binding;
      if (claim.status === "claimed") {
        bindingCreated = true;
        try {
          session = await this._options.agent.createSession({
            id: binding.sessionId,
            initiator: binding.initiator,
          });
        } catch (error) {
          session = await this._options.agent.attachSession(binding.sessionId);
          if (session === undefined) throw error;
        }
      } else {
        await this._authorize(envelope, binding.sessionId);
      }
    }

    session ??= await this._options.agent.attachSession(binding.sessionId);
    if (session === undefined) {
      try {
        session = await this._options.agent.createSession({
          id: binding.sessionId,
          initiator: binding.initiator,
        });
      } catch (error) {
        session = await this._options.agent.attachSession(binding.sessionId);
        if (session === undefined) throw error;
      }
    }
    const receipt = await session.submit({
      message: envelope.message,
      principal: envelope.principal,
      source: {
        channelId: envelope.channelId,
        address: envelope.address,
        deliveryId: envelope.deliveryId,
      },
    });
    return {
      ...receipt,
      channelId: envelope.channelId,
      address: envelope.address,
      bindingCreated,
    };
  }

  private async _authorize(
    envelope: ChannelEnvelope,
    sessionId: string | undefined
  ): Promise<void> {
    const allowed = await this._options.accessPolicy.authorize({
      action: "receive",
      channelId: envelope.channelId,
      address: envelope.address,
      principal: envelope.principal,
      ...(sessionId === undefined ? {} : { sessionId }),
    });
    if (!allowed) {
      throw new ChannelAccessDeniedError(envelope);
    }
  }
}

export function createChannelRuntime(
  options: CreateChannelRuntimeOptions
): ChannelRuntime {
  return new ChannelRuntimeImpl(options);
}

function _validateEnvelope(envelope: ChannelEnvelope): void {
  for (const [name, value] of [
    ["channelId", envelope.channelId],
    ["address", envelope.address],
    ["deliveryId", envelope.deliveryId],
    ["message", envelope.message],
  ] as const) {
    if (value.trim().length === 0) {
      throw new Error(`Channel envelope ${name} must not be empty.`);
    }
  }
}
