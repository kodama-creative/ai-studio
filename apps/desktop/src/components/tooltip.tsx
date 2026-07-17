import {
  TooltipContent,
  Tooltip as TooltipPrimitive,
  TooltipTrigger
} from "./ui/tooltip";

export function Tooltip({
  children,
  content
}: {
  readonly children: React.ReactNode;
  readonly content: React.ReactNode;
}) {
  return (
    <TooltipPrimitive delayDuration={800}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{content}</TooltipContent>
    </TooltipPrimitive>
  );
}
