export class AgentStateCommitUnknownError extends Error {
  constructor(cause: unknown) {
    super(
      "Tools completed but Session state could not be persisted; the Runtime Run outcome is unknown",
      { cause }
    );
    this.name = "AgentStateCommitUnknownError";
  }
}
