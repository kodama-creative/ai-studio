import { ConfirmDialog } from "@/components/confirm-dialog";
import type { ExternalAgentProjectPreview } from "@/shared/external-agent-project";

export function ExternalAgentProjectTrustDialog({
  project,
  onOpenChange,
  onConfirm,
}: {
  project: ExternalAgentProjectPreview | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={project !== null}
      onOpenChange={onOpenChange}
      title="Trust this Agent Project?"
      description={
        project
          ? `Tools in “${project.name}” are local code and can access your computer with your user permissions. Only continue if you trust this directory: ${project.path}`
          : undefined
      }
      confirmLabel="Trust and open"
      onConfirm={onConfirm}
    />
  );
}
