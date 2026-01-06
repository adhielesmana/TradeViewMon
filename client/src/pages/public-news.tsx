import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { Link } from "wouter";
import { TrendingUp, TrendingDown, Minus, Clock, ArrowRight, BarChart3, LogIn, Newspaper, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/theme-toggle";

import marketAnalysisImage from "@assets/stock_images/stock_market_trading_4aea7bde.jpg";

interface MarketPrediction {
  headline?: string;
  overallSentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidence: number;
  summary: string;
  keyFactors: string[];
  affectedSymbols: Array<{
    symbol: string;
    impact: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
    reason: string;
  }>;
  tradingRecommendation: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
}

interface NewsSnapshot {
  id: number;
  headline?: string;
  overallSentiment: string;
  confidence: number;
  summary: string;
  riskLevel: string;
  analyzedAt: string;
  generatedArticle?: string;
}

interface SymbolPrice {
  symbol: string;
  displayName: string;
  price: number;
  change?: number;
  changePercent?: number;
  currency: string;
}

function SentimentIcon({ sentiment }: { sentiment: string }) {
  if (sentiment === "BULLISH") return <TrendingUp className="h-4 w-4 text-green-500" />;
  if (sentiment === "BEARISH") return <TrendingDown className="h-4 w-4 text-red-500" />;
  return <Minus className="h-4 w-4 text-yellow-500" />;
}

function PriceChange({ change, changePercent }: { change?: number; changePercent?: number }) {
  if (change === undefined || changePercent === undefined) return null;
  const isPositive = change >= 0;
  return (
    <span className={`text-xs font-medium ${isPositive ? "text-green-500" : "text-red-500"}`}>
      {isPositive ? "+" : ""}{changePercent.toFixed(2)}%
    </span>
  );
}

function formatPrice(price: number, currency: string): string {
  if (currency === "IDR") {
    return `Rp ${price.toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }
  return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function PublicNewsPage() {
  const { data: currentAnalysis, isLoading: isLoadingAnalysis } = useQuery<{ marketPrediction: MarketPrediction }>({
    queryKey: ["/api/public/news/current"],
    refetchInterval: 60000,
  });

  const { data: newsHistory, isLoading: isLoadingHistory } = useQuery<{ snapshots: NewsSnapshot[] }>({
    queryKey: ["/api/public/news/history"],
    refetchInterval: 120000,
  });

  const { data: marketPrices, isLoading: isLoadingPrices } = useQuery<{ prices: SymbolPrice[] }>({
    queryKey: ["/api/public/prices"],
    refetchInterval: 30000,
  });

  const prediction = currentAnalysis?.marketPrediction;
  const snapshots = newsHistory?.snapshots || [];
  const prices = marketPrices?.prices || [];

  return (
    <div className="min-h-screen bg-background">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4">
          {/* Upper nav */}
          <div className="flex h-14 items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary">
                <BarChart3 className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="text-xl font-bold tracking-tight">TradeViewMon</span>
              <span className="hidden text-sm text-muted-foreground md:inline-block">Market Intelligence</span>
            </div>
            
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <Link href="/login">
                <Button variant="outline" size="sm" data-testid="button-login">
                  <LogIn className="mr-2 h-4 w-4" />
                  Sign In
                </Button>
              </Link>
            </div>
          </div>
          
          {/* Ticker strip */}
          <div className="flex h-10 items-center gap-6 overflow-x-auto border-t py-1 scrollbar-hide">
            <Badge variant="destructive" className="shrink-0">
              <Newspaper className="mr-1 h-3 w-3" />
              Live Updates
            </Badge>
            <div className="flex items-center gap-6 text-sm">
              {isLoadingPrices ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-4 w-24" />
                ))
              ) : prices.slice(0, 8).map((item) => (
                <div key={item.symbol} className="flex shrink-0 items-center gap-2" data-testid={`ticker-${item.symbol}`}>
                  <span className="font-medium">{item.symbol}</span>
                  <span className="text-muted-foreground">{formatPrice(item.price, item.currency)}</span>
                  <PriceChange change={item.change} changePercent={item.changePercent} />
                </div>
              ))}
            </div>
            <span className="ml-auto shrink-0 text-sm text-muted-foreground">
              {format(new Date(), "EEE, MMM d, yyyy")}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6">
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Featured Story - Left Column */}
          <div className="lg:col-span-2">
            {isLoadingAnalysis ? (
              <div className="space-y-4">
                <Skeleton className="h-80 w-full rounded-lg" />
                <Skeleton className="h-8 w-3/4" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : prediction ? (
              <article data-testid="featured-article">
                {/* Featured Image */}
                <div className="relative mb-4 overflow-hidden rounded-lg">
                  <img
                    src={marketAnalysisImage}
                    alt="Market Analysis"
                    className="aspect-video w-full object-cover"
                    data-testid="img-featured-article"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-6">
                    <Badge 
                      variant={prediction.overallSentiment === "BULLISH" ? "default" : prediction.overallSentiment === "BEARISH" ? "destructive" : "secondary"}
                      className="mb-3"
                    >
                      {prediction.overallSentiment} Market
                    </Badge>
                    <h1 className="mb-2 text-2xl font-bold text-white md:text-3xl lg:text-4xl" data-testid="text-headline-featured">
                      {prediction.headline || `${prediction.overallSentiment} Market Outlook`}
                    </h1>
                    <div className="flex items-center gap-4 text-white/80">
                      <span className="flex items-center gap-1 text-sm" data-testid="text-timestamp">
                        <Clock className="h-4 w-4" />
                        {format(new Date(), "MMMM d, yyyy 'at' HH:mm")}
                      </span>
                      <span className="text-sm" data-testid="text-confidence">
                        Confidence: {prediction.confidence}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Article Summary */}
                <p className="mb-4 text-lg text-muted-foreground leading-relaxed" data-testid="text-summary-featured">
                  {prediction.summary}
                </p>

                {/* Key Factors */}
                {prediction.keyFactors.length > 0 && (
                  <div className="mb-4" data-testid="section-key-factors">
                    <h3 className="mb-2 font-semibold">Key Market Factors</h3>
                    <ul className="space-y-1 text-sm text-muted-foreground">
                      {prediction.keyFactors.slice(0, 3).map((factor, i) => (
                        <li key={i} className="flex items-start gap-2" data-testid={`text-factor-${i}`}>
                          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          {factor}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Affected Symbols */}
                {prediction.affectedSymbols.length > 0 && (
                  <div className="flex flex-wrap gap-2" data-testid="section-affected-symbols">
                    {prediction.affectedSymbols.slice(0, 5).map((s) => (
                      <Badge 
                        key={s.symbol} 
                        variant="outline"
                        data-testid={`badge-symbol-${s.symbol}`}
                        className={s.impact === "POSITIVE" ? "border-green-500/50 text-green-600 dark:text-green-400" : s.impact === "NEGATIVE" ? "border-red-500/50 text-red-600 dark:text-red-400" : ""}
                      >
                        <SentimentIcon sentiment={s.impact === "POSITIVE" ? "BULLISH" : s.impact === "NEGATIVE" ? "BEARISH" : "NEUTRAL"} />
                        <span className="ml-1">{s.symbol}</span>
                      </Badge>
                    ))}
                  </div>
                )}
              </article>
            ) : (
              <div className="flex h-80 items-center justify-center rounded-lg border border-dashed">
                <p className="text-muted-foreground">No market analysis available</p>
              </div>
            )}
          </div>

          {/* Right Sidebar - Latest News */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Latest News</h2>
              <Link href="/login">
                <Button variant="ghost" size="sm" className="text-primary" data-testid="button-view-all-news">
                  View All <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </Link>
            </div>
            
            {isLoadingHistory ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <Skeleton className="mb-2 h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </CardContent>
                </Card>
              ))
            ) : snapshots.length > 0 ? (
              snapshots.slice(0, 5).map((snapshot) => (
                <Card 
                  key={snapshot.id} 
                  className="transition-colors hover-elevate cursor-pointer"
                  data-testid={`news-card-${snapshot.id}`}
                >
                  <CardContent className="p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <SentimentIcon sentiment={snapshot.overallSentiment} />
                      <Badge variant="outline" className="text-xs">
                        {snapshot.overallSentiment}
                      </Badge>
                    </div>
                    <h3 className="mb-1 font-medium leading-tight line-clamp-2" data-testid={`headline-${snapshot.id}`}>
                      {snapshot.headline || `${snapshot.overallSentiment} Market Analysis`}
                    </h3>
                    <p className="mb-2 text-xs text-muted-foreground line-clamp-2">
                      {snapshot.summary}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {formatDistanceToNow(new Date(snapshot.analyzedAt), { addSuffix: true })}
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : (
              <div className="flex h-40 items-center justify-center rounded-lg border border-dashed">
                <p className="text-sm text-muted-foreground">No news history available</p>
              </div>
            )}
          </div>
        </div>

        {/* Market Overview Section */}
        <section className="mt-8">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-bold">Market Overview</h2>
            <Link href="/login">
              <Button variant="outline" size="sm" data-testid="button-full-dashboard">
                Full Dashboard <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </div>
          
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {isLoadingPrices ? (
              Array.from({ length: 6 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <Skeleton className="mb-2 h-4 w-16" />
                    <Skeleton className="h-6 w-24" />
                  </CardContent>
                </Card>
              ))
            ) : prices.map((item) => (
              <Card key={item.symbol} className="hover-elevate cursor-pointer" data-testid={`price-card-${item.symbol}`}>
                <CardContent className="p-4">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-bold">{item.symbol}</span>
                    <PriceChange change={item.change} changePercent={item.changePercent} />
                  </div>
                  <div className="text-lg font-semibold">
                    {formatPrice(item.price, item.currency)}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {item.displayName}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Past Articles Section */}
        {snapshots.length > 5 && (
          <section className="mt-8">
            <h2 className="mb-4 text-xl font-bold">Past Market Analysis</h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {snapshots.slice(5, 11).map((snapshot) => (
                <Card key={snapshot.id} className="hover-elevate cursor-pointer" data-testid={`past-article-${snapshot.id}`}>
                  <CardContent className="p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <SentimentIcon sentiment={snapshot.overallSentiment} />
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(snapshot.analyzedAt), "MMM d, yyyy")}
                      </span>
                    </div>
                    <h3 className="mb-2 font-semibold leading-tight line-clamp-2">
                      {snapshot.headline || `${snapshot.overallSentiment} Market Outlook`}
                    </h3>
                    <p className="text-sm text-muted-foreground line-clamp-3">
                      {snapshot.summary}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-12 border-t bg-muted/50 py-8">
        <div className="container mx-auto px-4 text-center">
          <div className="flex items-center justify-center gap-2 text-lg font-bold">
            <BarChart3 className="h-5 w-5 text-primary" />
            TradeViewMon
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            AI-powered market intelligence and trading insights
          </p>
          <p className="mt-4 text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} TradeViewMon. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
