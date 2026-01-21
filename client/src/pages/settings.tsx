import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Settings, Key, CheckCircle, AlertCircle, Info, Loader2, Eye, EyeOff, Bot, Rss, Plus, Pencil, Trash2, TrendingUp, Upload, Image, X, RefreshCw } from "lucide-react";
import { ObjectUploader } from "@/components/ObjectUploader";
import { useUpload } from "@/hooks/use-upload";
import { LogoCropModal } from "@/components/logo-crop-modal";

interface ApiKeyStatus {
  isConfigured: boolean;
  source: string;
  maskedValue: string | null;
  isEditable?: boolean;
}

interface SettingsData {
  finnhubApiKey: ApiKeyStatus;
  openaiApiKey: ApiKeyStatus;
  rssFeedUrl: string;
}

interface RssFeed {
  id: number;
  name: string;
  url: string;
  isActive: boolean;
  priority: number;
}

interface MonitoredSymbol {
  id: number;
  symbol: string;
  displayName: string;
  category: string;
  currency: string;
  isActive: boolean;
  priority: number;
}

interface SymbolCategory {
  id: number;
  name: string;
  displayOrder: number;
  isActive: boolean;
}

export default function SettingsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isSuperadmin = user?.role === "superadmin";
  
  const [finnhubKey, setFinnhubKey] = useState("");
  const [showFinnhubKey, setShowFinnhubKey] = useState(false);
  const [openaiKey, setOpenaiKey] = useState("");
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);

  // RSS Feed Dialog State
  const [feedDialogOpen, setFeedDialogOpen] = useState(false);
  const [editingFeed, setEditingFeed] = useState<RssFeed | null>(null);
  const [feedName, setFeedName] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [feedPriority, setFeedPriority] = useState(0);

  // Symbol Dialog State
  const [symbolDialogOpen, setSymbolDialogOpen] = useState(false);
  const [editingSymbol, setEditingSymbol] = useState<MonitoredSymbol | null>(null);
  const [symbolCode, setSymbolCode] = useState("");
  const [symbolDisplayName, setSymbolDisplayName] = useState("");
  const [symbolCategory, setSymbolCategory] = useState("commodities");
  const [symbolCurrency, setSymbolCurrency] = useState("USD");
  const [symbolPriority, setSymbolPriority] = useState(0);

  // Category Dialog State
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<SymbolCategory | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [categoryDisplayOrder, setCategoryDisplayOrder] = useState(0);

  // Logo upload hook
  const { getUploadParameters, getObjectPath, uploadFile } = useUpload();

  // Logo crop modal state
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [cropImageUrl, setCropImageUrl] = useState<string | null>(null);
  const [cropType, setCropType] = useState<"full" | "icon">("full");
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

  const { data: settings, isLoading } = useQuery<SettingsData>({
    queryKey: ["/api/settings"],
    refetchInterval: false,
  });

  const { data: rssFeeds = [], isLoading: feedsLoading } = useQuery<RssFeed[]>({
    queryKey: ["/api/settings/rss-feeds"],
    enabled: isSuperadmin,
    retry: false,
  });

  const { data: symbols = [], isLoading: symbolsLoading } = useQuery<MonitoredSymbol[]>({
    queryKey: ["/api/settings/symbols"],
    enabled: isSuperadmin,
    retry: false,
  });

  const { data: categories = [], isLoading: categoriesLoading } = useQuery<SymbolCategory[]>({
    queryKey: ["/api/settings/categories"],
    enabled: isSuperadmin,
    retry: false,
  });

  // Logo settings query
  interface LogoSettings {
    logoPath: string | null;
    logoIconPath: string | null;
  }
  const { data: logoSettings, isLoading: logoLoading } = useQuery<LogoSettings>({
    queryKey: ["/api/settings/logo"],
    enabled: isSuperadmin,
    retry: false,
  });

  // Logo mutations
  const saveLogoMutation = useMutation({
    mutationFn: async (data: { logoPath?: string; logoIconPath?: string }) => {
      const response = await apiRequest("POST", "/api/settings/logo", data);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Logo saved successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/settings/logo"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const clearLogoMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("DELETE", "/api/settings/logo");
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Logo cleared" });
      queryClient.invalidateQueries({ queryKey: ["/api/settings/logo"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Logo crop handlers
  const handleLogoFileSelect = (e: React.ChangeEvent<HTMLInputElement>, type: "full" | "icon") => {
    const file = e.target.files?.[0];
    if (file) {
      const imageUrl = URL.createObjectURL(file);
      setCropImageUrl(imageUrl);
      setCropType(type);
      setCropModalOpen(true);
    }
    // Reset the input so the same file can be selected again
    e.target.value = "";
  };

  const handleCropComplete = async (croppedBlob: Blob) => {
    setIsUploadingLogo(true);
    try {
      // Create a File from the blob
      const fileName = `logo-${cropType}-${Date.now()}.png`;
      const file = new File([croppedBlob], fileName, { type: "image/png" });
      
      console.log("[Logo Upload] Starting upload for:", fileName, "Size:", croppedBlob.size);
      
      // Upload the cropped image
      const result = await uploadFile(file);
      
      console.log("[Logo Upload] Upload result:", result);
      
      if (result?.objectPath) {
        // Save the logo path
        if (cropType === "full") {
          saveLogoMutation.mutate({ logoPath: result.objectPath });
        } else {
          saveLogoMutation.mutate({ logoIconPath: result.objectPath });
        }
        toast({ 
          title: "Success", 
          description: "Logo uploaded successfully" 
        });
      } else {
        console.error("[Logo Upload] No objectPath in result");
        toast({ 
          title: "Error", 
          description: "Upload completed but no path returned", 
          variant: "destructive" 
        });
      }
    } catch (error: any) {
      console.error("[Logo Upload] Error uploading cropped logo:", error);
      toast({ 
        title: "Upload Error", 
        description: error?.message || "Failed to upload cropped image", 
        variant: "destructive" 
      });
    } finally {
      setIsUploadingLogo(false);
      // Clean up the object URL
      if (cropImageUrl) {
        URL.revokeObjectURL(cropImageUrl);
        setCropImageUrl(null);
      }
    }
  };

  const updateFinnhubKeyMutation = useMutation({
    mutationFn: async (newApiKey: string) => {
      const response = await apiRequest("POST", "/api/settings/finnhub-key", { apiKey: newApiKey });
      return response.json() as Promise<{ success: boolean; message: string }>;
    },
    onSuccess: (data) => {
      toast({ title: "Success", description: data.message });
      setFinnhubKey("");
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to update API key", variant: "destructive" });
    },
  });

  const updateOpenaiKeyMutation = useMutation({
    mutationFn: async (newApiKey: string) => {
      const response = await apiRequest("POST", "/api/settings/openai-key", { apiKey: newApiKey });
      return response.json() as Promise<{ success: boolean; message: string }>;
    },
    onSuccess: (data) => {
      toast({ title: "Success", description: data.message });
      setOpenaiKey("");
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to update API key", variant: "destructive" });
    },
  });

  const deleteOpenaiKeyMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("DELETE", "/api/settings/openai-key");
      return response.json() as Promise<{ success: boolean; message: string }>;
    },
    onSuccess: (data) => {
      toast({ title: "Success", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to remove API key", variant: "destructive" });
    },
  });

  // RSS Feeds mutations
  const createFeedMutation = useMutation({
    mutationFn: async (feed: { name: string; url: string; priority: number }) => {
      const response = await apiRequest("POST", "/api/settings/rss-feeds", feed);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "RSS feed added" });
      queryClient.invalidateQueries({ queryKey: ["/api/settings/rss-feeds"] });
      closeFeedDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateFeedMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number; name?: string; url?: string; isActive?: boolean; priority?: number }) => {
      const response = await apiRequest("PUT", `/api/settings/rss-feeds/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "RSS feed updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/settings/rss-feeds"] });
      closeFeedDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteFeedMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("DELETE", `/api/settings/rss-feeds/${id}`);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "RSS feed deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/settings/rss-feeds"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Symbols mutations
  const createSymbolMutation = useMutation({
    mutationFn: async (symbol: { symbol: string; displayName: string; category: string; currency: string; priority: number }) => {
      const response = await apiRequest("POST", "/api/settings/symbols", symbol);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Symbol added" });
      queryClient.invalidateQueries({ queryKey: ["/api/settings/symbols"] });
      queryClient.invalidateQueries({ queryKey: ["/api/market/symbols"] });
      closeSymbolDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateSymbolMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number; symbol?: string; displayName?: string; category?: string; currency?: string; isActive?: boolean; priority?: number }) => {
      const response = await apiRequest("PUT", `/api/settings/symbols/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Symbol updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/settings/symbols"] });
      queryClient.invalidateQueries({ queryKey: ["/api/market/symbols"] });
      closeSymbolDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteSymbolMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("DELETE", `/api/settings/symbols/${id}`);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Symbol deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/settings/symbols"] });
      queryClient.invalidateQueries({ queryKey: ["/api/market/symbols"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // State for tracking which symbol is being refreshed
  const [refreshingSymbolId, setRefreshingSymbolId] = useState<number | null>(null);

  const refreshSymbolMutation = useMutation({
    mutationFn: async (id: number) => {
      setRefreshingSymbolId(id);
      const response = await apiRequest("POST", `/api/settings/symbols/${id}/refresh`);
      return response.json();
    },
    onSuccess: (data) => {
      toast({ 
        title: "Success", 
        description: data.displayName ? `Updated: ${data.displayName}` : "Symbol description refreshed" 
      });
      queryClient.invalidateQueries({ queryKey: ["/api/settings/symbols"] });
      queryClient.invalidateQueries({ queryKey: ["/api/market/symbols"] });
      setRefreshingSymbolId(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setRefreshingSymbolId(null);
    },
  });

  // Category mutations
  const createCategoryMutation = useMutation({
    mutationFn: async (category: { name: string; displayOrder: number }) => {
      const response = await apiRequest("POST", "/api/settings/categories", category);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Category added" });
      queryClient.invalidateQueries({ queryKey: ["/api/settings/categories"] });
      closeCategoryDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateCategoryMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number; name?: string; displayOrder?: number; isActive?: boolean }) => {
      const response = await apiRequest("PUT", `/api/settings/categories/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Category updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/settings/categories"] });
      closeCategoryDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("DELETE", `/api/settings/categories/${id}`);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Category deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/settings/categories"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const openAddFeedDialog = () => {
    setEditingFeed(null);
    setFeedName("");
    setFeedUrl("");
    setFeedPriority(0);
    setFeedDialogOpen(true);
  };

  const openEditFeedDialog = (feed: RssFeed) => {
    setEditingFeed(feed);
    setFeedName(feed.name);
    setFeedUrl(feed.url);
    setFeedPriority(feed.priority);
    setFeedDialogOpen(true);
  };

  const closeFeedDialog = () => {
    setFeedDialogOpen(false);
    setEditingFeed(null);
    setFeedName("");
    setFeedUrl("");
    setFeedPriority(0);
  };

  const handleSaveFeed = () => {
    if (editingFeed) {
      updateFeedMutation.mutate({ id: editingFeed.id, name: feedName, url: feedUrl, priority: feedPriority });
    } else {
      createFeedMutation.mutate({ name: feedName, url: feedUrl, priority: feedPriority });
    }
  };

  const openAddSymbolDialog = () => {
    setEditingSymbol(null);
    setSymbolCode("");
    setSymbolDisplayName("");
    setSymbolCategory("commodities");
    setSymbolCurrency("USD");
    setSymbolPriority(0);
    setSymbolDialogOpen(true);
  };

  const openEditSymbolDialog = (symbol: MonitoredSymbol) => {
    setEditingSymbol(symbol);
    setSymbolCode(symbol.symbol);
    setSymbolDisplayName(symbol.displayName);
    setSymbolCategory(symbol.category);
    setSymbolCurrency(symbol.currency || "USD");
    setSymbolPriority(symbol.priority);
    setSymbolDialogOpen(true);
  };

  const closeSymbolDialog = () => {
    setSymbolDialogOpen(false);
    setEditingSymbol(null);
    setSymbolCode("");
    setSymbolDisplayName("");
    setSymbolCategory("commodities");
    setSymbolCurrency("USD");
    setSymbolPriority(0);
  };

  const handleSaveSymbol = () => {
    if (editingSymbol) {
      updateSymbolMutation.mutate({ id: editingSymbol.id, symbol: symbolCode, displayName: symbolDisplayName, category: symbolCategory, currency: symbolCurrency, priority: symbolPriority });
    } else {
      createSymbolMutation.mutate({ symbol: symbolCode, displayName: symbolDisplayName, category: symbolCategory, currency: symbolCurrency, priority: symbolPriority });
    }
  };

  const openAddCategoryDialog = () => {
    setEditingCategory(null);
    setCategoryName("");
    setCategoryDisplayOrder(0);
    setCategoryDialogOpen(true);
  };

  const openEditCategoryDialog = (category: SymbolCategory) => {
    setEditingCategory(category);
    setCategoryName(category.name);
    setCategoryDisplayOrder(category.displayOrder);
    setCategoryDialogOpen(true);
  };

  const closeCategoryDialog = () => {
    setCategoryDialogOpen(false);
    setEditingCategory(null);
    setCategoryName("");
    setCategoryDisplayOrder(0);
  };

  const handleSaveCategory = () => {
    if (editingCategory) {
      updateCategoryMutation.mutate({ id: editingCategory.id, name: categoryName, displayOrder: categoryDisplayOrder });
    } else {
      createCategoryMutation.mutate({ name: categoryName, displayOrder: categoryDisplayOrder });
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const finnhubStatus = settings?.finnhubApiKey;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <Settings className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-sm text-muted-foreground">Configure application settings, API keys, RSS feeds, and symbols</p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Finnhub API Key Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Key className="h-5 w-5 text-primary" />
              <CardTitle>Finnhub API Key</CardTitle>
            </div>
            <CardDescription>
              Required for real-time stock data. Get a free API key from{" "}
              <a href="https://finnhub.io" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" data-testid="link-finnhub">
                finnhub.io
              </a>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Status:</span>
              {finnhubStatus?.isConfigured ? (
                <Badge variant="default" className="gap-1"><CheckCircle className="h-3 w-3" />Configured</Badge>
              ) : (
                <Badge variant="secondary" className="gap-1"><AlertCircle className="h-3 w-3" />Not Configured</Badge>
              )}
            </div>
            <Separator />
            <div className="space-y-2">
              <Label htmlFor="finnhub-key">{finnhubStatus?.isConfigured ? "Update API Key" : "Enter API Key"}</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="finnhub-key"
                    type={showFinnhubKey ? "text" : "password"}
                    placeholder="Enter your Finnhub API key"
                    value={finnhubKey}
                    onChange={(e) => setFinnhubKey(e.target.value)}
                    data-testid="input-finnhub-key"
                  />
                  <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2" onClick={() => setShowFinnhubKey(!showFinnhubKey)}>
                    {showFinnhubKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <Button onClick={() => updateFinnhubKeyMutation.mutate(finnhubKey)} disabled={!finnhubKey.trim() || updateFinnhubKeyMutation.isPending} data-testid="button-save-finnhub-key">
                  {updateFinnhubKeyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* OpenAI API Key Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-blue-500" />
              <CardTitle>OpenAI API Key</CardTitle>
            </div>
            <CardDescription>
              Required for AI-enhanced auto-trading and news analysis. Get an API key from{" "}
              <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" data-testid="link-openai">
                platform.openai.com
              </a>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Status:</span>
              {settings?.openaiApiKey?.isConfigured ? (
                settings?.openaiApiKey?.source === "database" ? (
                  <Badge variant="default" className="gap-1 bg-green-600"><CheckCircle className="h-3 w-3" />Saved to Database</Badge>
                ) : (
                  <Badge variant="default" className="gap-1 bg-yellow-600"><AlertCircle className="h-3 w-3" />Environment Only</Badge>
                )
              ) : (
                <Badge variant="secondary" className="gap-1"><AlertCircle className="h-3 w-3" />Not Configured</Badge>
              )}
            </div>
            {settings?.openaiApiKey?.isConfigured && settings?.openaiApiKey?.source === "environment" && (
              <p className="text-sm text-muted-foreground">
                Key detected from environment. For production deployment, save your own key below.
              </p>
            )}
            <Separator />
            <div className="space-y-2">
              <Label htmlFor="openai-key">{settings?.openaiApiKey?.isConfigured ? "Update API Key" : "Enter API Key"}</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="openai-key"
                    type={showOpenaiKey ? "text" : "password"}
                    placeholder="Enter your OpenAI API key"
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    data-testid="input-openai-key"
                  />
                  <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2" onClick={() => setShowOpenaiKey(!showOpenaiKey)}>
                    {showOpenaiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <Button onClick={() => updateOpenaiKeyMutation.mutate(openaiKey)} disabled={!openaiKey.trim() || updateOpenaiKeyMutation.isPending} data-testid="button-save-openai-key">
                  {updateOpenaiKeyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                </Button>
              </div>
            </div>
            {settings?.openaiApiKey?.isConfigured && settings?.openaiApiKey?.source === "database" && (
              <Button variant="outline" onClick={() => deleteOpenaiKeyMutation.mutate()} disabled={deleteOpenaiKeyMutation.isPending} data-testid="button-clear-openai-key">
                {deleteOpenaiKeyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Clear API Key
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Logo Settings */}
      {isSuperadmin && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Image className="h-5 w-5 text-purple-500" />
                <CardTitle>Logo Settings</CardTitle>
              </div>
              {logoSettings?.logoPath && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => clearLogoMutation.mutate()}
                  disabled={clearLogoMutation.isPending}
                  data-testid="button-clear-logo"
                >
                  {clearLogoMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <X className="h-4 w-4 mr-1" />}
                  Clear Logo
                </Button>
              )}
            </div>
            <CardDescription>
              Upload a custom logo for your Trady application. The logo will appear in the sidebar and public pages.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {logoLoading ? (
              <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : (
              <>
                {logoSettings?.logoPath ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">Status:</span>
                      <Badge variant="default" className="gap-1"><CheckCircle className="h-3 w-3" />Logo Configured</Badge>
                    </div>
                    <Separator />
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Full Logo</Label>
                        <div className="border rounded-lg p-4 bg-muted/50 flex items-center justify-center min-h-[100px]">
                          <img 
                            src={logoSettings.logoPath} 
                            alt="Full Logo" 
                            className="max-h-20 object-contain"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                            }}
                            data-testid="img-full-logo"
                          />
                        </div>
                      </div>
                      {logoSettings.logoIconPath && (
                        <div className="space-y-2">
                          <Label>Icon Logo (Sidebar)</Label>
                          <div className="border rounded-lg p-4 bg-muted/50 flex items-center justify-center min-h-[100px]">
                            <img 
                              src={logoSettings.logoIconPath} 
                              alt="Icon Logo" 
                              className="max-h-16 object-contain"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                              }}
                              data-testid="img-icon-logo"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                    <Separator />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        className="gap-2"
                        disabled={isUploadingLogo}
                        onClick={() => document.getElementById('input-replace-full-logo')?.click()}
                        data-testid="button-replace-full-logo"
                      >
                        {isUploadingLogo && cropType === "full" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Upload className="h-4 w-4" />
                        )}
                        Replace Full Logo
                      </Button>
                      <input
                        id="input-replace-full-logo"
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handleLogoFileSelect(e, "full")}
                        data-testid="input-replace-full-logo"
                      />
                      <Button
                        variant="outline"
                        className="gap-2"
                        disabled={isUploadingLogo}
                        onClick={() => document.getElementById('input-replace-icon-logo')?.click()}
                        data-testid="button-replace-icon-logo"
                      >
                        {isUploadingLogo && cropType === "icon" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Upload className="h-4 w-4" />
                        )}
                        Replace Icon Logo
                      </Button>
                      <input
                        id="input-replace-icon-logo"
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handleLogoFileSelect(e, "icon")}
                        data-testid="input-replace-icon-logo"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">Status:</span>
                      <Badge variant="secondary" className="gap-1"><AlertCircle className="h-3 w-3" />No Custom Logo</Badge>
                    </div>
                    <Alert>
                      <Info className="h-4 w-4" />
                      <AlertDescription>
                        No custom logo configured. The default Trady logo will be used. Upload a custom logo to personalize your application.
                      </AlertDescription>
                    </Alert>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        className="gap-2"
                        disabled={isUploadingLogo}
                        onClick={() => document.getElementById('input-upload-full-logo')?.click()}
                        data-testid="button-upload-logo"
                      >
                        {isUploadingLogo && cropType === "full" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Upload className="h-4 w-4" />
                        )}
                        Upload Full Logo
                      </Button>
                      <input
                        id="input-upload-full-logo"
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handleLogoFileSelect(e, "full")}
                        data-testid="input-upload-full-logo"
                      />
                      <Button
                        variant="outline"
                        className="gap-2"
                        disabled={isUploadingLogo}
                        onClick={() => document.getElementById('input-upload-icon-logo')?.click()}
                        data-testid="button-upload-icon-logo"
                      >
                        {isUploadingLogo && cropType === "icon" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Upload className="h-4 w-4" />
                        )}
                        Upload Icon Logo
                      </Button>
                      <input
                        id="input-upload-icon-logo"
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handleLogoFileSelect(e, "icon")}
                        data-testid="input-upload-icon-logo"
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* RSS Feeds Management */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Rss className="h-5 w-5 text-orange-500" />
              <CardTitle>RSS News Feeds</CardTitle>
            </div>
            {isSuperadmin && (
              <Button onClick={openAddFeedDialog} size="sm" data-testid="button-add-rss-feed">
                <Plus className="h-4 w-4 mr-1" /> Add Feed
              </Button>
            )}
          </div>
          <CardDescription>
            Configure multiple RSS feeds for financial news. The AI will analyze headlines from all active feeds.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!isSuperadmin ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                RSS feed management requires superadmin access. Contact your administrator.
              </AlertDescription>
            </Alert>
          ) : feedsLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : rssFeeds.length === 0 ? (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                No RSS feeds configured. Add a feed to start receiving financial news for AI analysis.
                Default: Yahoo Finance will be used if no feeds are configured.
              </AlertDescription>
            </Alert>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead className="w-24">Priority</TableHead>
                  <TableHead className="w-24">Active</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rssFeeds.map((feed) => (
                  <TableRow key={feed.id} data-testid={`row-rss-feed-${feed.id}`}>
                    <TableCell className="font-medium">{feed.name}</TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground text-sm font-mono">{feed.url}</TableCell>
                    <TableCell>{feed.priority}</TableCell>
                    <TableCell>
                      <Switch
                        checked={feed.isActive}
                        onCheckedChange={(checked) => updateFeedMutation.mutate({ id: feed.id, isActive: checked })}
                        data-testid={`switch-feed-active-${feed.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEditFeedDialog(feed)} data-testid={`button-edit-feed-${feed.id}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => deleteFeedMutation.mutate(feed.id)} disabled={deleteFeedMutation.isPending} data-testid={`button-delete-feed-${feed.id}`}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Symbol Categories Management */}
      {isSuperadmin && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-blue-500" />
                <CardTitle>Symbol Categories</CardTitle>
              </div>
              <Button onClick={openAddCategoryDialog} size="sm" data-testid="button-add-category">
                <Plus className="h-4 w-4 mr-1" /> Add Category
              </Button>
            </div>
            <CardDescription>
              Manage categories for organizing trading symbols.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {categoriesLoading ? (
              <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : categories.length === 0 ? (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  No categories configured. Default categories will be used.
                </AlertDescription>
              </Alert>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-24">Order</TableHead>
                    <TableHead className="w-24">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categories.map((cat) => (
                    <TableRow key={cat.id} data-testid={`row-category-${cat.id}`}>
                      <TableCell className="font-medium">{cat.name}</TableCell>
                      <TableCell>{cat.displayOrder}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEditCategoryDialog(cat)} data-testid={`button-edit-category-${cat.id}`}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => deleteCategoryMutation.mutate(cat.id)} disabled={deleteCategoryMutation.isPending} data-testid={`button-delete-category-${cat.id}`}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Symbols Management */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-green-500" />
              <CardTitle>Monitored Symbols</CardTitle>
            </div>
            {isSuperadmin && (
              <Button onClick={openAddSymbolDialog} size="sm" data-testid="button-add-symbol">
                <Plus className="h-4 w-4 mr-1" /> Add Symbol
              </Button>
            )}
          </div>
          <CardDescription>
            Configure trading symbols to monitor. Active symbols will appear in the market data and predictions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!isSuperadmin ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Symbol management requires superadmin access. Contact your administrator.
              </AlertDescription>
            </Alert>
          ) : symbolsLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : symbols.length === 0 ? (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                No symbols configured. Add symbols to start monitoring market data.
              </AlertDescription>
            </Alert>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Display Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="w-24">Priority</TableHead>
                  <TableHead className="w-24">Active</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {symbols.map((symbol) => (
                  <TableRow key={symbol.id} data-testid={`row-symbol-${symbol.id}`}>
                    <TableCell className="font-mono font-medium">{symbol.symbol}</TableCell>
                    <TableCell>{symbol.displayName}</TableCell>
                    <TableCell><Badge variant="outline">{symbol.category}</Badge></TableCell>
                    <TableCell>{symbol.priority}</TableCell>
                    <TableCell>
                      <Switch
                        checked={symbol.isActive}
                        onCheckedChange={(checked) => updateSymbolMutation.mutate({ id: symbol.id, isActive: checked })}
                        data-testid={`switch-symbol-active-${symbol.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => refreshSymbolMutation.mutate(symbol.id)} 
                          disabled={refreshingSymbolId === symbol.id}
                          title="Refresh description from Yahoo Finance"
                          data-testid={`button-refresh-symbol-${symbol.id}`}
                        >
                          <RefreshCw className={`h-4 w-4 ${refreshingSymbolId === symbol.id ? 'animate-spin' : ''}`} />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => openEditSymbolDialog(symbol)} data-testid={`button-edit-symbol-${symbol.id}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => deleteSymbolMutation.mutate(symbol.id)} disabled={deleteSymbolMutation.isPending} data-testid={`button-delete-symbol-${symbol.id}`}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* RSS Feed Dialog */}
      <Dialog open={feedDialogOpen} onOpenChange={setFeedDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingFeed ? "Edit RSS Feed" : "Add RSS Feed"}</DialogTitle>
            <DialogDescription>
              {editingFeed ? "Update the RSS feed details." : "Add a new RSS feed for financial news."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="feed-name">Feed Name</Label>
              <Input id="feed-name" placeholder="e.g., Yahoo Finance" value={feedName} onChange={(e) => setFeedName(e.target.value)} data-testid="input-feed-name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="feed-url">Feed URL</Label>
              <Input id="feed-url" type="url" placeholder="https://finance.yahoo.com/news/rssindex" value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} data-testid="input-feed-url" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="feed-priority">Priority (higher = more important)</Label>
              <Input id="feed-priority" type="number" value={feedPriority} onChange={(e) => setFeedPriority(parseInt(e.target.value) || 0)} data-testid="input-feed-priority" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeFeedDialog}>Cancel</Button>
            <Button onClick={handleSaveFeed} disabled={!feedName.trim() || !feedUrl.trim() || createFeedMutation.isPending || updateFeedMutation.isPending} data-testid="button-save-feed">
              {(createFeedMutation.isPending || updateFeedMutation.isPending) ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {editingFeed ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Symbol Dialog */}
      <Dialog open={symbolDialogOpen} onOpenChange={setSymbolDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingSymbol ? "Edit Symbol" : "Add Symbol"}</DialogTitle>
            <DialogDescription>
              {editingSymbol ? "Update the trading symbol details." : "Add a new trading symbol to monitor."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="symbol-code">Symbol Code</Label>
              <Input id="symbol-code" placeholder="e.g., XAUUSD" value={symbolCode} onChange={(e) => setSymbolCode(e.target.value.toUpperCase())} data-testid="input-symbol-code" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="symbol-display-name">Display Name</Label>
              <Input id="symbol-display-name" placeholder="e.g., Gold/USD" value={symbolDisplayName} onChange={(e) => setSymbolDisplayName(e.target.value)} data-testid="input-symbol-display-name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="symbol-category">Category</Label>
              <Select value={symbolCategory} onValueChange={setSymbolCategory}>
                <SelectTrigger data-testid="select-symbol-category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.length > 0 ? (
                    categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.name}>{cat.name}</SelectItem>
                    ))
                  ) : (
                    <>
                      <SelectItem value="commodities">Commodities</SelectItem>
                      <SelectItem value="indices">Indices</SelectItem>
                      <SelectItem value="crypto">Crypto</SelectItem>
                      <SelectItem value="forex">Forex</SelectItem>
                      <SelectItem value="stocks">Stocks</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="symbol-currency">Currency</Label>
              <Select value={symbolCurrency} onValueChange={setSymbolCurrency}>
                <SelectTrigger data-testid="select-symbol-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD ($)</SelectItem>
                  <SelectItem value="IDR">IDR (Rp)</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                  <SelectItem value="JPY">JPY</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Tip: Select IDR for Indonesian stocks - will auto-configure Yahoo Finance</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="symbol-priority">Priority (higher = more important)</Label>
              <Input id="symbol-priority" type="number" value={symbolPriority} onChange={(e) => setSymbolPriority(parseInt(e.target.value) || 0)} data-testid="input-symbol-priority" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeSymbolDialog}>Cancel</Button>
            <Button onClick={handleSaveSymbol} disabled={!symbolCode.trim() || !symbolDisplayName.trim() || createSymbolMutation.isPending || updateSymbolMutation.isPending} data-testid="button-save-symbol">
              {(createSymbolMutation.isPending || updateSymbolMutation.isPending) ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {editingSymbol ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Category Dialog */}
      <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCategory ? "Edit Category" : "Add Category"}</DialogTitle>
            <DialogDescription>
              {editingCategory ? "Update the category details." : "Add a new category for organizing symbols."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="category-name">Category Name</Label>
              <Input id="category-name" placeholder="e.g., Indonesian Stocks" value={categoryName} onChange={(e) => setCategoryName(e.target.value)} data-testid="input-category-name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category-order">Display Order (higher = first)</Label>
              <Input id="category-order" type="number" value={categoryDisplayOrder} onChange={(e) => setCategoryDisplayOrder(parseInt(e.target.value) || 0)} data-testid="input-category-order" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeCategoryDialog}>Cancel</Button>
            <Button onClick={handleSaveCategory} disabled={!categoryName.trim() || createCategoryMutation.isPending || updateCategoryMutation.isPending} data-testid="button-save-category">
              {(createCategoryMutation.isPending || updateCategoryMutation.isPending) ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {editingCategory ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Logo Crop Modal */}
      {cropImageUrl && (
        <LogoCropModal
          isOpen={cropModalOpen}
          onClose={() => {
            setCropModalOpen(false);
            if (cropImageUrl) {
              URL.revokeObjectURL(cropImageUrl);
              setCropImageUrl(null);
            }
          }}
          imageUrl={cropImageUrl}
          aspectRatio={cropType === "icon" ? 1 : 3}
          onCropComplete={handleCropComplete}
          title={cropType === "icon" ? "Crop Icon Logo (Square)" : "Crop Full Logo (Wide)"}
        />
      )}
    </div>
  );
}
