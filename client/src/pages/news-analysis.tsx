import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { queryClient } from "@/lib/queryClient";
import { 
  Newspaper, 
  TrendingUp, 
  TrendingDown, 
  Minus, 
  RefreshCw, 
  AlertTriangle,
  Clock,
  ExternalLink,
  Brain,
  Target,
  Shield,
  ChevronLeft,
  ChevronRight,
  Calendar,
  History,
  FileText,
  Eye
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import marketAnalysisImage from "@assets/stock_images/stock_market_trading_4aea7bde.jpg";

interface NewsArticle {
  id: number;
  title: string;
  link: string;
  content: string | null;
  source: string | null;
  publishedAt: string | null;
  fetchedAt: string;
  sentiment: string | null;
  affectedSymbols: string | null;
}

interface PaginatedNewsResponse {
  articles: NewsArticle[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    daysBack: number;
  };
}

interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  content: string;
  source: string;
}

interface AffectedSymbol {
  symbol: string;
  impact: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  reason: string;
}

interface MarketPrediction {
  overallSentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidence: number;
  summary: string;
  keyFactors: string[];
  affectedSymbols: AffectedSymbol[];
  tradingRecommendation: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
}

interface NewsAnalysis {
  fetchedAt: string;
  newsCount: number;
  news: NewsItem[];
  marketPrediction: MarketPrediction | null;
  error?: string;
}

interface HistorySnapshot {
  id: number;
  overallSentiment: string;
  confidence: number;
  summary: string;
  keyFactors: string | null;
  affectedSymbols: string | null;
  tradingRecommendation: string | null;
  riskLevel: string | null;
  newsCount: number;
  analyzedAt: string;
  createdAt: string;
  analysisType: string | null;
  generatedArticle: string | null;
}

interface PaginatedHistoryResponse {
  snapshots: HistorySnapshot[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

function SentimentIcon({ sentiment }: { sentiment: string }) {
  switch (sentiment) {
    case "BULLISH":
    case "POSITIVE":
      return <TrendingUp className="h-5 w-5 text-green-500" />;
    case "BEARISH":
    case "NEGATIVE":
      return <TrendingDown className="h-5 w-5 text-red-500" />;
    default:
      return <Minus className="h-5 w-5 text-yellow-500" />;
  }
}

function SentimentBadge({ sentiment }: { sentiment: string }) {
  const variant = sentiment === "BULLISH" ? "default" : sentiment === "BEARISH" ? "destructive" : "secondary";
  
  return (
    <Badge variant={variant} className={`gap-1 ${sentiment === "BULLISH" ? "bg-green-500 hover:bg-green-600" : ""}`}>
      <SentimentIcon sentiment={sentiment} />
      {sentiment}
    </Badge>
  );
}

function RiskBadge({ risk }: { risk: string }) {
  const colors = {
    LOW: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    MEDIUM: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    HIGH: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  };
  
  return (
    <Badge variant="outline" className={colors[risk as keyof typeof colors] || colors.MEDIUM}>
      <Shield className="h-3 w-3 mr-1" />
      {risk} Risk
    </Badge>
  );
}

function ImpactBadge({ impact }: { impact: string }) {
  if (impact === "POSITIVE") {
    return <Badge variant="outline" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Positive</Badge>;
  }
  if (impact === "NEGATIVE") {
    return <Badge variant="outline" className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">Negative</Badge>;
  }
  return <Badge variant="outline">Neutral</Badge>;
}

function ArticleSentimentBadge({ sentiment }: { sentiment: string | null }) {
  if (!sentiment) return null;
  const upper = sentiment.toUpperCase();
  if (upper === "POSITIVE" || upper === "BULLISH") {
    return <Badge variant="outline" className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Positive</Badge>;
  }
  if (upper === "NEGATIVE" || upper === "BEARISH") {
    return <Badge variant="outline" className="text-xs bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">Negative</Badge>;
  }
  return <Badge variant="outline" className="text-xs">Neutral</Badge>;
}

export default function NewsAnalysisPage() {
  const [currentPage, setCurrentPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [selectedSnapshot, setSelectedSnapshot] = useState<HistorySnapshot | null>(null);
  const pageSize = 15;
  const historyPageSize = 10;

  const { data: analysis, isLoading: analysisLoading, isFetching: analysisFetching, refetch } = useQuery<NewsAnalysis>({
    queryKey: ["/api/news/analysis"],
    refetchInterval: 5 * 60 * 1000,
    staleTime: 2 * 60 * 1000,
  });

  const { data: paginatedNews, isLoading: newsLoading, refetch: refetchNews } = useQuery<PaginatedNewsResponse>({
    queryKey: [`/api/news/articles?page=${currentPage}&pageSize=${pageSize}&daysBack=7`],
    refetchInterval: 60 * 1000,
  });

  const { data: historyData, isLoading: historyLoading } = useQuery<PaginatedHistoryResponse>({
    queryKey: [`/api/news/analysis/history?page=${historyPage}&pageSize=${historyPageSize}`],
    refetchInterval: 5 * 60 * 1000,
  });

  const handleRefresh = () => {
    setCurrentPage(1);
    queryClient.invalidateQueries({ queryKey: ["/api/news/analysis"] });
    queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0] || '').startsWith('/api/news/articles') });
    queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0] || '').startsWith('/api/news/analysis/history') });
    refetch();
    refetchNews();
  };

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
  };

  const handleHistoryPageChange = (newPage: number) => {
    setHistoryPage(newPage);
  };

  if (analysisLoading) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <div className="flex items-center gap-3">
          <Newspaper className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">News & AI Analysis</h1>
            <p className="text-sm text-muted-foreground">Loading market news and predictions...</p>
          </div>
        </div>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64 mt-2" />
            </CardHeader>
            <CardContent className="space-y-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-36" />
            </CardHeader>
            <CardContent className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const pagination = paginatedNews?.pagination;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Newspaper className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">News & AI Analysis</h1>
            <p className="text-sm text-muted-foreground">
              AI-powered market predictions based on 7 days of financial news
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {analysis?.fetchedAt && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              Updated: {format(new Date(analysis.fetchedAt), "HH:mm:ss")}
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={analysisFetching}
            data-testid="button-refresh-news"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${analysisFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {analysis?.error && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">{analysis.error}</span>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-6">
        {/* AI Market Prediction - Full Width */}
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Brain className="h-5 w-5 text-purple-500" />
                <CardTitle>AI Market Prediction</CardTitle>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {analysis?.marketPrediction && (
                  <>
                    <SentimentBadge sentiment={analysis.marketPrediction.overallSentiment} />
                    <Badge variant="outline">
                      {analysis.marketPrediction.confidence}% Confidence
                    </Badge>
                    <RiskBadge risk={analysis.marketPrediction.riskLevel} />
                  </>
                )}
              </div>
            </div>
            <CardDescription>
              OpenAI analysis of {pagination?.total || analysis?.newsCount || 0} news articles (last 7 days)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {analysis?.marketPrediction ? (
              <>
                {/* Article-Style Analysis Report */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold border-b pb-2">Market Analysis Report</h3>
                  
                  {/* Featured Image */}
                  <div className="relative w-full h-48 md:h-64 lg:h-72 rounded-lg overflow-hidden">
                    <img 
                      src={marketAnalysisImage} 
                      alt="Market Analysis" 
                      className="w-full h-full object-cover"
                      data-testid="img-market-analysis"
                    />
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-4">
                      <span className="text-white text-sm font-medium">
                        {format(new Date(), "EEEE, MMMM d, yyyy")} - Market Update
                      </span>
                    </div>
                  </div>
                  
                  <article className="prose prose-sm dark:prose-invert max-w-none space-y-4">
                    <p className="text-muted-foreground leading-relaxed text-justify">
                      Current market analysis indicates a <strong>{analysis.marketPrediction.overallSentiment.toLowerCase()}</strong> outlook 
                      with a confidence level of {analysis.marketPrediction.confidence}%. {analysis.marketPrediction.summary}
                    </p>
                    
                    <p className="text-muted-foreground leading-relaxed text-justify">
                      {analysis.marketPrediction.keyFactors.length > 0 && (
                        <>
                          Several key factors are driving market sentiment. {analysis.marketPrediction.keyFactors[0]}
                          {analysis.marketPrediction.keyFactors[1] && ` Additionally, ${analysis.marketPrediction.keyFactors[1].toLowerCase()}`}
                          {analysis.marketPrediction.keyFactors[2] && ` Furthermore, ${analysis.marketPrediction.keyFactors[2].toLowerCase()}`}
                        </>
                      )}
                    </p>
                    
                    <p className="text-muted-foreground leading-relaxed text-justify">
                      {analysis.marketPrediction.affectedSymbols.length > 0 && (
                        <>
                          Among the affected instruments, {analysis.marketPrediction.affectedSymbols.map((s, i) => {
                            const prefix = i === 0 ? "" : i === analysis.marketPrediction!.affectedSymbols.length - 1 ? " and " : ", ";
                            return `${prefix}${s.symbol} shows ${s.impact.toLowerCase()} impact due to ${s.reason.toLowerCase()}`;
                          }).join("")}.
                        </>
                      )}
                      {" "}The current risk assessment suggests a <strong>{analysis.marketPrediction.riskLevel.toLowerCase()}</strong> risk environment for trading activities.
                    </p>
                    
                    <p className="text-muted-foreground leading-relaxed text-justify">
                      Based on this comprehensive analysis, {analysis.marketPrediction.tradingRecommendation}
                      {" "}Traders should remain vigilant and monitor market conditions closely as these factors continue to evolve throughout the trading session.
                    </p>
                  </article>
                </div>

                <Separator />

                {/* Summary Section */}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">Quick Summary</h4>
                  <p className="text-sm text-muted-foreground">
                    {analysis.marketPrediction.summary}
                  </p>
                </div>

                <Separator />

                <div className="space-y-2">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Target className="h-4 w-4" />
                    Trading Recommendation
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    {analysis.marketPrediction.tradingRecommendation}
                  </p>
                </div>

                {analysis.marketPrediction.keyFactors.length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium">Key Factors</h4>
                      <ul className="space-y-1">
                        {analysis.marketPrediction.keyFactors.map((factor, idx) => (
                          <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                            <span className="text-primary">•</span>
                            {factor}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </>
                )}

                {analysis.marketPrediction.affectedSymbols.length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium">Symbol Impact</h4>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        {analysis.marketPrediction.affectedSymbols.map((item, idx) => (
                          <div key={idx} className="flex flex-col gap-1 p-3 rounded-lg bg-muted/50">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="font-mono">
                                {item.symbol}
                              </Badge>
                              <ImpactBadge impact={item.impact} />
                            </div>
                            <span className="text-muted-foreground text-xs">
                              {item.reason}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Brain className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-sm">
                  AI analysis not available. Make sure OpenAI is configured in Settings.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* News Articles with Pagination */}
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Newspaper className="h-5 w-5 text-orange-500" />
                <CardTitle>Financial News (Last 7 Days)</CardTitle>
              </div>
              {pagination && (
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  {pagination.total} articles
                </div>
              )}
            </div>
            <CardDescription>
              Headlines from your configured RSS feeds - AI learns from all articles
            </CardDescription>
          </CardHeader>
          <CardContent>
            {newsLoading ? (
              <div className="space-y-4">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="space-y-2 border-b pb-4 last:border-b-0">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                ))}
              </div>
            ) : paginatedNews?.articles && paginatedNews.articles.length > 0 ? (
              <>
                <div className="space-y-4 max-h-[600px] overflow-y-auto">
                  {paginatedNews.articles.map((article) => (
                    <div key={article.id} className="border-b pb-4 last:border-b-0 last:pb-0" data-testid={`article-${article.id}`}>
                      <a
                        href={article.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group"
                        data-testid={`link-article-${article.id}`}
                      >
                        <h4 className="text-sm font-medium group-hover:text-primary transition-colors flex items-start gap-2">
                          {article.title}
                          <ExternalLink className="h-3 w-3 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </h4>
                      </a>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        {article.source && (
                          <Badge variant="outline" className="text-xs">
                            {article.source}
                          </Badge>
                        )}
                        <ArticleSentimentBadge sentiment={article.sentiment} />
                        <span className="text-xs text-muted-foreground">
                          {article.publishedAt 
                            ? formatDistanceToNow(new Date(article.publishedAt), { addSuffix: true })
                            : formatDistanceToNow(new Date(article.fetchedAt), { addSuffix: true })
                          }
                        </span>
                      </div>
                      {article.content && (
                        <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                          {article.content}
                        </p>
                      )}
                      {article.affectedSymbols && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {article.affectedSymbols.split(",").map((symbol, idx) => (
                            <Badge key={idx} variant="secondary" className="text-xs font-mono">
                              {symbol.trim()}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Pagination Controls */}
                {pagination && pagination.totalPages > 1 && (
                  <div className="flex items-center justify-between mt-6 pt-4 border-t">
                    <div className="text-sm text-muted-foreground">
                      Page {pagination.page} of {pagination.totalPages}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePageChange(currentPage - 1)}
                        disabled={currentPage <= 1}
                        data-testid="button-prev-page"
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePageChange(currentPage + 1)}
                        disabled={currentPage >= pagination.totalPages}
                        data-testid="button-next-page"
                      >
                        Next
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Newspaper className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-sm">
                  No news available. Check your RSS feed configuration in Settings.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Article History Section */}
        <Card data-testid="card-article-history">
          <CardHeader>
            <div className="flex items-center gap-2">
              <History className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Article History</CardTitle>
              {historyData?.pagination && (
                <Badge variant="secondary" className="ml-2">
                  {historyData.pagination.total} predictions
                </Badge>
              )}
            </div>
            <CardDescription>
              Browse past AI market predictions and analysis reports
            </CardDescription>
          </CardHeader>
          <CardContent>
            {historyLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="flex items-center gap-4 p-3 border rounded-lg">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : historyData?.snapshots && historyData.snapshots.length > 0 ? (
              <>
                <div className="space-y-3 max-h-[500px] overflow-y-auto">
                  {historyData.snapshots.map((snapshot) => (
                    <div
                      key={snapshot.id}
                      className="flex items-center gap-4 p-3 border rounded-lg hover-elevate cursor-pointer"
                      onClick={() => setSelectedSnapshot(snapshot)}
                      data-testid={`history-item-${snapshot.id}`}
                    >
                      <div className="flex-shrink-0">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          snapshot.overallSentiment === "BULLISH" 
                            ? "bg-green-100 dark:bg-green-900" 
                            : snapshot.overallSentiment === "BEARISH"
                            ? "bg-red-100 dark:bg-red-900"
                            : "bg-yellow-100 dark:bg-yellow-900"
                        }`}>
                          <SentimentIcon sentiment={snapshot.overallSentiment} />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">
                            {snapshot.overallSentiment} Market Outlook
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {snapshot.confidence}% confidence
                          </Badge>
                          {snapshot.analysisType === "hourly" && (
                            <Badge variant="secondary" className="text-xs">
                              Hourly
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-1 mt-1">
                          {snapshot.summary}
                        </p>
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(snapshot.analyzedAt), "MMM d, yyyy 'at' HH:mm")}
                          <span className="mx-1">·</span>
                          <FileText className="h-3 w-3" />
                          {snapshot.newsCount} articles analyzed
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedSnapshot(snapshot);
                        }}
                        data-testid={`button-view-history-${snapshot.id}`}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>

                {/* History Pagination Controls */}
                {historyData.pagination && historyData.pagination.totalPages > 1 && (
                  <div className="flex items-center justify-between mt-6 pt-4 border-t">
                    <div className="text-sm text-muted-foreground">
                      Page {historyData.pagination.page} of {historyData.pagination.totalPages}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleHistoryPageChange(historyPage - 1)}
                        disabled={historyPage <= 1}
                        data-testid="button-prev-history"
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleHistoryPageChange(historyPage + 1)}
                        disabled={historyPage >= historyData.pagination.totalPages}
                        data-testid="button-next-history"
                      >
                        Next
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-sm">
                  No article history available yet. Predictions will appear here as they are generated.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Article Detail Modal */}
      <Dialog open={!!selectedSnapshot} onOpenChange={(open) => !open && setSelectedSnapshot(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          {selectedSnapshot && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3 mb-2">
                  <SentimentBadge sentiment={selectedSnapshot.overallSentiment} />
                  {selectedSnapshot.riskLevel && (
                    <RiskBadge risk={selectedSnapshot.riskLevel} />
                  )}
                </div>
                <DialogTitle className="text-xl">
                  {selectedSnapshot.overallSentiment} Market Analysis
                </DialogTitle>
                <DialogDescription className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  {format(new Date(selectedSnapshot.analyzedAt), "MMMM d, yyyy 'at' HH:mm")}
                  <span className="mx-2">·</span>
                  <FileText className="h-4 w-4" />
                  Based on {selectedSnapshot.newsCount} news articles
                  <span className="mx-2">·</span>
                  {selectedSnapshot.confidence}% confidence
                </DialogDescription>
              </DialogHeader>

              {/* Featured Image in Modal */}
              <div className="relative w-full aspect-video rounded-lg overflow-hidden my-4">
                <img
                  src={marketAnalysisImage}
                  alt="Market Analysis"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                <div className="absolute bottom-4 left-4 text-white">
                  <div className="text-sm opacity-80">Market Update</div>
                  <div className="text-lg font-semibold">
                    {format(new Date(selectedSnapshot.analyzedAt), "MMMM d, yyyy")}
                  </div>
                </div>
              </div>

              {/* Article Content */}
              {selectedSnapshot.generatedArticle ? (
                <div className="prose dark:prose-invert max-w-none">
                  {selectedSnapshot.generatedArticle.split('\n\n').map((paragraph, idx) => (
                    <p key={idx} className="text-justify mb-4 leading-relaxed">
                      {paragraph}
                    </p>
                  ))}
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium mb-2">Summary</h4>
                    <p className="text-muted-foreground">{selectedSnapshot.summary}</p>
                  </div>
                  
                  {selectedSnapshot.keyFactors && (
                    <div>
                      <h4 className="font-medium mb-2">Key Factors</h4>
                      <ul className="list-disc list-inside space-y-1">
                        {JSON.parse(selectedSnapshot.keyFactors).map((factor: string, idx: number) => (
                          <li key={idx} className="text-muted-foreground">{factor}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  
                  {selectedSnapshot.tradingRecommendation && (
                    <div>
                      <h4 className="font-medium mb-2">Trading Recommendation</h4>
                      <p className="text-muted-foreground">{selectedSnapshot.tradingRecommendation}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Affected Symbols */}
              {selectedSnapshot.affectedSymbols && (
                <div className="mt-4 pt-4 border-t">
                  <h4 className="font-medium mb-2">Affected Symbols</h4>
                  <div className="flex flex-wrap gap-2">
                    {JSON.parse(selectedSnapshot.affectedSymbols).map((item: AffectedSymbol, idx: number) => (
                      <div key={idx} className="flex items-center gap-1">
                        <Badge variant="outline" className="font-mono">
                          {item.symbol}
                        </Badge>
                        <ImpactBadge impact={item.impact} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
