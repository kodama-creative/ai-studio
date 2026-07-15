import { AlertCircleIcon, SaveIcon } from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { CodeEditor } from "@/components/code-editor";
import { electrobun } from "@/lib/electrobun";
import { cn } from "@/lib/utils";

const _SourceTabPane = function SourceTabPane({
  path,
  active,
  refreshNonce
}: {
  readonly active: boolean;
  readonly path: string;
  readonly refreshNonce: number;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void electrobun.rpc?.request
      .fsReadText({ path })
      .then(({ text }) => {
        if (!cancelled) { setValue(text); }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path, refreshNonce]);

  const save = useCallback(
    async (next: string) => {
      setValue(next);
      setSaving(true);
      try {
        await electrobun.rpc?.request.fsWriteText({ path, text: next });
      } catch (cause) {
        toast.error("Unable to save source file", {
          description: cause instanceof Error ? cause.message : String(cause)
        });
      } finally {
        setSaving(false);
      }
    },
    [path]
  );

  return (
    <section
      aria-hidden={!active}
      className={cn("absolute inset-0 flex flex-col", !active && "hidden")}
    >
      <header className="border-border/70 flex h-10 shrink-0 items-center justify-between border-b px-4 text-xs">
        <span className="text-muted-foreground truncate font-mono">{path}</span>
        <span className="text-muted-foreground flex items-center gap-1">
          {saving ? <SaveIcon className="size-3" /> : null}
          {saving ? "Saving" : "Saved"}
        </span>
      </header>
      {error
        ? (
          <div className="text-destructive flex flex-1 items-center justify-center gap-2 p-6 text-sm">
            <AlertCircleIcon className="size-4" />
            {error}
          </div>
        )
        : (
          <CodeEditor
            className="min-h-0 flex-1 rounded-none border-0"
            hideBorder
            language={path.endsWith(".md") ? "markdown" : undefined}
            onChange={next => void save(next)}
            value={value}
          />
        )}
    </section>
  );
};

export const SourceTabPane = memo(_SourceTabPane);
