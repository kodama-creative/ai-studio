import { type Static, Type } from "typebox";

export const SandboxAttachmentDescriptor = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String({
    minLength: 1,
    maxLength: 240,
    pattern: "^[^/\\\\\\x00-\\x1f\\x7f]+$"
  }),
  path: Type.String({
    pattern: "^/workspace/(?!(?:\\.\\.?)(?:/|$))(?!.*(?:/\\.\\.?)(?:/|$))[^/\\\\\\x00-\\x1f\\x7f]+(?:/[^/\\\\\\x00-\\x1f\\x7f]+)*$"
  }),
  size: Type.Integer({ minimum: 0, maximum: 25 * 1024 * 1024 }),
  fingerprint: Type.String({ pattern: "^[0-9a-f]{64}$" }),
  mimeType: Type.Optional(Type.String())
});
export type SandboxAttachmentDescriptor = Static<
  typeof SandboxAttachmentDescriptor
>;

export const ThreadSandboxAttachments = Type.Record(
  Type.String({ minLength: 1 }),
  Type.Array(SandboxAttachmentDescriptor, { maxItems: 20 })
);
export type ThreadSandboxAttachments = Static<
  typeof ThreadSandboxAttachments
>;

export const LockedSandboxAttachmentMessageIds = Type.Array(
  Type.String({ minLength: 1 }),
  { uniqueItems: true }
);
export type LockedSandboxAttachmentMessageIds = Static<
  typeof LockedSandboxAttachmentMessageIds
>;

export function sameSandboxAttachmentDescriptor(
  left: SandboxAttachmentDescriptor,
  right: SandboxAttachmentDescriptor
): boolean {
  return left.id === right.id
    && left.name === right.name
    && left.path === right.path
    && left.size === right.size
    && left.fingerprint === right.fingerprint
    && left.mimeType === right.mimeType;
}

export function formatSandboxAttachmentsForPi(
  attachments: readonly SandboxAttachmentDescriptor[]
): string {
  return [
    "<attachments>",
    ...attachments.map(attachment =>
      `- ${attachment.name}: ${attachment.path}`),
    "</attachments>"
  ].join("\n");
}
