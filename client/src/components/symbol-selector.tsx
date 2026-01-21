import { useSymbol } from "@/lib/symbol-context";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, ChevronsUpDown, TrendingUp, Plus, Loader2, Sparkles, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";

interface DetectedSymbol {
  symbol: string;
  displayName: string;
  category: string;
  currency: string;
  aiDetected: boolean;
  message?: string;
}

export function SymbolSelector() {
  const { currentSymbol, setCurrentSymbol, supportedSymbols } = useSymbol();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [symbolInput, setSymbolInput] = useState("");
  const [detectedInfo, setDetectedInfo] = useState<DetectedSymbol | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editedDisplayName, setEditedDisplayName] = useState("");
  const [editedCategory, setEditedCategory] = useState("");
  const [editedCurrency, setEditedCurrency] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Detect symbol info using AI
  const detectMutation = useMutation({
    mutationFn: async (symbolName: string) => {
      const response = await apiRequest("POST", "/api/market/symbols/detect", { symbolName });
      return response.json();
    },
    onSuccess: (data: DetectedSymbol) => {
      setDetectedInfo(data);
      setEditedDisplayName(data.displayName);
      setEditedCategory(data.category);
      setEditedCurrency(data.currency);
      setEditMode(false);
    },
    onError: (error: any) => {
      toast({
        title: "Detection failed",
        description: error.message || "Could not detect symbol information",
        variant: "destructive",
      });
    },
  });

  // Add symbol to the system
  const addMutation = useMutation({
    mutationFn: async (symbolData: { symbol: string; displayName: string; category: string; currency: string }) => {
      const response = await apiRequest("POST", "/api/market/symbols", symbolData);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Symbol added",
        description: `${detectedInfo?.symbol} has been added to your watchlist`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/market/symbols"] });
      handleCloseAddDialog();
    },
    onError: (error: any) => {
      toast({
        title: "Failed to add symbol",
        description: error.message || "Could not add symbol to the system",
        variant: "destructive",
      });
    },
  });

  const handleDetect = () => {
    if (symbolInput.trim()) {
      detectMutation.mutate(symbolInput.trim());
    }
  };

  const handleAddSymbol = () => {
    if (detectedInfo) {
      addMutation.mutate({
        symbol: detectedInfo.symbol,
        displayName: editMode ? editedDisplayName : detectedInfo.displayName,
        category: editMode ? editedCategory : detectedInfo.category,
        currency: editMode ? editedCurrency : detectedInfo.currency,
      });
    }
  };

  const handleCloseAddDialog = () => {
    setAddDialogOpen(false);
    setSymbolInput("");
    setDetectedInfo(null);
    setEditMode(false);
  };

  const handleOpenAddDialog = () => {
    setOpen(false);
    setAddDialogOpen(true);
  };

  return (
    <>
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
                    <div className="flex flex-1 items-center gap-2 min-w-0">
                      <span className="font-mono font-semibold shrink-0">{sym.symbol}</span>
                      <span className="text-xs text-muted-foreground truncate" title={sym.name}>
                        {sym.name.length > 25 ? sym.name.substring(0, 25) + "..." : sym.name}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
              {user && (
                <>
                  <CommandSeparator />
                  <CommandGroup>
                    <CommandItem
                      onSelect={handleOpenAddDialog}
                      className="text-primary"
                      data-testid="button-add-symbol"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      <span className="font-medium">Add New Symbol</span>
                    </CommandItem>
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Add Symbol Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Add New Symbol
            </DialogTitle>
            <DialogDescription>
              Enter a symbol name and we'll automatically detect its details using AI.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Symbol Input */}
            <div className="flex gap-2">
              <div className="flex-1">
                <Label htmlFor="symbol-input" className="sr-only">Symbol</Label>
                <Input
                  id="symbol-input"
                  placeholder="e.g., AAPL, BBCA, BTC, XAU"
                  value={symbolInput}
                  onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === "Enter" && handleDetect()}
                  data-testid="input-add-symbol"
                />
              </div>
              <Button 
                onClick={handleDetect} 
                disabled={!symbolInput.trim() || detectMutation.isPending}
                data-testid="button-detect-symbol"
              >
                {detectMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Sparkles className="mr-1 h-4 w-4" />
                    Detect
                  </>
                )}
              </Button>
            </div>

            {/* Detected Info Display */}
            {detectedInfo && (
              <div className="rounded-lg border bg-muted/50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {detectedInfo.aiDetected ? (
                      <Sparkles className="h-4 w-4 text-primary" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="text-xs text-muted-foreground">
                      {detectedInfo.aiDetected ? "AI Detected" : "Pattern Matched"}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditMode(!editMode)}
                    data-testid="button-edit-detected"
                  >
                    {editMode ? "Done" : "Edit"}
                  </Button>
                </div>

                {editMode ? (
                  <div className="space-y-3">
                    <div>
                      <Label htmlFor="edit-name" className="text-xs">Display Name</Label>
                      <Input
                        id="edit-name"
                        value={editedDisplayName}
                        onChange={(e) => setEditedDisplayName(e.target.value)}
                        className="mt-1"
                        data-testid="input-edit-displayname"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label htmlFor="edit-category" className="text-xs">Category</Label>
                        <Input
                          id="edit-category"
                          value={editedCategory}
                          onChange={(e) => setEditedCategory(e.target.value)}
                          className="mt-1"
                          data-testid="input-edit-category"
                        />
                      </div>
                      <div>
                        <Label htmlFor="edit-currency" className="text-xs">Currency</Label>
                        <Input
                          id="edit-currency"
                          value={editedCurrency}
                          onChange={(e) => setEditedCurrency(e.target.value.toUpperCase())}
                          className="mt-1"
                          data-testid="input-edit-currency"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Symbol:</span>
                      <span className="font-mono font-semibold">{detectedInfo.symbol}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Name:</span>
                      <span className="text-sm font-medium">{detectedInfo.displayName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Category:</span>
                      <span className="text-sm capitalize">{detectedInfo.category}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Currency:</span>
                      <span className="text-sm">{detectedInfo.currency}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={handleCloseAddDialog} data-testid="button-cancel-add">
              Cancel
            </Button>
            <Button 
              onClick={handleAddSymbol} 
              disabled={!detectedInfo || addMutation.isPending}
              data-testid="button-confirm-add"
            >
              {addMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Add Symbol
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
