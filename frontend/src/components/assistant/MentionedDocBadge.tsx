import { X, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

interface MentionedDocBadgeProps {
  title: string;
  content: string;
  onRemove: () => void;
}

export default function MentionedDocBadge({ title, content, onRemove }: MentionedDocBadgeProps) {
  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <Badge variant="secondary" className="gap-1 text-xs cursor-pointer">
          <FileText className="h-3 w-3" />
          <span className="max-w-[150px] truncate">{title}</span>
          <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="ml-1 hover:text-destructive">
            <X className="h-3 w-3" />
          </button>
        </Badge>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="start" className="w-80 max-h-60 overflow-y-auto p-3">
        <p className="font-medium text-sm mb-2">{title}</p>
        <p className="text-xs text-muted-foreground whitespace-pre-line line-clamp-[12]">
          {content.slice(0, 600)}{content.length > 600 ? "…" : ""}
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}
