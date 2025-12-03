import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { 
  TrendingUp, 
  TrendingDown, 
  Wallet, 
  ArrowUpCircle,
  ArrowDownCircle,
  Plus,
  Minus,
  Target,
  Clock,
  Brain,
  BarChart3,
  LineChart,
  DollarSign,
  Percent,
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  History,
  Globe
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { useSymbol } from "@/lib/symbol-context";
import { useWebSocket, type WSMessage } from "@/hooks/use-websocket";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { LineChart as RechartsLineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from "recharts";
import { Switch } from "@/components/ui/switch";
import type { DemoAccount, DemoPosition, DemoTransaction, DemoAccountStats, AutoTradeSetting } from "@shared/schema";

interface DemoAccountResponse {
  account: DemoAccount;
  stats: DemoAccountStats;
}

interface AiSuggestion {
  id: number;
  symbol: string;
  decision: "BUY" | "SELL" | "HOLD";
  confidence: number;
  buyTarget: number | null;
  sellTarget: number | null;
  currentPrice: number;
  generatedAt: string;
}

interface CurrencyConfig {
  code: string;
  name: string;
  symbol: string;
  rate: number;
  locale: string;
  lastUpdated?: string;
}

interface CurrencyRateResponse {
  code: string;
  name: string;
  symbol: string;
  rate: number;
  lastUpdated: string;
}

const CURRENCY_LOCALES: Record<string, string> = {
  USD: "en-US",
  IDR: "id-ID",
  EUR: "de-DE",
  GBP: "en-GB",
  JPY: "ja-JP",
  SGD: "en-SG",
  MYR: "ms-MY",
  THB: "th-TH",
  INR: "en-IN",
  CNY: "zh-CN",
};

const FALLBACK_CURRENCIES: CurrencyConfig[] = [
  { code: "USD", name: "US Dollar", symbol: "$", rate: 1, locale: "en-US" },
  { code: "IDR", name: "Indonesian Rupiah", symbol: "Rp", rate: 15850, locale: "id-ID" },
  { code: "EUR", name: "Euro", symbol: "€", rate: 0.92, locale: "de-DE" },
  { code: "GBP", name: "British Pound", symbol: "£", rate: 0.79, locale: "en-GB" },
  { code: "JPY", name: "Japanese Yen", symbol: "¥", rate: 149.50, locale: "ja-JP" },
  { code: "SGD", name: "Singapore Dollar", symbol: "S$", rate: 1.34, locale: "en-SG" },
  { code: "MYR", name: "Malaysian Ringgit", symbol: "RM", rate: 4.47, locale: "ms-MY" },
  { code: "THB", name: "Thai Baht", symbol: "฿", rate: 35.20, locale: "th-TH" },
  { code: "INR", name: "Indian Rupee", symbol: "₹", rate: 83.50, locale: "en-IN" },
  { code: "CNY", name: "Chinese Yuan", symbol: "¥", rate: 7.24, locale: "zh-CN" },
];

function formatCurrencyUSD(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function getPnLColor(value: number): string {
  if (value > 0) return "text-green-500";
  if (value < 0) return "text-red-500";
  return "text-muted-foreground";
}

export default function LiveDemo() {
  const { currentSymbol, supportedSymbols } = useSymbol();
  const symbol = currentSymbol.symbol;
  const [selectedSymbol, setSelectedSymbol] = useState(symbol);
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawAll, setWithdrawAll] = useState(false);
  const [tradeAmount, setTradeAmount] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
  const [isTradeOpen, setIsTradeOpen] = useState(false);
  const [tradeType, setTradeType] = useState<"BUY" | "SELL">("BUY");
  const [selectedCurrency, setSelectedCurrency] = useState<string>("USD");

  const { data: currencyRatesData } = useQuery<CurrencyRateResponse[]>({
    queryKey: ["/api/currency/rates"],
    refetchInterval: 12 * 60 * 60 * 1000,
    staleTime: 12 * 60 * 60 * 1000,
  });

  const currencies: CurrencyConfig[] = currencyRatesData 
    ? currencyRatesData.map(r => ({
        code: r.code,
        name: r.name,
        symbol: r.symbol,
        rate: r.rate,
        locale: CURRENCY_LOCALES[r.code] || "en-US",
        lastUpdated: r.lastUpdated,
      }))
    : FALLBACK_CURRENCIES;

  const currentCurrency = currencies.find(c => c.code === selectedCurrency) || currencies[0];

  const convertFromUSD = useCallback((usdAmount: number): number => {
    const result = usdAmount * currentCurrency.rate;
    // Round to whole numbers for high-rate currencies (IDR, JPY, etc.)
    if (currentCurrency.rate >= 100) {
      // Smart rounding: snap to clean numbers to avoid 150000001 issues
      // Check if we're very close to a round number (within 0.01%)
      const roundFactors = [10000000, 1000000, 100000, 10000, 1000, 100];
      for (const factor of roundFactors) {
        const nearestRound = Math.round(result / factor) * factor;
        const diff = Math.abs(result - nearestRound);
        // If within 0.01% of a round number, snap to it
        if (diff / nearestRound < 0.0001) {
          return nearestRound;
        }
      }
      return Math.round(result);
    }
    return Math.round(result * 100) / 100;
  }, [currentCurrency.rate]);

  const convertToUSD = useCallback((localAmount: number): number => {
    // Keep high precision for USD to minimize conversion errors
    return localAmount / currentCurrency.rate;
  }, [currentCurrency.rate]);

  // Convert local amount to USD, rounding USD to ensure local amount stays exact
  const convertToUSDExact = useCallback((localAmount: number): number => {
    // For high-rate currencies, adjust USD precision so local amount stays exact
    if (currentCurrency.rate >= 100) {
      // Round local amount to whole number first
      const roundedLocal = Math.round(localAmount);
      // Calculate USD with enough precision
      const usd = roundedLocal / currentCurrency.rate;
      // Round USD to 6 decimal places for precision
      return Math.round(usd * 1000000) / 1000000;
    }
    // For other currencies, round local to 2 decimals
    const roundedLocal = Math.round(localAmount * 100) / 100;
    return roundedLocal / currentCurrency.rate;
  }, [currentCurrency.rate]);

  const formatCurrency = useCallback((usdValue: number): string => {
    const convertedValue = convertFromUSD(usdValue);
    if (currentCurrency.code === "IDR" || currentCurrency.code === "JPY") {
      return new Intl.NumberFormat(currentCurrency.locale, {
        style: "currency",
        currency: currentCurrency.code,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(convertedValue);
    }
    return new Intl.NumberFormat(currentCurrency.locale, {
      style: "currency",
      currency: currentCurrency.code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(convertedValue);
  }, [currentCurrency, convertFromUSD]);

  const { data: accountData, isLoading: accountLoading } = useQuery<DemoAccountResponse>({
    queryKey: ["/api/demo/account"],
    refetchInterval: 30000,
  });

  const { data: openPositions, isLoading: positionsLoading } = useQuery<DemoPosition[]>({
    queryKey: ["/api/demo/positions", { status: "open" }],
    refetchInterval: 10000,
  });

  const { data: closedPositions } = useQuery<DemoPosition[]>({
    queryKey: ["/api/demo/positions", { status: "closed" }],
    refetchInterval: 30000,
  });

  const { data: transactions } = useQuery<DemoTransaction[]>({
    queryKey: ["/api/demo/transactions"],
    refetchInterval: 30000,
  });

  const { data: currentPrice } = useQuery<{ symbol: string; price: number; timestamp: string }>({
    queryKey: ["/api/demo/price", selectedSymbol],
    refetchInterval: 5000,
  });

  const { data: aiSuggestion } = useQuery<AiSuggestion>({
    queryKey: ["/api/suggestions/latest", { symbol: selectedSymbol }],
    refetchInterval: 60000,
  });

  const { data: autoTradeSettings } = useQuery<AutoTradeSetting>({
    queryKey: ["/api/demo/auto-trade"],
    refetchInterval: 30000,
  });

  const [isAutoTradeSettingsOpen, setIsAutoTradeSettingsOpen] = useState(false);
  const [autoTradeUnits, setAutoTradeUnits] = useState("");
  const [autoTradeSymbol, setAutoTradeSymbol] = useState("");

  const autoTradeMutation = useMutation({
    mutationFn: (data: { isEnabled?: boolean; tradeUnits?: number; symbol?: string }) =>
      apiRequest("PATCH", "/api/demo/auto-trade", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/demo/auto-trade"] });
      toast({
        title: "Auto-Trade Settings Updated",
        description: "Your auto-trade settings have been saved.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const depositMutation = useMutation({
    mutationFn: (amount: number) => apiRequest("POST", "/api/demo/deposit", { amount }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/demo/account"] });
      queryClient.invalidateQueries({ queryKey: ["/api/demo/transactions"] });
      setDepositAmount("");
      setIsDepositOpen(false);
    },
  });

  const { toast } = useToast();

  const withdrawMutation = useMutation({
    mutationFn: async (amount: number) => {
      const response = await fetch("/api/demo/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ amount }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Withdrawal failed");
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/demo/account"] });
      queryClient.invalidateQueries({ queryKey: ["/api/demo/transactions"] });
      setWithdrawAmount("");
      setWithdrawAll(false);
      setIsWithdrawOpen(false);
      toast({
        title: "Withdrawal Successful",
        description: `Successfully withdrew ${formatCurrency(convertToUSD(parseFloat(withdrawAmount) || 0))}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Withdrawal Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const openTradeMutation = useMutation({
    mutationFn: (data: { symbol: string; type: string; entryPrice: number; quantity: number; stopLoss?: number; takeProfit?: number }) =>
      apiRequest("POST", "/api/demo/trade/open", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/demo/account"] });
      queryClient.invalidateQueries({ queryKey: ["/api/demo/positions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/demo/transactions"] });
      setTradeAmount("");
      setStopLoss("");
      setTakeProfit("");
      setIsTradeOpen(false);
    },
  });

  const closeTradeMutation = useMutation({
    mutationFn: (data: { positionId: number; exitPrice: number }) =>
      apiRequest("POST", "/api/demo/trade/close", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/demo/account"] });
      queryClient.invalidateQueries({ queryKey: ["/api/demo/positions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/demo/transactions"] });
    },
  });

  const handleWSMessage = useCallback((message: WSMessage) => {
    if (message.type === "market_update") {
      queryClient.invalidateQueries({ queryKey: ["/api/demo/price", message.symbol] });
      queryClient.invalidateQueries({ queryKey: ["/api/demo/positions"] });
    }
  }, []);

  useWebSocket({ onMessage: handleWSMessage });

  // Auto-populate stop loss and take profit when trade modal opens
  useEffect(() => {
    if (isTradeOpen && currentPrice) {
      const price = currentPrice.price;
      
      // Calculate suggested stop loss and take profit
      // Use AI suggestion targets if available, otherwise use 2% defaults
      if (tradeType === "BUY") {
        // For BUY: stop loss below entry, take profit above entry
        const suggestedSL = aiSuggestion?.sellTarget 
          ? Math.min(aiSuggestion.sellTarget, price * 0.98) // Use AI sell target or 2% below
          : price * 0.98; // 2% below current price
        const suggestedTP = aiSuggestion?.buyTarget 
          ? Math.max(aiSuggestion.buyTarget, price * 1.03) // Use AI buy target or 3% above
          : price * 1.03; // 3% above current price
        
        setStopLoss(suggestedSL.toFixed(2));
        setTakeProfit(suggestedTP.toFixed(2));
      } else {
        // For SELL: stop loss above entry, take profit below entry
        const suggestedSL = aiSuggestion?.buyTarget 
          ? Math.max(aiSuggestion.buyTarget, price * 1.02) // Use AI buy target or 2% above
          : price * 1.02; // 2% above current price
        const suggestedTP = aiSuggestion?.sellTarget 
          ? Math.min(aiSuggestion.sellTarget, price * 0.97) // Use AI sell target or 3% below
          : price * 0.97; // 3% below current price
        
        setStopLoss(suggestedSL.toFixed(2));
        setTakeProfit(suggestedTP.toFixed(2));
      }
    }
  }, [isTradeOpen, tradeType, currentPrice, aiSuggestion]);

  const handleDeposit = () => {
    const localAmount = parseFloat(depositAmount);
    if (localAmount > 0) {
      // Use exact conversion to keep local currency amount intact
      const usdAmount = convertToUSDExact(localAmount);
      depositMutation.mutate(usdAmount);
    }
  };

  const handleWithdraw = () => {
    const localAmount = parseFloat(withdrawAmount);
    if (localAmount > 0) {
      // Use exact conversion to keep local currency amount intact
      const usdAmount = convertToUSDExact(localAmount);
      withdrawMutation.mutate(usdAmount);
    }
  };

  const handleOpenTrade = () => {
    const localAmount = parseFloat(tradeAmount);
    if (localAmount > 0 && currentPrice) {
      // Use exact conversion to keep local currency amount intact
      const usdAmount = convertToUSDExact(localAmount);
      const quantity = usdAmount / currentPrice.price;
      openTradeMutation.mutate({
        symbol: selectedSymbol,
        type: tradeType,
        entryPrice: currentPrice.price,
        quantity,
        stopLoss: stopLoss ? parseFloat(stopLoss) : undefined,
        takeProfit: takeProfit ? parseFloat(takeProfit) : undefined,
      });
    }
  };

  const handleCloseTrade = (positionId: number) => {
    if (currentPrice) {
      closeTradeMutation.mutate({ positionId, exitPrice: currentPrice.price });
    }
  };

  const calculateEquityCurve = () => {
    if (!transactions) return [];
    
    const sortedTx = [...transactions].sort((a, b) => 
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    
    return sortedTx.map((tx, index) => ({
      time: format(new Date(tx.createdAt), "HH:mm"),
      balance: tx.balanceAfter,
      index,
    }));
  };

  const equityCurve = calculateEquityCurve();

  const calculateLivePnL = (position: DemoPosition) => {
    const livePrice = position.symbol === selectedSymbol && currentPrice 
      ? currentPrice.price 
      : position.currentPrice || position.entryPrice;
    return position.type === "BUY"
      ? (livePrice - position.entryPrice) * position.quantity
      : (position.entryPrice - livePrice) * position.quantity;
  };

  const openPnL = openPositions?.reduce((sum, pos) => sum + calculateLivePnL(pos), 0) || 0;
  const totalEquity = (accountData?.account.balance || 0) + openPnL;

  // Calculate available withdrawal balance (balance - open positions value)
  const openPositionsValue = openPositions?.reduce((sum, pos) => sum + (pos.entryPrice * pos.quantity), 0) || 0;
  const availableWithdrawBalance = Math.max(0, (accountData?.account.balance || 0) - openPositionsValue);

  return (
    <div className="p-6 space-y-6 overflow-auto h-full">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Live Demo Trading</h1>
          <p className="text-muted-foreground">Practice trading with virtual credits - no real money at risk</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-muted-foreground" />
            <Select value={selectedCurrency} onValueChange={setSelectedCurrency}>
              <SelectTrigger className="w-[160px]" data-testid="select-currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {currencies.map((c) => (
                  <SelectItem key={c.code} value={c.code} data-testid={`option-currency-${c.code}`}>
                    {c.symbol} {c.code} - {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Select value={selectedSymbol} onValueChange={setSelectedSymbol}>
            <SelectTrigger className="w-[140px]" data-testid="select-symbol">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {supportedSymbols.map((s) => (
                <SelectItem key={s.symbol} value={s.symbol} data-testid={`option-symbol-${s.symbol}`}>
                  {s.symbol}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedCurrency !== "USD" && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
          <Globe className="h-4 w-4" />
          <span>
            Displaying in <strong>{currentCurrency.name}</strong> (1 USD = {currentCurrency.rate.toLocaleString()} {currentCurrency.code}).
            All backend operations remain in USD.
            {currentCurrency.lastUpdated && (
              <span className="text-xs ml-2">
                Rate updated {formatDistanceToNow(new Date(currentCurrency.lastUpdated), { addSuffix: true })}
              </span>
            )}
          </span>
        </div>
      )}

      {/* Account Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Account Balance</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {accountLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold" data-testid="text-balance">
                {formatCurrency(accountData?.account.balance || 0)}
              </div>
            )}
            <div className="flex gap-2 mt-2">
              <Dialog open={isDepositOpen} onOpenChange={setIsDepositOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline" data-testid="button-deposit">
                    <Plus className="h-3 w-3 mr-1" /> Deposit
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Deposit Demo Credits</DialogTitle>
                    <DialogDescription>Add virtual funds to your demo account</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label>Amount ({currentCurrency.code})</Label>
                      <Input
                        type="number"
                        value={depositAmount}
                        onChange={(e) => setDepositAmount(e.target.value)}
                        placeholder={currentCurrency.code === "IDR" ? "15850000" : "1000"}
                        min="0"
                        data-testid="input-deposit-amount"
                      />
                      {selectedCurrency !== "USD" && depositAmount && (
                        <p className="text-xs text-muted-foreground mt-1">
                          ≈ {formatCurrencyUSD(convertToUSDExact(parseFloat(depositAmount) || 0))} USD
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {(currentCurrency.code === "IDR" 
                        ? [1000000, 5000000, 10000000, 50000000]
                        : currentCurrency.code === "JPY"
                        ? [150000, 750000, 1500000, 7500000]
                        : [1000, 5000, 10000, 50000].map(v => Math.round(v * currentCurrency.rate))
                      ).map((amt) => (
                        <Button
                          key={amt}
                          size="sm"
                          variant="outline"
                          onClick={() => setDepositAmount(amt.toString())}
                          data-testid={`button-quick-deposit-${amt}`}
                        >
                          {currentCurrency.symbol}{amt.toLocaleString()}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <DialogFooter>
                    <Button onClick={handleDeposit} disabled={depositMutation.isPending} data-testid="button-confirm-deposit">
                      {depositMutation.isPending ? "Processing..." : "Deposit"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Dialog open={isWithdrawOpen} onOpenChange={(open) => {
                setIsWithdrawOpen(open);
                if (!open) {
                  setWithdrawAmount("");
                  setWithdrawAll(false);
                }
              }}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline" data-testid="button-withdraw">
                    <Minus className="h-3 w-3 mr-1" /> Withdraw
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Withdraw Demo Credits</DialogTitle>
                    <DialogDescription>Remove virtual funds from your demo account</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="bg-muted/50 p-3 rounded-md space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Total Balance:</span>
                        <span className="font-medium">{formatCurrency(accountData?.account.balance || 0)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Open Positions Value:</span>
                        <span className="font-medium text-yellow-500">{formatCurrency(openPositionsValue)}</span>
                      </div>
                      <div className="border-t pt-2 flex justify-between text-sm">
                        <span className="text-muted-foreground">Available to Withdraw:</span>
                        <span className="font-medium text-green-500">{formatCurrency(availableWithdrawBalance)}</span>
                      </div>
                    </div>
                    <div>
                      <Label>Amount ({currentCurrency.code})</Label>
                      <Input
                        type="number"
                        value={withdrawAmount}
                        onChange={(e) => {
                          setWithdrawAmount(e.target.value);
                          setWithdrawAll(false);
                        }}
                        placeholder={currentCurrency.code === "IDR" ? "15850000" : "1000"}
                        min="0"
                        disabled={withdrawAll}
                        data-testid="input-withdraw-amount"
                      />
                      {selectedCurrency !== "USD" && withdrawAmount && (
                        <p className="text-xs text-muted-foreground mt-1">
                          ≈ {formatCurrencyUSD(convertToUSDExact(parseFloat(withdrawAmount) || 0))} USD
                        </p>
                      )}
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="withdraw-all"
                        checked={withdrawAll}
                        onCheckedChange={(checked) => {
                          setWithdrawAll(checked === true);
                          if (checked) {
                            // For high-rate currencies, show whole number; otherwise 2 decimals
                            const localAmount = convertFromUSD(availableWithdrawBalance);
                            const formatted = currentCurrency.rate >= 100 
                              ? Math.round(localAmount).toString()
                              : localAmount.toFixed(2);
                            setWithdrawAmount(formatted);
                          }
                        }}
                        data-testid="checkbox-withdraw-all"
                      />
                      <Label htmlFor="withdraw-all" className="text-sm cursor-pointer">
                        Withdraw all available ({formatCurrency(availableWithdrawBalance)})
                      </Label>
                    </div>
                    {openPositionsValue > 0 && (
                      <p className="text-xs text-yellow-500">
                        Note: You have {openPositions?.length || 0} open position(s). Balance must cover open positions.
                      </p>
                    )}
                  </div>
                  <DialogFooter>
                    <Button 
                      onClick={handleWithdraw} 
                      disabled={withdrawMutation.isPending || availableWithdrawBalance <= 0} 
                      data-testid="button-confirm-withdraw"
                    >
                      {withdrawMutation.isPending ? "Processing..." : "Withdraw"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Equity</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-equity">
              {formatCurrency(totalEquity)}
            </div>
            <p className={`text-sm ${getPnLColor(openPnL)}`}>
              Open P&L: {openPnL >= 0 ? "+" : ""}{formatCurrency(openPnL)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Net P&L</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {accountLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className={`text-2xl font-bold ${getPnLColor(accountData?.stats?.netProfitLoss || 0)}`} data-testid="text-net-pnl">
                  {formatCurrency(accountData?.stats?.netProfitLoss || 0)}
                </div>
                <p className={`text-sm ${getPnLColor(accountData?.stats?.profitLossPercent || 0)}`}>
                  {formatPercent(accountData?.stats?.profitLossPercent || 0)}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
            <Percent className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {accountLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className="text-2xl font-bold" data-testid="text-win-rate">
                  {(accountData?.stats?.winRate || 0).toFixed(1)}%
                </div>
                <p className="text-sm text-muted-foreground">
                  {accountData?.stats?.closedPositions || 0} closed trades
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* AI Suggestion Reference */}
      {aiSuggestion && (
        <Card className="border-dashed border-2">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              <CardTitle className="text-sm font-medium">AI Suggestion for {selectedSymbol}</CardTitle>
            </div>
            <Badge
              variant={aiSuggestion.decision === "BUY" ? "default" : aiSuggestion.decision === "SELL" ? "destructive" : "secondary"}
              data-testid="badge-ai-decision"
            >
              {aiSuggestion.decision}
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4 items-center text-sm">
              <div>
                <span className="text-muted-foreground">Confidence:</span>{" "}
                <span className="font-medium">{aiSuggestion.confidence}%</span>
              </div>
              <div>
                <span className="text-muted-foreground">Current:</span>{" "}
                <span className="font-medium">{formatCurrency(aiSuggestion.currentPrice)}</span>
              </div>
              {aiSuggestion.buyTarget && (
                <div>
                  <span className="text-muted-foreground">Buy Target:</span>{" "}
                  <span className="font-medium text-green-500">{formatCurrency(aiSuggestion.buyTarget)}</span>
                </div>
              )}
              {aiSuggestion.sellTarget && (
                <div>
                  <span className="text-muted-foreground">Sell Target:</span>{" "}
                  <span className="font-medium text-red-500">{formatCurrency(aiSuggestion.sellTarget)}</span>
                </div>
              )}
              <div className="text-muted-foreground text-xs">
                {formatDistanceToNow(new Date(aiSuggestion.generatedAt), { addSuffix: true })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Auto-Trade Settings */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <div className="flex items-center gap-2">
            <RefreshCw className={`h-5 w-5 ${autoTradeSettings?.isEnabled ? "text-green-500 animate-spin" : "text-muted-foreground"}`} style={{ animationDuration: "3s" }} />
            <CardTitle className="text-sm font-medium">Auto-Trading</CardTitle>
            {autoTradeSettings?.isEnabled && (
              <Badge variant="default" className="ml-2" data-testid="badge-auto-trade-active">
                Active
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={autoTradeSettings?.isEnabled ?? false}
              onCheckedChange={(checked) => autoTradeMutation.mutate({ isEnabled: checked })}
              disabled={autoTradeMutation.isPending}
              data-testid="switch-auto-trade"
            />
            <Dialog open={isAutoTradeSettingsOpen} onOpenChange={(open) => {
              setIsAutoTradeSettingsOpen(open);
              if (open && autoTradeSettings) {
                setAutoTradeUnits(autoTradeSettings.tradeUnits.toString());
                setAutoTradeSymbol(autoTradeSettings.symbol);
              }
            }}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" data-testid="button-auto-trade-settings">
                  Settings
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Auto-Trade Settings</DialogTitle>
                  <DialogDescription>
                    Configure automatic trading based on AI suggestions. Trades will execute when AI suggests BUY or SELL.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Trade Size (Units/Lots)</Label>
                    <Input
                      type="number"
                      value={autoTradeUnits}
                      onChange={(e) => setAutoTradeUnits(e.target.value)}
                      placeholder="0.01"
                      min="0.01"
                      step="0.01"
                      data-testid="input-auto-trade-units"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Trade size in units/lots per AI suggestion (e.g., 0.01 lot = micro lot)
                    </p>
                  </div>
                  <div>
                    <Label>Symbol to Trade</Label>
                    <Select value={autoTradeSymbol} onValueChange={setAutoTradeSymbol}>
                      <SelectTrigger data-testid="select-auto-trade-symbol">
                        <SelectValue placeholder="Select symbol" />
                      </SelectTrigger>
                      <SelectContent>
                        {supportedSymbols.map((s) => (
                          <SelectItem key={s.symbol} value={s.symbol} data-testid={`option-auto-trade-symbol-${s.symbol}`}>
                            {s.symbol}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {autoTradeSettings && (
                    <div className="bg-muted/50 p-3 rounded-md space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Total Auto-Trades:</span>
                        <span className="font-medium">{autoTradeSettings.totalAutoTrades}</span>
                      </div>
                      {autoTradeSettings.lastTradeAt && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Last Trade:</span>
                          <span className="font-medium">
                            {formatDistanceToNow(new Date(autoTradeSettings.lastTradeAt), { addSuffix: true })}
                          </span>
                        </div>
                      )}
                      {autoTradeSettings.lastDecision && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Last Decision:</span>
                          <Badge 
                            variant={autoTradeSettings.lastDecision === "BUY" ? "default" : "destructive"}
                          >
                            {autoTradeSettings.lastDecision}
                          </Badge>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button
                    onClick={() => {
                      const units = parseFloat(autoTradeUnits);
                      if (units >= 0.01 && autoTradeSymbol) {
                        autoTradeMutation.mutate({ 
                          tradeUnits: units, 
                          symbol: autoTradeSymbol 
                        });
                        setIsAutoTradeSettingsOpen(false);
                      }
                    }}
                    disabled={autoTradeMutation.isPending}
                    data-testid="button-save-auto-trade-settings"
                  >
                    {autoTradeMutation.isPending ? "Saving..." : "Save Settings"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-center text-sm">
            <div>
              <span className="text-muted-foreground">Status:</span>{" "}
              <span className={`font-medium ${autoTradeSettings?.isEnabled ? "text-green-500" : "text-muted-foreground"}`}>
                {autoTradeSettings?.isEnabled ? "Enabled" : "Disabled"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Symbol:</span>{" "}
              <span className="font-medium">{autoTradeSettings?.symbol || "XAUUSD"}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Trade Size:</span>{" "}
              <span className="font-medium">{autoTradeSettings?.tradeUnits?.toFixed(2) || "0.01"} units</span>
            </div>
            <div>
              <span className="text-muted-foreground">Auto-Trades:</span>{" "}
              <span className="font-medium">{autoTradeSettings?.totalAutoTrades || 0}</span>
            </div>
          </div>
          {(autoTradeSettings?.closedAutoTrades || 0) > 0 && (
            <div className="flex flex-wrap gap-4 items-center text-sm mt-2 pt-2 border-t">
              <div>
                <span className="text-muted-foreground">Win/Loss:</span>{" "}
                <span className="font-medium text-green-500">{autoTradeSettings?.winningAutoTrades || 0}</span>
                <span className="text-muted-foreground"> / </span>
                <span className="font-medium text-red-500">{autoTradeSettings?.losingAutoTrades || 0}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Win Rate:</span>{" "}
                <span className="font-medium">
                  {((autoTradeSettings?.winningAutoTrades || 0) / (autoTradeSettings?.closedAutoTrades || 1) * 100).toFixed(1)}%
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Profit:</span>{" "}
                <span className="font-medium text-green-500">{formatCurrency(autoTradeSettings?.totalAutoProfit || 0)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Loss:</span>{" "}
                <span className="font-medium text-red-500">{formatCurrency(autoTradeSettings?.totalAutoLoss || 0)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Net:</span>{" "}
                <span className={`font-medium ${((autoTradeSettings?.totalAutoProfit || 0) - (autoTradeSettings?.totalAutoLoss || 0)) >= 0 ? "text-green-500" : "text-red-500"}`}>
                  {formatCurrency((autoTradeSettings?.totalAutoProfit || 0) - (autoTradeSettings?.totalAutoLoss || 0))}
                </span>
              </div>
            </div>
          )}
          {autoTradeSettings?.isEnabled && (
            <p className="text-xs text-muted-foreground mt-2">
              Auto-trading will execute BUY/SELL trades when AI suggestions are generated. HOLD suggestions are ignored.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Trading Panel */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-4">
          <CardTitle>Trade {selectedSymbol}</CardTitle>
          <div className="flex items-center gap-4">
            {currentPrice && (
              <div className="text-right">
                <div className="text-lg font-bold" data-testid="text-current-price">
                  {formatCurrency(currentPrice.price)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(currentPrice.timestamp), { addSuffix: true })}
                </div>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Dialog open={isTradeOpen} onOpenChange={setIsTradeOpen}>
              <DialogTrigger asChild>
                <Button
                  className="h-16"
                  variant="default"
                  onClick={() => setTradeType("BUY")}
                  data-testid="button-buy"
                >
                  <ArrowUpCircle className="h-6 w-6 mr-2" />
                  <span className="text-lg">BUY</span>
                </Button>
              </DialogTrigger>
              <DialogTrigger asChild>
                <Button
                  className="h-16"
                  variant="destructive"
                  onClick={() => setTradeType("SELL")}
                  data-testid="button-sell"
                >
                  <ArrowDownCircle className="h-6 w-6 mr-2" />
                  <span className="text-lg">SELL</span>
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className={tradeType === "BUY" ? "text-green-500" : "text-red-500"}>
                    {tradeType} {selectedSymbol}
                  </DialogTitle>
                  <DialogDescription>
                    Current price: {currentPrice ? formatCurrency(currentPrice.price) : "Loading..."}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Amount ({currentCurrency.code})</Label>
                    <Input
                      type="number"
                      value={tradeAmount}
                      onChange={(e) => setTradeAmount(e.target.value)}
                      placeholder={currentCurrency.code === "IDR" ? "15850000" : "1000"}
                      min="1"
                      step={currentCurrency.code === "IDR" ? "100000" : "100"}
                      data-testid="input-trade-amount"
                    />
                    {currentPrice && tradeAmount && (
                      <>
                        <p className="text-sm text-muted-foreground mt-1">
                          Units: {(convertToUSDExact(parseFloat(tradeAmount || "0")) / currentPrice.price).toFixed(4)} {selectedSymbol}
                          {selectedCurrency !== "USD" && (
                            <span className="text-xs ml-2">(≈ {formatCurrencyUSD(convertToUSDExact(parseFloat(tradeAmount || "0")))} USD)</span>
                          )}
                        </p>
                        {convertToUSDExact(parseFloat(tradeAmount || "0")) > (accountData?.stats?.balance || 0) && (
                          <p className="text-sm text-red-500 mt-1" data-testid="text-insufficient-funds">
                            Insufficient funds. Available: {formatCurrency(accountData?.stats?.balance || 0)}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="flex items-center gap-1">
                        Stop Loss
                        <span className="text-xs text-muted-foreground">(suggested)</span>
                      </Label>
                      <Input
                        type="number"
                        value={stopLoss}
                        onChange={(e) => setStopLoss(e.target.value)}
                        placeholder={tradeType === "BUY" ? "Lower price" : "Higher price"}
                        step="0.01"
                        data-testid="input-stop-loss"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        {tradeType === "BUY" ? "Exit if price drops" : "Exit if price rises"}
                      </p>
                    </div>
                    <div>
                      <Label className="flex items-center gap-1">
                        Take Profit
                        <span className="text-xs text-muted-foreground">(suggested)</span>
                      </Label>
                      <Input
                        type="number"
                        value={takeProfit}
                        onChange={(e) => setTakeProfit(e.target.value)}
                        placeholder={tradeType === "BUY" ? "Higher price" : "Lower price"}
                        step="0.01"
                        data-testid="input-take-profit"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        {tradeType === "BUY" ? "Exit when target reached" : "Exit when target reached"}
                      </p>
                    </div>
                  </div>
                  {aiSuggestion && (
                    <p className="text-xs text-primary">
                      <Brain className="h-3 w-3 inline mr-1" />
                      Suggestions based on AI analysis
                    </p>
                  )}
                </div>
                <DialogFooter>
                  <Button
                    onClick={handleOpenTrade}
                    disabled={
                      openTradeMutation.isPending || 
                      !tradeAmount || 
                      parseFloat(tradeAmount || "0") > (accountData?.stats?.balance || 0)
                    }
                    variant={tradeType === "BUY" ? "default" : "destructive"}
                    data-testid="button-confirm-trade"
                  >
                    {openTradeMutation.isPending ? "Opening..." : `Open ${tradeType} Position`}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="positions" className="space-y-4">
        <TabsList>
          <TabsTrigger value="positions" data-testid="tab-positions">
            Open Positions ({openPositions?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">
            Trade History
          </TabsTrigger>
          <TabsTrigger value="equity" data-testid="tab-equity">
            Equity Curve
          </TabsTrigger>
          <TabsTrigger value="transactions" data-testid="tab-transactions">
            Transactions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="positions" className="space-y-4">
          {positionsLoading ? (
            <Card>
              <CardContent className="p-6">
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ) : openPositions && openPositions.length > 0 ? (
            <div className="space-y-3">
              {openPositions.map((position) => {
                const livePrice = position.symbol === selectedSymbol && currentPrice 
                  ? currentPrice.price 
                  : position.currentPrice || position.entryPrice;
                const livePnL = position.type === "BUY"
                  ? (livePrice - position.entryPrice) * position.quantity
                  : (position.entryPrice - livePrice) * position.quantity;
                const livePnLPercent = (livePnL / (position.entryPrice * position.quantity)) * 100;
                
                return (
                  <Card key={position.id} data-testid={`card-position-${position.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between flex-wrap gap-4">
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <Badge variant={position.type === "BUY" ? "default" : "destructive"}>
                              {position.type}
                            </Badge>
                            {position.isAutoTrade && (
                              <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-500 border-blue-500/30">
                                AUTO
                              </Badge>
                            )}
                          </div>
                          <div>
                            <div className="font-semibold">{position.symbol}</div>
                            <div className="text-sm text-muted-foreground">
                              {position.quantity.toFixed(4)} units @ {formatCurrency(position.entryPrice)}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <div className="text-sm text-muted-foreground">Current</div>
                            <div className="font-medium">{formatCurrency(livePrice)}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm text-muted-foreground">P&L</div>
                            <div className={`font-bold ${getPnLColor(livePnL)}`}>
                              {formatCurrency(livePnL)}
                              <span className="text-xs ml-1">
                                ({formatPercent(livePnLPercent)})
                              </span>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleCloseTrade(position.id)}
                            disabled={closeTradeMutation.isPending}
                            data-testid={`button-close-position-${position.id}`}
                          >
                            Close
                          </Button>
                        </div>
                      </div>
                      {(position.stopLoss || position.takeProfit) && (
                        <div className="flex gap-4 mt-2 text-sm">
                          {position.stopLoss && (
                            <span className="text-red-500">SL: {formatCurrency(position.stopLoss)}</span>
                          )}
                          {position.takeProfit && (
                            <span className="text-green-500">TP: {formatCurrency(position.takeProfit)}</span>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                No open positions. Start trading to see your positions here.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          {closedPositions && closedPositions.length > 0 ? (
            <div className="space-y-3">
              {closedPositions.slice(0, 20).map((position) => (
                <Card key={position.id} data-testid={`card-history-${position.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between flex-wrap gap-4">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <Badge variant={position.type === "BUY" ? "default" : "destructive"}>
                            {position.type}
                          </Badge>
                          {position.isAutoTrade && (
                            <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-500 border-blue-500/30">
                              AUTO
                            </Badge>
                          )}
                        </div>
                        <div>
                          <div className="font-semibold">{position.symbol}</div>
                          <div className="text-sm text-muted-foreground">
                            {position.quantity} units
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 flex-wrap">
                        <div className="text-right">
                          <div className="text-sm text-muted-foreground">Entry</div>
                          <div className="font-medium">{formatCurrency(position.entryPrice)}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm text-muted-foreground">Exit</div>
                          <div className="font-medium">{formatCurrency(position.exitPrice || 0)}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm text-muted-foreground">Result</div>
                          <div className={`font-bold flex items-center gap-1 ${getPnLColor(position.profitLoss || 0)}`}>
                            {(position.profitLoss || 0) >= 0 ? (
                              <CheckCircle2 className="h-4 w-4" />
                            ) : (
                              <XCircle className="h-4 w-4" />
                            )}
                            {formatCurrency(position.profitLoss || 0)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm text-muted-foreground">Closed</div>
                          <div className="text-xs">
                            {position.closedAt && formatDistanceToNow(new Date(position.closedAt), { addSuffix: true })}
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                No trade history yet. Close some positions to see your history.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="equity">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Equity Curve</CardTitle>
            </CardHeader>
            <CardContent>
              {equityCurve.length > 1 ? (
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={equityCurve}>
                      <defs>
                        <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="time" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis
                        tick={{ fontSize: 12 }}
                        stroke="hsl(var(--muted-foreground))"
                        tickFormatter={(v) => `$${v.toLocaleString()}`}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                        labelStyle={{ color: "hsl(var(--foreground))" }}
                        formatter={(value: number) => [formatCurrency(value), "Balance"]}
                      />
                      <Area
                        type="monotone"
                        dataKey="balance"
                        stroke="hsl(var(--primary))"
                        fill="url(#equityGradient)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  Not enough data to display equity curve. Make some transactions to see your progress.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transactions">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Recent Transactions</CardTitle>
            </CardHeader>
            <CardContent>
              {transactions && transactions.length > 0 ? (
                <div className="space-y-2">
                  {transactions.slice(0, 20).map((tx) => (
                    <div
                      key={tx.id}
                      className="flex items-center justify-between py-2 border-b last:border-0"
                      data-testid={`row-transaction-${tx.id}`}
                    >
                      <div className="flex items-center gap-3">
                        {tx.type === "deposit" && <ArrowUpCircle className="h-4 w-4 text-green-500" />}
                        {tx.type === "withdraw" && <ArrowDownCircle className="h-4 w-4 text-red-500" />}
                        {tx.type === "trade_open" && <Activity className="h-4 w-4 text-blue-500" />}
                        {tx.type === "profit" && <TrendingUp className="h-4 w-4 text-green-500" />}
                        {tx.type === "loss" && <TrendingDown className="h-4 w-4 text-red-500" />}
                        <div>
                          <div className="text-sm font-medium">{tx.description}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(tx.createdAt), { addSuffix: true })}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`font-medium ${tx.amount >= 0 ? "text-green-500" : "text-red-500"}`}>
                          {tx.amount >= 0 ? "+" : ""}{formatCurrency(tx.amount)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Balance: {formatCurrency(tx.balanceAfter)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center text-muted-foreground py-6">
                  No transactions yet. Deposit some demo credits to get started.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
