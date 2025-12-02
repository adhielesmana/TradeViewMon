import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TimeframeSelectorProps {
  value: string;
  onChange: (value: string) => void;
}

const TIMEFRAMES = [
  { value: "1min", label: "1 Min" },
  { value: "5min", label: "5 Min" },
  { value: "15min", label: "15 Min" },
  { value: "all", label: "All" },
];

export function TimeframeSelector({ value, onChange }: TimeframeSelectorProps) {
  return (
    <div className="flex items-center gap-1 rounded-lg border bg-card p-1">
      {TIMEFRAMES.map((tf) => (
        <Button
          key={tf.value}
          variant="ghost"
          size="sm"
          onClick={() => onChange(tf.value)}
          data-testid={`button-timeframe-${tf.value}`}
          className={cn(
            "h-7 px-3 text-xs font-medium transition-colors",
            value === tf.value
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {tf.label}
        </Button>
      ))}
    </div>
  );
}
