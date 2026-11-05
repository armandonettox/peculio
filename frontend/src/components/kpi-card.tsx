import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  icon: LucideIcon;
  iconClassName?: string;
  label: string;
  value: string;
  valueColor?: "default" | "destructive" | "positive";
  className?: string;
};

export function KpiCard({ icon: Icon, iconClassName, label, value, valueColor = "default", className }: Props) {
  return (
    <div className={cn("flex items-center gap-3 rounded-xl border bg-card p-4 shadow-sm", className)}>
      <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary", iconClassName)}>
        <Icon className="size-5" />
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn("truncate text-lg font-semibold tracking-tight",
          valueColor === "destructive" && "text-destructive",
          valueColor === "positive" && "text-green-600 dark:text-green-400"
        )}>
          {value}
        </p>
      </div>
    </div>
  );
}
