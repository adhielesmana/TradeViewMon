import { useSymbol } from "@/lib/symbol-context";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Check, ChevronsUpDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

export function SymbolSelector() {
  const { currentSymbol, setCurrentSymbol, supportedSymbols } = useSymbol();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[180px] justify-between"
          data-testid="button-symbol-selector"
        >
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <span className="font-mono font-semibold">{currentSymbol.symbol}</span>
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search symbol..." data-testid="input-symbol-search" />
          <CommandList>
            <CommandEmpty>No symbol found.</CommandEmpty>
            <CommandGroup>
              {supportedSymbols.map((sym) => (
                <CommandItem
                  key={sym.symbol}
                  value={`${sym.symbol} ${sym.name}`}
                  onSelect={() => {
                    setCurrentSymbol(sym);
                    setOpen(false);
                  }}
                  data-testid={`option-symbol-${sym.symbol}`}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      currentSymbol.symbol === sym.symbol ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <div className="flex flex-1 items-center justify-between">
                    <span className="font-mono font-semibold">{sym.symbol}</span>
                    <span className="text-xs text-muted-foreground">{sym.name}</span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
