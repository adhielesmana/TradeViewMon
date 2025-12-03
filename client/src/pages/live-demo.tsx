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
  History
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { useSymbol } from "@/lib/symbol-context";
import { useWebSocket, type WSMessage } from "@/hooks/use-websocket";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { LineChart as RechartsLineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from "recharts";
import type { DemoAccount, DemoPosition, DemoTransaction, DemoAccountStats } from "@shared/schema";

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

function formatCurrency(value: number): string {
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
  const [tradeAmount, setTradeAmount] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
  const [isTradeOpen, setIsTradeOpen] = useState(false);
  const [tradeType, setTradeType] = useState<"BUY" | "SELL">("BUY");

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

  const depositMutation = useMutation({
    mutationFn: (amount: number) => apiRequest("POST", "/api/demo/deposit", { amount }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/demo/account"] });
      queryClient.invalidateQueries({ queryKey: ["/api/demo/transactions"] });
      setDepositAmount("");
      setIsDepositOpen(false);
    },
  });

  const withdrawMutation = useMutation({
    mutationFn: (amount: number) => apiRequest("POST", "/api/demo/withdraw", { amount }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/demo/account"] });
      queryClient.invalidateQueries({ queryKey: ["/api/demo/transactions"] });
      setWithdrawAmount("");
      setIsWithdrawOpen(false);
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

  const handleDeposit = () => {
    const amount = parseFloat(depositAmount);
    if (amount > 0) {
      depositMutation.mutate(amount);
    }
  };

  const handleWithdraw = () => {
    const amount = parseFloat(withdrawAmount);
    if (amount > 0) {
      withdrawMutation.mutate(amount);
    }
  };

  const handleOpenTrade = () => {
    const amount = parseFloat(tradeAmount);
    if (amount > 0 && currentPrice) {
      const quantity = amount / currentPrice.price;
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

  return (
    <div className="p-6 space-y-6 overflow-auto h-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Live Demo Trading</h1>
          <p className="text-muted-foreground">Practice trading with virtual credits - no real money at risk</p>
        </div>
        <Select value={selectedSymbol} onValueChange={setSelectedSymbol}>
          <SelectTrigger className="w-[180px]" data-testid="select-symbol">
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
                      <Label>Amount (USD)</Label>
                      <Input
                        type="number"
                        value={depositAmount}
                        onChange={(e) => setDepositAmount(e.target.value)}
                        placeholder="1000"
                        min="0"
                        data-testid="input-deposit-amount"
                      />
                    </div>
                    <div className="flex gap-2">
                      {[1000, 5000, 10000, 50000].map((amt) => (
                        <Button
                          key={amt}
                          size="sm"
                          variant="outline"
                          onClick={() => setDepositAmount(amt.toString())}
                          data-testid={`button-quick-deposit-${amt}`}
                        >
                          ${amt.toLocaleString()}
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
              <Dialog open={isWithdrawOpen} onOpenChange={setIsWithdrawOpen}>
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
                    <div>
                      <Label>Amount (USD)</Label>
                      <Input
                        type="number"
                        value={withdrawAmount}
                        onChange={(e) => setWithdrawAmount(e.target.value)}
                        placeholder="1000"
                        min="0"
                        max={accountData?.account.balance || 0}
                        data-testid="input-withdraw-amount"
                      />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Available: {formatCurrency(accountData?.account.balance || 0)}
                    </p>
                  </div>
                  <DialogFooter>
                    <Button onClick={handleWithdraw} disabled={withdrawMutation.isPending} data-testid="button-confirm-withdraw">
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
                    <Label>Amount ($)</Label>
                    <Input
                      type="number"
                      value={tradeAmount}
                      onChange={(e) => setTradeAmount(e.target.value)}
                      placeholder="1000"
                      min="1"
                      step="100"
                      data-testid="input-trade-amount"
                    />
                    {currentPrice && tradeAmount && (
                      <>
                        <p className="text-sm text-muted-foreground mt-1">
                          Units: {(parseFloat(tradeAmount || "0") / currentPrice.price).toFixed(4)} {selectedSymbol}
                        </p>
                        {parseFloat(tradeAmount || "0") > (accountData?.stats?.balance || 0) && (
                          <p className="text-sm text-red-500 mt-1" data-testid="text-insufficient-funds">
                            Insufficient funds. Available: {formatCurrency(accountData?.stats?.balance || 0)}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Stop Loss (optional)</Label>
                      <Input
                        type="number"
                        value={stopLoss}
                        onChange={(e) => setStopLoss(e.target.value)}
                        placeholder={tradeType === "BUY" ? "Lower price" : "Higher price"}
                        step="0.01"
                        data-testid="input-stop-loss"
                      />
                    </div>
                    <div>
                      <Label>Take Profit (optional)</Label>
                      <Input
                        type="number"
                        value={takeProfit}
                        onChange={(e) => setTakeProfit(e.target.value)}
                        placeholder={tradeType === "BUY" ? "Higher price" : "Lower price"}
                        step="0.01"
                        data-testid="input-take-profit"
                      />
                    </div>
                  </div>
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
                          <Badge variant={position.type === "BUY" ? "default" : "destructive"}>
                            {position.type}
                          </Badge>
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
                        <Badge variant={position.type === "BUY" ? "default" : "destructive"}>
                          {position.type}
                        </Badge>
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
