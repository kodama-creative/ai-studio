import { injectable } from "inversify";
import { toast } from "sonner";

/** Renderer-local notification capability injected into workflow Controllers. */
@injectable()
export class RendererNotificationService {
  success(message: string): void {
    toast.success(message);
  }

  error(title: string, error?: unknown): void {
    toast.error(title, {
      ...(error === undefined ? {} : { description: _message(error) }),
    });
  }
}

function _message(error: unknown): string {
  return error instanceof Error ? error.message : "Please try again.";
}
