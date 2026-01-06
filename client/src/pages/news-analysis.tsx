import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
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
  Calendar
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

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
  const pageSize = 15;

  const { data: analysis, isLoading: analysisLoading, isFetching: analysisFetching, refetch } = useQuery<NewsAnalysis>({
    queryKey: ["/api/news/analysis"],
    refetchInterval: 5 * 60 * 1000,
    staleTime: 2 * 60 * 1000,
  });

  const { data: paginatedNews, isLoading: newsLoading, refetch: refetchNews } = useQuery<PaginatedNewsResponse>({
    queryKey: [`/api/news/articles?page=${currentPage}&pageSize=${pageSize}&daysBack=7`],
    refetchInterval: 60 * 1000,
  });

  const handleRefresh = () => {
    setCurrentPage(1);
    queryClient.invalidateQueries({ queryKey: ["/api/news/analysis"] });
    queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0] || '').startsWith('/api/news/articles') });
    refetch();
    refetchNews();
  };

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
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
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <Skeleton className="h-6 w-48" />
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
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-36" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-24 w-full" />
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

      <div className="grid gap-6 lg:grid-cols-3">
        {/* AI Market Prediction */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-purple-500" />
              <CardTitle>AI Market Prediction</CardTitle>
            </div>
            <CardDescription>
              OpenAI analysis of {pagination?.total || analysis?.newsCount || 0} news articles (last 7 days)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {analysis?.marketPrediction ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">Sentiment:</span>
                  <SentimentBadge sentiment={analysis.marketPrediction.overallSentiment} />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">Confidence:</span>
                  <Badge variant="outline">
                    {analysis.marketPrediction.confidence}%
                  </Badge>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">Risk Level:</span>
                  <RiskBadge risk={analysis.marketPrediction.riskLevel} />
                </div>

                <Separator />

                <div className="space-y-2">
                  <h4 className="text-sm font-medium">Summary</h4>
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
                      <div className="space-y-2">
                        {analysis.marketPrediction.affectedSymbols.map((item, idx) => (
                          <div key={idx} className="flex flex-wrap items-start gap-2 text-sm">
                            <Badge variant="outline" className="font-mono">
                              {item.symbol}
                            </Badge>
                            <ImpactBadge impact={item.impact} />
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
        <Card className="lg:col-span-2">
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
      </div>
    </div>
  );
}
