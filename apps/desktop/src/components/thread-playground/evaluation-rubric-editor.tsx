import { uuid } from "@llm-space/core";
import {
  type EvaluationCriterion,
  type EvaluationRubricInput,
  type EvaluationRubricRecord,
  MAX_CRITERION_DESCRIPTION_LENGTH,
  MAX_CRITERION_NAME_LENGTH,
  MAX_RUBRIC_CRITERIA,
  MAX_RUBRIC_NAME_LENGTH,
  MIN_RUBRIC_CRITERIA
} from "@llm-space/core/thread";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  PlusIcon,
  Trash2Icon
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "../confirm-dialog";
import { Tooltip } from "../tooltip";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

function _emptyCriterion(): EvaluationCriterion {
  return { id: uuid(), name: "" };
}

function _initialCriteria(
  rubric: EvaluationRubricRecord | null
): EvaluationCriterion[] {
  return rubric
    ? rubric.criteria.map(criterion => ({ ...criterion }))
    : [_emptyCriterion(), _emptyCriterion()];
}

export function EvaluationRubricEditor({
  rubric,
  onBack,
  onSave,
  onRemove,
  onSaved
}: {
  readonly onBack: () => void;
  readonly onRemove: (id: string) => boolean;
  readonly onSave: (input: EvaluationRubricInput) => EvaluationRubricRecord | null;
  readonly onSaved: (rubric: EvaluationRubricRecord) => void;
  readonly rubric: EvaluationRubricRecord | null;
}) {
  const [name, setName] = useState(rubric?.name ?? "");
  const [criteria, setCriteria] = useState(() => _initialCriteria(rubric));
  const [removeOpen, setRemoveOpen] = useState(false);
  const normalizedNames = useMemo(
    () =>
      criteria.map(criterion => criterion.name.trim().toLowerCase()),
    [criteria]
  );
  const duplicateNames = useMemo(() => {
    const seen = new Set<string>();
    return new Set(
      normalizedNames.filter(value => {
        if (!value || !seen.has(value)) {
          if (value) { seen.add(value); }
          return false;
        }
        return true;
      })
    );
  }, [normalizedNames]);
  const valid =
    Boolean(name.trim())
    && criteria.length >= MIN_RUBRIC_CRITERIA
    && criteria.length <= MAX_RUBRIC_CRITERIA
    && normalizedNames.every(Boolean)
    && duplicateNames.size === 0;

  const updateCriterion = (
    id: string,
    partial: Partial<EvaluationCriterion>
  ) => {
    setCriteria(current =>
      current.map(criterion =>
        (criterion.id === id ? { ...criterion, ...partial } : criterion)));
  };

  const moveCriterion = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= criteria.length) {
      return;
    }
    setCriteria(current => {
      const next = [...current];
      const [criterion] = next.splice(index, 1);
      if (!criterion) {
        return current;
      }
      next.splice(target, 0, criterion);
      return next;
    });
  };

  const handleSave = () => {
    if (!valid) {
      return;
    }
    const saved = onSave({
      ...(rubric ? { id: rubric.id } : {}),
      name: name.trim(),
      criteria: criteria.map(criterion => ({
        id: criterion.id,
        name: criterion.name.trim(),
        ...(criterion.description?.trim()
          ? { description: criterion.description.trim() }
          : {})
      }))
    });
    if (!saved) {
      toast.error("Unable to save rubric", {
        description: "Check the rubric fields or the thread rubric limit."
      });
      return;
    }
    onSaved(saved);
  };

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="text-xs font-medium">Rubric name</span>
            <Input
              autoFocus
              maxLength={MAX_RUBRIC_NAME_LENGTH}
              onChange={event => { setName(event.currentTarget.value); }}
              placeholder="Answer quality"
              value={name}
            />
          </label>

          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-medium">Criteria</div>
              <div className="text-muted-foreground text-[0.625rem]">
                Use 2–6 dimensions. Every score uses 1 = poor and 5 = excellent.
              </div>
            </div>
            <Button
              disabled={criteria.length >= MAX_RUBRIC_CRITERIA}
              onClick={() => { setCriteria(current => [...current, _emptyCriterion()]); }}
              size="sm"
              variant="outline"
            >
              <PlusIcon className="size-3" />
              Add criterion
            </Button>
          </div>

          <div className="flex flex-col gap-3">
            {criteria.map((criterion, index) => {
              const normalizedName = normalizedNames[index] ?? "";
              const duplicate = duplicateNames.has(normalizedName);
              return (
                <section
                  className="bg-muted/20 rounded-lg border p-3"
                  key={criterion.id}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1 space-y-2">
                      <label className="flex flex-col gap-1">
                        <span className="text-muted-foreground text-[0.625rem]">
                          Criterion {index + 1}
                        </span>
                        <Input
                          aria-invalid={duplicate || !criterion.name.trim()}
                          maxLength={MAX_CRITERION_NAME_LENGTH}
                          onChange={event => {
                            updateCriterion(criterion.id, {
                              name: event.currentTarget.value
                            });
                          }}
                          placeholder="Correctness"
                          value={criterion.name}
                        />
                        {duplicate
                          ? (
                            <span className="text-destructive text-[0.625rem]">
                              Criterion names must be unique.
                            </span>
                          )
                          : null}
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-muted-foreground text-[0.625rem]">
                          Description (optional)
                        </span>
                        <Textarea
                          className="min-h-16 resize-y text-xs"
                          maxLength={MAX_CRITERION_DESCRIPTION_LENGTH}
                          onChange={event => {
                            updateCriterion(criterion.id, {
                              description: event.currentTarget.value
                            });
                          }}
                          placeholder="What should a reviewer look for?"
                          value={criterion.description ?? ""}
                        />
                      </label>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      <Tooltip content="Move criterion up">
                        <Button
                          aria-label={`Move ${criterion.name || `criterion ${index + 1}`} up`}
                          disabled={index === 0}
                          onClick={() => { moveCriterion(index, -1); }}
                          size="icon-sm"
                          variant="ghost"
                        >
                          <ArrowUpIcon className="size-3" />
                        </Button>
                      </Tooltip>
                      <Tooltip content="Move criterion down">
                        <Button
                          aria-label={`Move ${criterion.name || `criterion ${index + 1}`} down`}
                          disabled={index === criteria.length - 1}
                          onClick={() => { moveCriterion(index, 1); }}
                          size="icon-sm"
                          variant="ghost"
                        >
                          <ArrowDownIcon className="size-3" />
                        </Button>
                      </Tooltip>
                      <Tooltip content="Remove criterion">
                        <Button
                          aria-label={`Remove ${criterion.name || `criterion ${index + 1}`}`}
                          className="hover:text-destructive"
                          disabled={criteria.length <= MIN_RUBRIC_CRITERIA}
                          onClick={() => {
                            setCriteria(current =>
                              current.filter(
                                value => value.id !== criterion.id
                              ));
                          }}
                          size="icon-sm"
                          variant="ghost"
                        >
                          <Trash2Icon className="size-3" />
                        </Button>
                      </Tooltip>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t px-4 py-3">
        <div>
          {rubric
            ? (
              <Button
                className="hover:text-destructive"
                onClick={() => { setRemoveOpen(true); }}
                variant="ghost"
              >
                <Trash2Icon className="size-3" />
                Delete rubric
              </Button>
            )
            : null}
        </div>
        <div className="flex gap-2">
          <Button onClick={onBack} variant="ghost">
            <ArrowLeftIcon className="size-3" />
            Back
          </Button>
          <Button disabled={!valid} onClick={handleSave}>
            {rubric ? "Save rubric" : "Create rubric"}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        confirmLabel="Delete"
        description="The reusable definition will be removed. Saved evaluations keep their immutable rubric snapshots and scores."
        dimBackground={false}
        onConfirm={() => {
          setRemoveOpen(false);
          if (rubric && onRemove(rubric.id)) {
            onBack();
          }
        }}
        onOpenChange={setRemoveOpen}
        open={removeOpen}
        title="Delete rubric?"
      />
    </>
  );
}
