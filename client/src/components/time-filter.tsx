import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TimeFilterProps {
  value: string;
  onChange: (value: string) => void;
  options?: { label: string; value: string }[];
  className?: string;
}

const defaultOptions = [
  { label: "1D", value: "1D" },
  { label: "1W", value: "1W" },
  { label: "1M", value: "1M" },
  { label: "3M", value: "3M" },
  { label: "6M", value: "6M" },
  { label: "1Y", value: "1Y" },
];

export function TimeFilter({
  value,
  onChange,
  options = defaultOptions,
  className,
}: TimeFilterProps) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {options.map((option) => (
        <Button
          key={option.value}
          variant={value === option.value ? "default" : "ghost"}
          size="sm"
          onClick={() => onChange(option.value)}
          className="text-xs font-medium"
          data-testid={`button-filter-${option.value.toLowerCase()}`}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
