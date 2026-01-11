import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { Link, useLocation } from "wouter";
import { TrendingUp, TrendingDown, Minus, Clock, ArrowRight, BarChart3, LogIn, Newspaper, ChevronRight, ChevronLeft, LayoutDashboard, X, AlertTriangle, Target, FileText, Share2, Link2, Check, User, Mail, Lock, UserPlus } from "lucide-react";
import { SiFacebook, SiX, SiWhatsapp, SiTelegram } from "react-icons/si";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth-context";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogHeader } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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
  keyFactors?: string;
  affectedSymbols?: string;
  tradingRecommendation?: string;
  imageUrl?: string;
}

interface FullArticle extends NewsSnapshot {
  keyFactorsParsed: string[];
  affectedSymbolsParsed: Array<{
    symbol: string;
    impact: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
    reason: string;
  }>;
}

interface SymbolPrice {
  symbol: string;
  displayName: string;
  price: number;
  change?: number;
  changePercent?: number;
  currency: string;
}

interface LogoSettings {
  logoPath: string | null;
  logoIconPath: string | null;
}

// Extract relevant keywords from article content for SEO meta tags
function extractKeywords(article: NewsSnapshot | null): string {
  if (!article) return "trading, market analysis, forex, stocks, cryptocurrency, investment";
  
  // Stop words to filter out
  const stopWords = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with",
    "by", "from", "as", "is", "was", "are", "were", "been", "be", "have", "has", "had",
    "do", "does", "did", "will", "would", "could", "should", "may", "might", "must",
    "shall", "can", "need", "dare", "ought", "used", "this", "that", "these", "those",
    "i", "you", "he", "she", "it", "we", "they", "what", "which", "who", "whom",
    "its", "his", "her", "their", "our", "my", "your", "than", "then", "so", "if",
    "when", "where", "why", "how", "all", "each", "every", "both", "few", "more",
    "most", "other", "some", "such", "no", "nor", "not", "only", "own", "same",
    "too", "very", "just", "also", "now", "here", "there", "about", "into", "over",
    "after", "before", "between", "under", "again", "further", "once", "during"
  ]);
  
  // Combine headline, summary, and keyFactors for text analysis
  const text = [
    article.headline || "",
    article.summary || "",
    article.keyFactors || ""
  ].join(" ").toLowerCase();
  
  // Extract words (alphanumeric only, 3+ chars)
  const words = text.match(/\b[a-z]{3,}\b/g) || [];
  
  // Count word frequency
  const wordCounts = new Map<string, number>();
  words.forEach(word => {
    if (!stopWords.has(word)) {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }
  });
  
  // Sort by frequency and take top keywords
  const topKeywords = Array.from(wordCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([word]) => word);
  
  // Add some common trading keywords
  const baseKeywords = ["trading", "market", "analysis", "investment"];
  const allKeywords = Array.from(new Set([...topKeywords, ...baseKeywords]));
  
  return allKeywords.slice(0, 20).join(", ");
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

// Inline share button for article cards (compact popover version)
function InlineShareButton({ headline, summary, articleId, imageUrl }: { headline: string; summary: string; articleId: number; imageUrl?: string }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const shareUrl = `${baseUrl}/?article=${articleId}`;
  const shareTitle = headline || "Market Analysis";
  // Enhanced share text with more context for social engagement
  const shareText = `${shareTitle}\n\n${summary.slice(0, 150)}...\n\nRead more on Trady:`;
  
  const encodedUrl = encodeURIComponent(shareUrl);
  const encodedText = encodeURIComponent(shareText);
  const encodedImage = imageUrl ? encodeURIComponent(imageUrl) : "";
  
  const handleCopyLink = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        setOpen(false);
      }, 1500);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };
  
  const handleShareClick = (url: string, e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(url, "_blank", "noopener,noreferrer,width=600,height=400");
    setOpen(false);
  };
  
  const shareLinks = [
    { name: "Facebook", icon: SiFacebook, url: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`, color: "text-[#1877F2]" },
    { name: "X", icon: SiX, url: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedText}`, color: "text-foreground" },
    { name: "WhatsApp", icon: SiWhatsapp, url: `https://wa.me/?text=${encodedText}%20${encodedUrl}`, color: "text-[#25D366]" },
    { name: "Telegram", icon: SiTelegram, url: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`, color: "text-[#0088CC]" },
  ];
  
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!open);
          }}
          data-testid={`button-inline-share-${articleId}`}
        >
          <Share2 className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="end" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1">
          {shareLinks.map((link) => (
            <Button
              key={link.name}
              variant="ghost"
              size="icon"
              className={`h-8 w-8 ${link.color}`}
              onClick={(e) => handleShareClick(link.url, e)}
              title={`Share on ${link.name}`}
              data-testid={`button-inline-share-${link.name.toLowerCase()}-${articleId}`}
            >
              <link.icon className="h-4 w-4" />
            </Button>
          ))}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleCopyLink}
            title="Copy link"
            data-testid={`button-inline-copy-${articleId}`}
          >
            {copied ? <Check className="h-4 w-4 text-green-500" /> : <Link2 className="h-4 w-4" />}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Share buttons component for social media sharing
function ShareButtons({ headline, summary, articleId, imageUrl }: { headline: string; summary: string; articleId: number; imageUrl?: string }) {
  const [copied, setCopied] = useState(false);
  
  // Build share URL - use window location with article hash for deep linking
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const shareUrl = `${baseUrl}/?article=${articleId}`;
  const shareTitle = headline || "Market Analysis";
  // Enhanced share text with article summary for better engagement
  const shareText = `${shareTitle}\n\n${summary.slice(0, 150)}...\n\nGet market insights on Trady:`;
  
  const encodedUrl = encodeURIComponent(shareUrl);
  const encodedTitle = encodeURIComponent(shareTitle);
  const encodedText = encodeURIComponent(shareText);
  const encodedImage = imageUrl ? encodeURIComponent(imageUrl) : "";
  
  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };
  
  const shareLinks = [
    {
      name: "Facebook",
      icon: SiFacebook,
      url: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodedTitle}`,
      color: "hover:bg-[#1877F2]/10 hover:text-[#1877F2]",
      testId: "button-share-facebook"
    },
    {
      name: "X (Twitter)",
      icon: SiX,
      url: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedText}`,
      color: "hover:bg-foreground/10 hover:text-foreground",
      testId: "button-share-twitter"
    },
    {
      name: "WhatsApp",
      icon: SiWhatsapp,
      url: `https://wa.me/?text=${encodedText}%20${encodedUrl}`,
      color: "hover:bg-[#25D366]/10 hover:text-[#25D366]",
      testId: "button-share-whatsapp"
    },
    {
      name: "Telegram",
      icon: SiTelegram,
      url: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`,
      color: "hover:bg-[#0088CC]/10 hover:text-[#0088CC]",
      testId: "button-share-telegram"
    }
  ];
  
  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-1 text-sm text-muted-foreground">
        <Share2 className="h-4 w-4" />
        Share:
      </span>
      <div className="flex items-center gap-1">
        {shareLinks.map((link) => (
          <Button
            key={link.name}
            variant="ghost"
            size="icon"
            className={`h-8 w-8 ${link.color}`}
            onClick={() => window.open(link.url, "_blank", "noopener,noreferrer,width=600,height=400")}
            title={`Share on ${link.name}`}
            data-testid={link.testId}
          >
            <link.icon className="h-4 w-4" />
          </Button>
        ))}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 hover:bg-primary/10 hover:text-primary"
          onClick={handleCopyLink}
          title="Copy link"
          data-testid="button-share-copy"
        >
          {copied ? <Check className="h-4 w-4 text-green-500" /> : <Link2 className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

function formatPrice(price: number, currency: string): string {
  if (currency === "IDR") {
    return `Rp ${price.toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }
  return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Financial keywords mapping for relevant image search
const KEYWORD_MAPPINGS: Record<string, string> = {
  gold: "gold-bars,gold-investment",
  silver: "silver-coins,precious-metals",
  bitcoin: "bitcoin,cryptocurrency",
  crypto: "cryptocurrency,blockchain",
  btc: "bitcoin,digital-currency",
  stock: "stock-market,trading",
  market: "financial-market,wall-street",
  trading: "stock-trading,charts",
  inflation: "inflation,economy",
  recession: "recession,economic",
  economy: "economy,business",
  fed: "federal-reserve,banking",
  oil: "oil-barrel,petroleum",
  energy: "energy,power",
  bull: "bull-market,growth",
  bear: "bear-market,decline",
  tech: "technology,startup",
  mining: "gold-mining,mining",
  bank: "banking,finance",
};

// Generate unique image URL based on article content using Unsplash
function generateArticleImage(article: { id?: number; headline?: string; summary?: string; overallSentiment?: string }): string {
  const text = (article.headline || article.summary || "market").toLowerCase();
  
  // Extract keywords from headline for relevant image search
  const keywords: string[] = [];
  for (const [keyword, searchTerms] of Object.entries(KEYWORD_MAPPINGS)) {
    if (text.includes(keyword)) {
      keywords.push(searchTerms.split(",")[0]);
      if (keywords.length >= 2) break;
    }
  }
  
  // Default to finance keywords if none found
  if (keywords.length === 0) {
    keywords.push("finance", "stock-market");
  }
  
  // Use article ID or hash of headline for unique image per article
  const stableId = article.id || Math.abs(text.split("").reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0));
  
  // Use Unsplash Source API for relevant stock images based on keywords
  const keywordQuery = keywords.join(",");
  return `https://source.unsplash.com/800x450/?${encodeURIComponent(keywordQuery)}&sig=${stableId}`;
}

interface PaginatedNewsHistory {
  snapshots: NewsSnapshot[];
  total: number;
  totalPages: number;
  currentPage: number;
}

export default function PublicNewsPage() {
  const { user, refreshAuth } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const isLoggedIn = !!user;
  const [selectedArticleId, setSelectedArticleId] = useState<number | null>(null);
  const [pastArticlesPage, setPastArticlesPage] = useState(1);
  const ARTICLES_PER_PAGE = 6;
  
  // Login/Signup form state
  const [showSignupModal, setShowSignupModal] = useState(false);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [signupUsername, setSignupUsername] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirmPassword, setSignupConfirmPassword] = useState("");
  
  // Login mutation
  const loginMutation = useMutation({
    mutationFn: async ({ username, password }: { username: string; password: string }) => {
      const response = await apiRequest("POST", "/api/auth/login", { username, password });
      return response.json();
    },
    onSuccess: (data) => {
      // Set localStorage first and verify it's saved
      const userData = JSON.stringify(data.user);
      localStorage.setItem("user", userData);
      
      toast({ title: "Login successful", description: "Welcome back!" });
      setLoginUsername("");
      setLoginPassword("");
      
      // Use setTimeout to ensure localStorage write completes before navigation
      setTimeout(() => {
        window.location.href = "/dashboard";
      }, 100);
    },
    onError: (error: any) => {
      const message = error.message?.includes("pending") 
        ? "Your account is pending admin approval" 
        : error.message?.includes("rejected")
          ? "Your registration was rejected"
          : "Invalid username or password";
      toast({ title: "Login failed", description: message, variant: "destructive" });
    },
  });
  
  // Signup mutation
  const signupMutation = useMutation({
    mutationFn: async ({ username, email, password }: { username: string; email: string; password: string }) => {
      const response = await apiRequest("POST", "/api/auth/signup", { username, email, password });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Registration submitted",
        description: data.message || "Your account is pending admin approval. You'll be notified when approved.",
      });
      setShowSignupModal(false);
      setSignupUsername("");
      setSignupEmail("");
      setSignupPassword("");
      setSignupConfirmPassword("");
    },
    onError: (error: any) => {
      toast({
        title: "Registration failed",
        description: error.message || "Could not create account",
        variant: "destructive",
      });
    },
  });
  
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginUsername.trim() || !loginPassword.trim()) {
      toast({ title: "Error", description: "Please enter username and password", variant: "destructive" });
      return;
    }
    loginMutation.mutate({ username: loginUsername, password: loginPassword });
  };
  
  const handleSignup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!signupUsername.trim() || !signupPassword.trim()) {
      toast({ title: "Error", description: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    if (signupPassword.length < 6) {
      toast({ title: "Error", description: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }
    if (signupPassword !== signupConfirmPassword) {
      toast({ title: "Error", description: "Passwords do not match", variant: "destructive" });
      return;
    }
    signupMutation.mutate({ username: signupUsername, email: signupEmail, password: signupPassword });
  };

  const { data: currentAnalysis, isLoading: isLoadingAnalysis } = useQuery<{ marketPrediction: MarketPrediction }>({
    queryKey: ["/api/public/news/current"],
    refetchInterval: 60000,
  });

  const { data: newsHistory, isLoading: isLoadingHistory } = useQuery<PaginatedNewsHistory>({
    queryKey: ["/api/public/news/history", pastArticlesPage],
    queryFn: async () => {
      const res = await fetch(`/api/public/news/history?page=${pastArticlesPage}&limit=${ARTICLES_PER_PAGE}`);
      if (!res.ok) throw new Error("Failed to fetch news history");
      return res.json();
    },
    refetchInterval: 120000,
  });

  const { data: marketPrices, isLoading: isLoadingPrices } = useQuery<{ prices: SymbolPrice[] }>({
    queryKey: ["/api/public/prices"],
    refetchInterval: 30000,
  });

  // Fetch selected article details
  const { data: selectedArticleData, isLoading: isLoadingArticle } = useQuery<{ snapshot: NewsSnapshot }>({
    queryKey: [`/api/public/news/${selectedArticleId}`],
    enabled: selectedArticleId !== null,
  });

  // Fetch custom logo settings
  const { data: logoSettings } = useQuery<LogoSettings>({
    queryKey: ["/api/public/logo"],
    staleTime: 60000,
  });

  // Determine which logo to display - prefer custom, fallback to default
  const iconLogo = logoSettings?.logoIconPath || "/trady-icon.jpg";
  const fullLogo = logoSettings?.logoPath || "/trady-logo.jpg";

  const prediction = currentAnalysis?.marketPrediction;
  const snapshots = newsHistory?.snapshots || [];
  const totalPages = newsHistory?.totalPages || 1;
  const prices = marketPrices?.prices || [];

  // Get the latest article for dynamic meta tags
  const latestArticle = snapshots.length > 0 ? snapshots[0] : null;

  // Dynamic SEO meta tags based on article content
  useEffect(() => {
    const activeArticle = selectedArticleData?.snapshot || latestArticle;
    const headline = activeArticle?.headline;
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    
    // Update page title - SEO optimized with primary keyword
    if (headline) {
      document.title = `${headline} | Trady - Global Market Trading News & Analysis`;
    } else {
      document.title = "Trady - Global Market Trading News | AI-Powered Trading Insights & Analysis";
    }

    // Update meta keywords - extracted from article content
    const keywords = extractKeywords(activeArticle);
    
    const updateOrCreateMeta = (selector: string, attrName: string, attrValue: string, content: string) => {
      let meta = document.querySelector(selector);
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute(attrName, attrValue);
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', content);
    };
    
    updateOrCreateMeta('meta[name="keywords"]', 'name', 'keywords', keywords);

    // SEO-friendly meta description - summarize key trading insights
    const sentimentText = activeArticle?.overallSentiment === "BULLISH" ? "bullish outlook" : 
                          activeArticle?.overallSentiment === "BEARISH" ? "bearish outlook" : "neutral stance";
    const description = activeArticle?.summary 
      ? `${activeArticle.summary.slice(0, 140)} Market shows ${sentimentText}. Get real-time trading insights.`
      : "Get AI-powered market analysis, real-time trading news, and expert insights. Trady delivers global market updates for forex, stocks, and cryptocurrency traders.";
    
    updateOrCreateMeta('meta[name="description"]', 'name', 'description', description);
    
    // Additional SEO meta tags
    updateOrCreateMeta('meta[name="robots"]', 'name', 'robots', 'index, follow, max-image-preview:large');
    updateOrCreateMeta('meta[name="author"]', 'name', 'author', 'Trady Market Analysis');
    updateOrCreateMeta('meta[name="publisher"]', 'name', 'publisher', 'Trady');

    // Open Graph tags for social sharing
    const ogTitle = headline || "Trady - Global Market Trading News";
    updateOrCreateMeta('meta[property="og:title"]', 'property', 'og:title', ogTitle);
    updateOrCreateMeta('meta[property="og:description"]', 'property', 'og:description', description);
    updateOrCreateMeta('meta[property="og:type"]', 'property', 'og:type', 'article');
    updateOrCreateMeta('meta[property="og:site_name"]', 'property', 'og:site_name', 'Trady');
    
    // Dynamic OG URL for article deep linking
    const articleUrl = activeArticle?.id ? `${baseUrl}/?article=${activeArticle.id}` : baseUrl;
    updateOrCreateMeta('meta[property="og:url"]', 'property', 'og:url', articleUrl);
    
    // OG Image - use article image or generate one
    const articleImage = activeArticle?.imageUrl || 
      (activeArticle ? generateArticleImage(activeArticle) : `${baseUrl}/trady-logo.jpg`);
    updateOrCreateMeta('meta[property="og:image"]', 'property', 'og:image', articleImage);
    updateOrCreateMeta('meta[property="og:image:width"]', 'property', 'og:image:width', '1200');
    updateOrCreateMeta('meta[property="og:image:height"]', 'property', 'og:image:height', '630');
    updateOrCreateMeta('meta[property="og:image:alt"]', 'property', 'og:image:alt', ogTitle);
    
    // Twitter Card tags for better Twitter sharing
    updateOrCreateMeta('meta[name="twitter:card"]', 'name', 'twitter:card', 'summary_large_image');
    updateOrCreateMeta('meta[name="twitter:title"]', 'name', 'twitter:title', ogTitle);
    updateOrCreateMeta('meta[name="twitter:description"]', 'name', 'twitter:description', description);
    updateOrCreateMeta('meta[name="twitter:image"]', 'name', 'twitter:image', articleImage);
    
    // Article-specific meta tags
    if (activeArticle?.analyzedAt) {
      updateOrCreateMeta('meta[property="article:published_time"]', 'property', 'article:published_time', activeArticle.analyzedAt);
    }
    updateOrCreateMeta('meta[property="article:section"]', 'property', 'article:section', 'Market Analysis');
    updateOrCreateMeta('meta[property="article:tag"]', 'property', 'article:tag', 'trading, market analysis, forex, stocks');
    
  }, [latestArticle, selectedArticleData?.snapshot]);

  // Safely parse JSON fields for the selected article
  const safeParseJSON = <T,>(jsonString: string | null | undefined, fallback: T): T => {
    if (!jsonString) return fallback;
    try {
      return JSON.parse(jsonString) as T;
    } catch {
      return fallback;
    }
  };

  const selectedArticle: FullArticle | null = selectedArticleData?.snapshot ? {
    ...selectedArticleData.snapshot,
    keyFactorsParsed: safeParseJSON<string[]>(selectedArticleData.snapshot.keyFactors, []),
    affectedSymbolsParsed: safeParseJSON<Array<{ symbol: string; impact: "POSITIVE" | "NEGATIVE" | "NEUTRAL"; reason: string }>>(
      selectedArticleData.snapshot.affectedSymbols, 
      []
    ),
  } : null;

  const handleArticleClick = (id: number) => {
    setSelectedArticleId(id);
  };

  const handleCloseModal = () => {
    setSelectedArticleId(null);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4">
          {/* Upper nav */}
          <div className="flex h-14 items-center justify-between">
            <div className="flex items-center gap-3">
              <img 
                src={fullLogo} 
                alt="Trady" 
                className="h-10 rounded-md object-contain"
                onError={(e) => { e.currentTarget.src = "/trady-logo.jpg"; }}
              />
              <span className="hidden text-sm text-muted-foreground md:inline-block">Global Market Trading News</span>
            </div>
            
            <div className="flex items-center gap-2">
              {isLoggedIn ? (
                <Link href="/dashboard">
                  <Button variant="default" size="sm" data-testid="button-dashboard">
                    <LayoutDashboard className="mr-2 h-4 w-4" />
                    Dashboard
                  </Button>
                </Link>
              ) : (
                <Link href="/login">
                  <Button variant="outline" size="sm" data-testid="button-login">
                    <LogIn className="mr-2 h-4 w-4" />
                    Sign In
                  </Button>
                </Link>
              )}
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
                {/* Featured Image - Clickable to open modal */}
                <div 
                  className="relative mb-4 overflow-hidden rounded-lg cursor-pointer"
                  onClick={() => snapshots[0]?.id && handleArticleClick(snapshots[0].id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && snapshots[0]?.id && handleArticleClick(snapshots[0].id)}
                  data-testid="button-featured-article"
                >
                  <img
                    src={snapshots[0]?.imageUrl || generateArticleImage({ id: snapshots[0]?.id, headline: prediction.headline, summary: prediction.summary })}
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
                <p className="mb-4 text-lg text-muted-foreground leading-relaxed text-justify" data-testid="text-summary-featured">
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

          {/* Right Sidebar - Login + Trends */}
          <div className="space-y-4">
            {/* Login Card - only show if not logged in */}
            {!isLoggedIn && (
              <Card className="border-primary/20" data-testid="card-login">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <LogIn className="h-4 w-4" />
                    Member Login
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Access full trading dashboard
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <form onSubmit={handleLogin} className="space-y-3">
                    <div className="space-y-1">
                      <Label htmlFor="login-username" className="text-xs">Username</Label>
                      <div className="relative">
                        <User className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="login-username"
                          type="text"
                          placeholder="Enter username"
                          value={loginUsername}
                          onChange={(e) => setLoginUsername(e.target.value)}
                          className="pl-8 h-9 text-sm"
                          data-testid="input-login-username"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="login-password" className="text-xs">Password</Label>
                      <div className="relative">
                        <Lock className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="login-password"
                          type="password"
                          placeholder="Enter password"
                          value={loginPassword}
                          onChange={(e) => setLoginPassword(e.target.value)}
                          className="pl-8 h-9 text-sm"
                          data-testid="input-login-password"
                        />
                      </div>
                    </div>
                    <Button 
                      type="submit" 
                      className="w-full"
                      disabled={loginMutation.isPending}
                      data-testid="button-login-submit"
                    >
                      {loginMutation.isPending ? "Signing in..." : "Sign In"}
                    </Button>
                  </form>
                  <Separator className="my-3" />
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground mb-2">Don't have an account?</p>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full"
                      onClick={() => setShowSignupModal(true)}
                      data-testid="button-open-signup"
                    >
                      <UserPlus className="mr-2 h-4 w-4" />
                      Create Account
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Trends Section */}
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Trends</h2>
              <Link href="/login">
                <Button variant="ghost" size="sm" className="text-primary" data-testid="button-view-all-symbols">
                  View All <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </Link>
            </div>
            
            {isLoadingAnalysis ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <Skeleton className="mb-2 h-5 w-16" />
                    <Skeleton className="mb-2 h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </CardContent>
                </Card>
              ))
            ) : prediction && prediction.affectedSymbols.length > 0 ? (
              prediction.affectedSymbols.map((symbol, index) => (
                <Card 
                  key={`${symbol.symbol}-${index}`} 
                  className="transition-colors hover-elevate"
                  data-testid={`impact-card-${symbol.symbol}`}
                >
                  <CardContent className="p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <SentimentIcon sentiment={symbol.impact === "POSITIVE" ? "BULLISH" : symbol.impact === "NEGATIVE" ? "BEARISH" : "NEUTRAL"} />
                        <span className="font-bold">{symbol.symbol}</span>
                      </div>
                      <Badge 
                        variant="outline" 
                        className={`text-xs ${
                          symbol.impact === "POSITIVE" 
                            ? "border-green-500/50 text-green-600 dark:text-green-400" 
                            : symbol.impact === "NEGATIVE" 
                              ? "border-red-500/50 text-red-600 dark:text-red-400" 
                              : "border-yellow-500/50 text-yellow-600 dark:text-yellow-400"
                        }`}
                      >
                        {symbol.impact}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-3">
                      {symbol.reason}
                    </p>
                  </CardContent>
                </Card>
              ))
            ) : (
              <div className="flex h-40 items-center justify-center rounded-lg border border-dashed">
                <p className="text-sm text-muted-foreground">No trends data available</p>
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

        {/* Past Articles Section with Pagination */}
        <section className="mt-8">
          <h2 className="mb-4 text-xl font-bold">Past Market Analysis</h2>
          
          {isLoadingHistory ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <Skeleton className="mb-2 h-4 w-24" />
                    <Skeleton className="mb-2 h-6 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : snapshots.length > 0 ? (
            <>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {snapshots.map((snapshot) => (
                  <Card 
                    key={snapshot.id} 
                    className="hover-elevate cursor-pointer overflow-hidden" 
                    data-testid={`past-article-${snapshot.id}`}
                    onClick={() => handleArticleClick(snapshot.id)}
                  >
                    {/* Thumbnail Image */}
                    <div className="relative h-32 overflow-hidden">
                      <img
                        src={snapshot.imageUrl || generateArticleImage(snapshot)}
                        alt={snapshot.headline || "Market Analysis"}
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                      <Badge 
                        variant={snapshot.overallSentiment === "BULLISH" ? "default" : snapshot.overallSentiment === "BEARISH" ? "destructive" : "secondary"}
                        className="absolute bottom-2 left-2"
                      >
                        {snapshot.overallSentiment}
                      </Badge>
                    </div>
                    <CardContent className="p-4">
                      <div className="mb-2 flex items-center gap-2">
                        <SentimentIcon sentiment={snapshot.overallSentiment} />
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(snapshot.analyzedAt), "MMM d, yyyy")}
                        </span>
                      </div>
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <h3 className="font-semibold leading-tight line-clamp-2">
                          {snapshot.headline || `${snapshot.overallSentiment} Market Outlook`}
                        </h3>
                        <InlineShareButton 
                          headline={snapshot.headline || `${snapshot.overallSentiment} Market Outlook`}
                          summary={snapshot.summary}
                          articleId={snapshot.id}
                          imageUrl={snapshot.imageUrl || generateArticleImage(snapshot)}
                        />
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2 text-justify">
                        {snapshot.summary}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
              
              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="mt-6 flex items-center justify-center gap-2" data-testid="pagination-controls">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setPastArticlesPage(p => Math.max(1, p - 1))}
                    disabled={pastArticlesPage === 1}
                    data-testid="button-prev-page"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum: number;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (pastArticlesPage <= 3) {
                      pageNum = i + 1;
                    } else if (pastArticlesPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = pastArticlesPage - 2 + i;
                    }
                    return (
                      <Button
                        key={pageNum}
                        variant={pastArticlesPage === pageNum ? "default" : "outline"}
                        size="icon"
                        onClick={() => setPastArticlesPage(pageNum)}
                        data-testid={`button-page-${pageNum}`}
                      >
                        {pageNum}
                      </Button>
                    );
                  })}
                  
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setPastArticlesPage(p => Math.min(totalPages, p + 1))}
                    disabled={pastArticlesPage === totalPages}
                    data-testid="button-next-page"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="flex h-40 items-center justify-center rounded-lg border border-dashed">
              <p className="text-muted-foreground">No past articles available</p>
            </div>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="mt-12 border-t bg-muted/50 py-8">
        <div className="container mx-auto px-4 text-center">
          <div className="flex items-center justify-center gap-2 text-lg font-bold">
            <img 
              src={iconLogo} 
              alt="Trady" 
              className="h-5 w-5 object-contain"
              onError={(e) => { e.currentTarget.src = "/trady-icon.jpg"; }}
            />
            Trady
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Global Market Trading News - AI-powered trading insights
          </p>
          <p className="mt-4 text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} Trady. All rights reserved.
          </p>
        </div>
      </footer>

      {/* Signup Modal */}
      <Dialog open={showSignupModal} onOpenChange={setShowSignupModal}>
        <DialogContent className="max-w-md" data-testid="modal-signup">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Create Account
            </DialogTitle>
            <DialogDescription>
              Register for a new account. Your registration will be reviewed by an administrator.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSignup} className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="signup-username">Username *</Label>
              <div className="relative">
                <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="signup-username"
                  type="text"
                  placeholder="Choose a username"
                  value={signupUsername}
                  onChange={(e) => setSignupUsername(e.target.value)}
                  className="pl-9"
                  required
                  data-testid="input-signup-username"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="signup-email">Email (optional)</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="signup-email"
                  type="email"
                  placeholder="your@email.com"
                  value={signupEmail}
                  onChange={(e) => setSignupEmail(e.target.value)}
                  className="pl-9"
                  data-testid="input-signup-email"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="signup-password">Password *</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="signup-password"
                  type="password"
                  placeholder="Minimum 6 characters"
                  value={signupPassword}
                  onChange={(e) => setSignupPassword(e.target.value)}
                  className="pl-9"
                  required
                  minLength={6}
                  data-testid="input-signup-password"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="signup-confirm-password">Confirm Password *</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="signup-confirm-password"
                  type="password"
                  placeholder="Repeat your password"
                  value={signupConfirmPassword}
                  onChange={(e) => setSignupConfirmPassword(e.target.value)}
                  className="pl-9"
                  required
                  data-testid="input-signup-confirm-password"
                />
              </div>
            </div>
            <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
              <AlertTriangle className="inline-block h-4 w-4 mr-2 text-yellow-500" />
              New accounts require admin approval before you can log in.
            </div>
            <div className="flex gap-3 pt-2">
              <Button 
                type="button" 
                variant="outline" 
                className="flex-1"
                onClick={() => setShowSignupModal(false)}
                data-testid="button-cancel-signup"
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                className="flex-1"
                disabled={signupMutation.isPending}
                data-testid="button-submit-signup"
              >
                {signupMutation.isPending ? "Creating..." : "Create Account"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Article Modal */}
      <Dialog open={selectedArticleId !== null} onOpenChange={(open) => !open && handleCloseModal()}>
        <DialogContent className="max-w-3xl max-h-[90vh] p-0" data-testid="modal-article">
          <VisuallyHidden>
            <DialogTitle>Article Details</DialogTitle>
          </VisuallyHidden>
          {isLoadingArticle ? (
            <div className="p-6 space-y-4">
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-48 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : selectedArticle ? (
            <ScrollArea className="max-h-[85vh]">
              <div className="p-6">
                {/* Header with Image */}
                <div className="relative mb-6 overflow-hidden rounded-lg">
                  <img
                    src={selectedArticle.imageUrl || generateArticleImage(selectedArticle)}
                    alt="Market Analysis"
                    className="aspect-video w-full object-cover"
                    data-testid="img-modal-article"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-4">
                    <Badge 
                      variant={selectedArticle.overallSentiment === "BULLISH" ? "default" : selectedArticle.overallSentiment === "BEARISH" ? "destructive" : "secondary"}
                      className="mb-2"
                    >
                      {selectedArticle.overallSentiment} Market
                    </Badge>
                    <h2 className="text-xl font-bold text-white md:text-2xl" data-testid="text-modal-headline">
                      {selectedArticle.headline || `${selectedArticle.overallSentiment} Market Analysis`}
                    </h2>
                    <div className="mt-2 flex items-center gap-4 text-white/80 text-sm">
                      <span className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        {format(new Date(selectedArticle.analyzedAt), "MMMM d, yyyy 'at' HH:mm")}
                      </span>
                      <span>Confidence: {selectedArticle.confidence}%</span>
                    </div>
                  </div>
                </div>

                {/* Share Buttons */}
                <div className="mb-4 flex justify-end" data-testid="share-buttons-container">
                  <ShareButtons 
                    headline={selectedArticle.headline || `${selectedArticle.overallSentiment} Market Analysis`}
                    summary={selectedArticle.summary}
                    articleId={selectedArticle.id}
                    imageUrl={selectedArticle.imageUrl || generateArticleImage(selectedArticle)}
                  />
                </div>

                {/* Quick Summary */}
                <div className="mb-6">
                  <h3 className="mb-2 flex items-center gap-2 text-lg font-semibold">
                    <FileText className="h-5 w-5 text-primary" />
                    Quick Summary
                  </h3>
                  <p className="text-muted-foreground leading-relaxed text-justify" data-testid="text-modal-summary">
                    {selectedArticle.summary}
                  </p>
                </div>

                <Separator className="my-4" />

                {/* Full Article */}
                {selectedArticle.generatedArticle && (
                  <div className="mb-6">
                    <h3 className="mb-3 text-lg font-semibold">Full Analysis</h3>
                    <div className="prose prose-sm dark:prose-invert max-w-none" data-testid="text-modal-article">
                      {selectedArticle.generatedArticle.split('\n').map((paragraph, i) => (
                        paragraph.trim() && <p key={i} className="mb-3 text-muted-foreground text-justify">{paragraph}</p>
                      ))}
                    </div>
                  </div>
                )}

                {/* Key Factors */}
                {selectedArticle.keyFactorsParsed.length > 0 && (
                  <div className="mb-6">
                    <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                      <ChevronRight className="h-5 w-5 text-primary" />
                      Key Market Factors
                    </h3>
                    <ul className="space-y-2">
                      {selectedArticle.keyFactorsParsed.map((factor, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground" data-testid={`text-modal-factor-${i}`}>
                          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          {factor}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <Separator className="my-4" />

                {/* Trading Recommendation */}
                {selectedArticle.tradingRecommendation && (
                  <div className="mb-6">
                    <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                      <Target className="h-5 w-5 text-primary" />
                      Trading Recommendation
                    </h3>
                    <Card className="border-primary/20 bg-primary/5">
                      <CardContent className="p-4">
                        <p className="text-sm" data-testid="text-modal-recommendation">
                          {selectedArticle.tradingRecommendation}
                        </p>
                      </CardContent>
                    </Card>
                  </div>
                )}

                {/* Risk Level */}
                {selectedArticle.riskLevel && (
                  <div className="mb-6">
                    <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                      <AlertTriangle className="h-5 w-5 text-primary" />
                      Risk Assessment
                    </h3>
                    <Badge 
                      variant={selectedArticle.riskLevel === "LOW" ? "default" : selectedArticle.riskLevel === "HIGH" ? "destructive" : "secondary"}
                      className="text-sm"
                      data-testid="badge-modal-risk"
                    >
                      {selectedArticle.riskLevel} Risk
                    </Badge>
                  </div>
                )}

                {/* Trends */}
                {selectedArticle.affectedSymbolsParsed.length > 0 && (
                  <div className="mb-4">
                    <h3 className="mb-3 text-lg font-semibold">Trends</h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {selectedArticle.affectedSymbolsParsed.map((s, i) => (
                        <Card key={i} className="border-l-4" style={{ borderLeftColor: s.impact === "POSITIVE" ? "rgb(34 197 94)" : s.impact === "NEGATIVE" ? "rgb(239 68 68)" : "rgb(234 179 8)" }}>
                          <CardContent className="p-3">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-bold" data-testid={`text-modal-symbol-${s.symbol}`}>{s.symbol}</span>
                              <Badge 
                                variant="outline"
                                className={s.impact === "POSITIVE" ? "border-green-500/50 text-green-600 dark:text-green-400" : s.impact === "NEGATIVE" ? "border-red-500/50 text-red-600 dark:text-red-400" : ""}
                              >
                                <SentimentIcon sentiment={s.impact === "POSITIVE" ? "BULLISH" : s.impact === "NEGATIVE" ? "BEARISH" : "NEUTRAL"} />
                                <span className="ml-1">{s.impact}</span>
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">{s.reason}</p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          ) : (
            <div className="flex h-40 items-center justify-center">
              <p className="text-muted-foreground">Article not found</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
