import { CheckIcon, ChevronDownIcon, CopyIcon } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import type {
  ThreadStructuredOutput,
  ThreadStructuredOutputFailure
} from "@llm-space/core";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const FAILURE_LABELS: Record<ThreadStructuredOutputFailure["code"], string> = {
  structured_output_invalid: "The model returned data that did not match the schema.",
  structured_output_missing: "The model completed without submitting structured output.",
  structured_output_too_large: "The structured result exceeded the Host size limit."
};

function StructuredOutputCardImpl({
  className,
  failure,
  result
}: {
  readonly className?: string;
  readonly failure?: ThreadStructuredOutputFailure;
  readonly result?: ThreadStructuredOutput;
}) {
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);
  const value = useMemo(
    () => (result ? JSON.stringify(result.value, null, 2) : ""),
    [result]
  );
  const contract = result?.contract ?? failure?.contract ?? "unknown";
  const copy = useCallback(async () => {
    if (!result) { return; }
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => { setCopied(false); }, 1_500);
    } catch {
      toast.error("Failed to copy structured output");
    }
  }, [result, value]);

  return (
    <section
      aria-label={`Structured output ${contract}`}
      className={cn("overflow-hidden rounded-md border bg-background/60", className)}
    >
      <div className="flex min-h-9 items-center gap-2 px-3 py-1.5">
        <div className="min-w-0 grow">
          <div className="truncate text-xs font-medium">
            Structured output · {contract}
          </div>
          <div
            className="text-muted-foreground truncate font-mono text-[0.625rem]"
            title={result?.schemaFingerprint ?? failure?.schemaFingerprint}
          >
            {(result?.schemaFingerprint ?? failure?.schemaFingerprint)?.slice(0, 12)}
          </div>
        </div>
        {result
          ? (
            <Button
              aria-label="Copy structured output"
              onClick={() => void copy()}
              size="icon-sm"
              variant="ghost"
            >
              {copied
                ? <CheckIcon className="size-3" />
                : <CopyIcon className="size-3" />}
            </Button>
          )
          : null}
        <Button
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse structured output" : "Expand structured output"}
          onClick={() => { setExpanded(current => !current); }}
          size="icon-sm"
          variant="ghost"
        >
          <ChevronDownIcon
            className={cn("size-3 transition-transform", !expanded && "-rotate-90")}
          />
        </Button>
      </div>
      {expanded
        ? failure
          ? (
            <div className="text-destructive border-t px-3 py-2 text-xs" role="status">
              {FAILURE_LABELS[failure.code]}
            </div>
          )
          : (
            <pre className="max-h-72 overflow-auto border-t p-3 font-mono text-[0.6875rem] leading-relaxed">
              {value}
            </pre>
          )
        : null}
    </section>
  );
}

export const StructuredOutputCard = memo(StructuredOutputCardImpl);
