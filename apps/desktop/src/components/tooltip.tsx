import {
  Tooltip as _Tooltip,
  TooltipContent,
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
    <_Tooltip delayDuration={800}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{content}</TooltipContent>
    </_Tooltip>
  );
}
