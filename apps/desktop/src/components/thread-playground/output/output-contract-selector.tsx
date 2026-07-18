import { ChevronDownIcon } from "lucide-react";
import { memo, useMemo } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { useThreadStore, useThreadStoreActions } from "../stores";

export interface OutputContractSummary {
  readonly description: string;
  readonly name: string;
  readonly schema: unknown;
  readonly schemaFingerprint: string;
}

function OutputContractSelectorImpl({
  disabled,
  outputs
}: {
  readonly disabled?: boolean;
  readonly outputs: readonly OutputContractSummary[];
}) {
  const selectedName = useThreadStore(state => state.thread.outputContract);
  const status = useThreadStore(state => state.status);
  const { updateOutputContract } = useThreadStoreActions();
  const selected = useMemo(
    () => outputs.find(output => output.name === selectedName),
    [outputs, selectedName]
  );
  const schemaJson = useMemo(
    () => (selected ? JSON.stringify(selected.schema, null, 2) : ""),
    [selected]
  );
  const locked = disabled || status === "running";

  return (
    <div className="flex min-w-0 grow items-center gap-2">
      <Select
        disabled={locked}
        onValueChange={value => {
          updateOutputContract(value === "__text__" ? undefined : value);
        }}
        value={selected?.name ?? "__text__"}
      >
        <SelectTrigger aria-label="Output contract" className="h-7 w-40 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__text__">Text</SelectItem>
          {outputs.map(output => (
            <SelectItem key={output.name} value={output.name}>
              {output.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selected
        ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                aria-label={`Inspect ${selected.name} output schema`}
                className="h-7 gap-1 px-2 text-xs"
                variant="ghost"
              >
                Schema <ChevronDownIcon className="size-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-96 p-0">
              <div className="border-b px-3 py-2">
                <div className="text-xs font-medium">{selected.name}</div>
                <div className="text-muted-foreground mt-0.5 text-[0.625rem]">
                  {selected.description}
                </div>
              </div>
              <pre className="max-h-72 overflow-auto p-3 font-mono text-[0.625rem] leading-relaxed">
                {schemaJson}
              </pre>
            </PopoverContent>
          </Popover>
        )
        : (
          <span className="text-muted-foreground truncate text-xs">
            Ordinary assistant text
          </span>
        )}
    </div>
  );
}

export const OutputContractSelector = memo(OutputContractSelectorImpl);
