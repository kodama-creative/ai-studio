import { ConfirmDialog } from "@/components/confirm-dialog";

import type { ExternalAgentProjectPreview } from "@/shared/external-agent-project";

export function ExternalAgentProjectTrustDialog({
  project,
  onOpenChange,
  onConfirm
}: {
  readonly onConfirm: () => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly project: ExternalAgentProjectPreview | null;
}) {
  return (
    <ConfirmDialog
      confirmLabel="Trust and open"
      description={
        project
          ? `Tools in “${project.name}” are local code and can access your computer with your user permissions. Only continue if you trust this directory: ${project.path}`
          : undefined
      }
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      open={project !== null}
      title="Trust this Agent Project?"
    />
  );
}
