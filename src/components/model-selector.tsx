"use client";

import { Check, ChevronDown } from "lucide-react";
import * as React from "react";
import type { PublicModel, ReasoningEffort } from "@/lib/models";
import { providerOrder } from "@/lib/models";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ModelSelector({
  models,
  value,
  onModelChange,
  reasoningEffort,
  onReasoningChange,
  disabled,
  disabledModelIds = [],
  disabledReason = "当前素材与该模型能力不兼容",
  className,
}: {
  models: PublicModel[];
  value: string;
  onModelChange: (model: PublicModel) => void;
  reasoningEffort?: ReasoningEffort;
  onReasoningChange?: (effort: ReasoningEffort) => void;
  disabled?: boolean;
  disabledModelIds?: string[];
  disabledReason?: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const selected = models.find((model) => model.id === value) ?? models[0];
  if (!selected) return null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className={cn(
            "ai-model-btn max-w-[260px] gap-1.5 border-zinc-200 bg-white px-2.5 text-zinc-600 shadow-none hover:bg-zinc-50",
            className,
          )}
        >
          <span className="truncate">{selected.displayName}</span>
          {reasoningEffort && (
            <span className="shrink-0 text-zinc-400">
              {reasoningEffort.charAt(0).toUpperCase() + reasoningEffort.slice(1)}
            </span>
          )}
          <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-180")} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="top"
        sideOffset={8}
        className="max-h-[min(420px,var(--radix-dropdown-menu-content-available-height))] min-w-64 overflow-y-auto rounded-2xl p-1"
      >
        {providerOrder.map((provider) => {
          const providerModels = models.filter((model) => model.provider === provider);
          if (providerModels.length === 0) return null;
          return (
            <React.Fragment key={provider}>
              <div className="px-3 py-0.5 text-xs font-medium leading-4 text-zinc-400">
                {providerModels[0].providerLabel}
              </div>
              {providerModels.map((model) => {
                const modelDisabled = disabledModelIds.includes(model.id);
                return (
                  <DropdownMenuItem
                    key={model.id}
                    disabled={modelDisabled}
                    title={modelDisabled ? disabledReason : undefined}
                    onSelect={() => onModelChange(model)}
                    className="h-7 justify-between py-0 text-[15px]"
                  >
                    <span>{model.displayName}</span>
                    {model.id === selected.id && <Check className="size-4" />}
                  </DropdownMenuItem>
                );
              })}
            </React.Fragment>
          );
        })}

        {reasoningEffort && onReasoningChange && (
          <>
            <DropdownMenuSeparator className="my-1" />
            <div className="px-3 py-0.5 text-xs font-medium leading-4 text-zinc-400">推理</div>
            {selected.reasoningEfforts.map((effort) => (
              <DropdownMenuItem
                key={effort}
                disabled={selected.reasoningEfforts.length === 1}
                onSelect={() => onReasoningChange(effort)}
                className="h-7 justify-between py-0 capitalize text-[15px]"
              >
                <span>{effort}</span>
                {effort === reasoningEffort && <Check className="size-4" />}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
