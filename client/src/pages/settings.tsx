import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Settings, Key, CheckCircle, AlertCircle, Info, Loader2, Eye, EyeOff, Bot } from "lucide-react";

interface ApiKeyStatus {
  isConfigured: boolean;
  source: string;
  maskedValue: string | null;
  isEditable?: boolean;
}

interface SettingsData {
  finnhubApiKey: ApiKeyStatus;
  openaiApiKey: ApiKeyStatus;
}

export default function SettingsPage() {
  const { toast } = useToast();
  const [finnhubKey, setFinnhubKey] = useState("");
  const [showFinnhubKey, setShowFinnhubKey] = useState(false);
  const [openaiKey, setOpenaiKey] = useState("");
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);

  const { data: settings, isLoading } = useQuery<SettingsData>({
    queryKey: ["/api/settings"],
    refetchInterval: false,
  });

  const updateFinnhubKeyMutation = useMutation({
    mutationFn: async (newApiKey: string) => {
      const response = await apiRequest("POST", "/api/settings/finnhub-key", { apiKey: newApiKey });
      return response.json() as Promise<{ success: boolean; message: string }>;
    },
    onSuccess: (data) => {
      toast({
        title: "Success",
        description: data.message,
      });
      setFinnhubKey("");
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update API key",
        variant: "destructive",
      });
    },
  });

  const updateOpenaiKeyMutation = useMutation({
    mutationFn: async (newApiKey: string) => {
      const response = await apiRequest("POST", "/api/settings/openai-key", { apiKey: newApiKey });
      return response.json() as Promise<{ success: boolean; message: string }>;
    },
    onSuccess: (data) => {
      toast({
        title: "Success",
        description: data.message,
      });
      setOpenaiKey("");
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update API key",
        variant: "destructive",
      });
    },
  });

  const deleteOpenaiKeyMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("DELETE", "/api/settings/openai-key");
      return response.json() as Promise<{ success: boolean; message: string }>;
    },
    onSuccess: (data) => {
      toast({
        title: "Success",
        description: data.message,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to remove API key",
        variant: "destructive",
      });
    },
  });

  const handleSaveFinnhubKey = () => {
    updateFinnhubKeyMutation.mutate(finnhubKey);
  };

  const handleClearFinnhubKey = () => {
    updateFinnhubKeyMutation.mutate("");
  };

  const handleSaveOpenaiKey = () => {
    updateOpenaiKeyMutation.mutate(openaiKey);
  };

  const handleClearOpenaiKey = () => {
    deleteOpenaiKeyMutation.mutate();
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
          <p className="text-sm text-muted-foreground">Configure application settings and API keys</p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Key className="h-5 w-5 text-primary" />
              <CardTitle>Finnhub API Key</CardTitle>
            </div>
            <CardDescription>
              Required for real-time stock data (GDX, GDXJ, NEM, SPX, DXY, USOIL).
              Get a free API key from{" "}
              <a
                href="https://finnhub.io"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
                data-testid="link-finnhub"
              >
                finnhub.io
              </a>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Status:</span>
              {finnhubStatus?.isConfigured ? (
                <Badge variant="default" className="gap-1">
                  <CheckCircle className="h-3 w-3" />
                  Configured
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Not Configured
                </Badge>
              )}
            </div>

            {finnhubStatus?.isConfigured && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Source:</span>
                <Badge variant="outline">
                  {finnhubStatus.source === "environment" ? "Environment Variable" : "Database (Persistent)"}
                </Badge>
                {finnhubStatus.maskedValue && (
                  <span className="font-mono text-muted-foreground">{finnhubStatus.maskedValue}</span>
                )}
              </div>
            )}

            <Separator />

            {finnhubStatus?.source === "environment" ? (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  API key is configured via environment variable. To change it, update your server&apos;s
                  FINNHUB_API_KEY environment variable.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="finnhub-key">
                    {finnhubStatus?.isConfigured ? "Update API Key" : "Enter API Key"}
                  </Label>
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
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
                        onClick={() => setShowFinnhubKey(!showFinnhubKey)}
                        data-testid="button-toggle-finnhub-key-visibility"
                      >
                        {showFinnhubKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                    <Button
                      onClick={handleSaveFinnhubKey}
                      disabled={!finnhubKey.trim() || updateFinnhubKeyMutation.isPending}
                      data-testid="button-save-finnhub-key"
                    >
                      {updateFinnhubKeyMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Save"
                      )}
                    </Button>
                  </div>
                </div>

                {finnhubStatus?.isConfigured && finnhubStatus?.source === "runtime" && (
                  <Button
                    variant="outline"
                    onClick={handleClearFinnhubKey}
                    disabled={updateFinnhubKeyMutation.isPending}
                    data-testid="button-clear-finnhub-key"
                  >
                    Clear API Key
                  </Button>
                )}

                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    API keys saved here are stored in the database and will persist across restarts.
                    Environment variables take precedence if configured.
                  </AlertDescription>
                </Alert>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-blue-500" />
              <CardTitle>OpenAI API Key</CardTitle>
            </div>
            <CardDescription>
              Required for AI-enhanced auto-trading filter. Get an API key from{" "}
              <a
                href="https://platform.openai.com/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
                data-testid="link-openai"
              >
                platform.openai.com
              </a>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Status:</span>
              {settings?.openaiApiKey?.isConfigured ? (
                <Badge variant="default" className="gap-1 bg-blue-500">
                  <CheckCircle className="h-3 w-3" />
                  Configured
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Not Configured
                </Badge>
              )}
            </div>

            {settings?.openaiApiKey?.isConfigured && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Source:</span>
                <Badge variant="outline">
                  {settings.openaiApiKey.source === "environment" ? "Environment Variable" : "Database (Encrypted)"}
                </Badge>
                {settings.openaiApiKey.maskedValue && (
                  <span className="font-mono text-muted-foreground">{settings.openaiApiKey.maskedValue}</span>
                )}
              </div>
            )}

            <Separator />

            {settings?.openaiApiKey?.isEditable === false ? (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  OpenAI API key is configured via environment variable.
                  AI-enhanced auto-trading filter is available in the Live Demo page.
                  To change it, update the <code className="bg-muted px-1 rounded">AI_INTEGRATIONS_OPENAI_API_KEY</code> environment variable.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="openai-key">
                    {settings?.openaiApiKey?.isConfigured ? "Update API Key" : "Enter API Key"}
                  </Label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        id="openai-key"
                        type={showOpenaiKey ? "text" : "password"}
                        placeholder="sk-..."
                        value={openaiKey}
                        onChange={(e) => setOpenaiKey(e.target.value)}
                        data-testid="input-openai-key"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
                        onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                        data-testid="button-toggle-openai-key-visibility"
                      >
                        {showOpenaiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                    <Button
                      onClick={handleSaveOpenaiKey}
                      disabled={!openaiKey.trim() || updateOpenaiKeyMutation.isPending}
                      data-testid="button-save-openai-key"
                    >
                      {updateOpenaiKeyMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Save"
                      )}
                    </Button>
                  </div>
                </div>

                {settings?.openaiApiKey?.isConfigured && settings?.openaiApiKey?.source === "database" && (
                  <Button
                    variant="outline"
                    onClick={handleClearOpenaiKey}
                    disabled={deleteOpenaiKeyMutation.isPending}
                    data-testid="button-clear-openai-key"
                  >
                    {deleteOpenaiKeyMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : null}
                    Clear API Key
                  </Button>
                )}

                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    API keys are encrypted before storage for security.
                    Environment variables take precedence if configured.
                  </AlertDescription>
                </Alert>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Data Sources</CardTitle>
            <CardDescription>Current data providers for each instrument</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">XAUUSD, XAGUSD, BTCUSD</span>
                <Badge variant="outline">Gold-API (Free)</Badge>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-sm">GDX, GDXJ, NEM, SPX, DXY, USOIL</span>
                <Badge variant={finnhubStatus?.isConfigured ? "default" : "secondary"}>
                  {finnhubStatus?.isConfigured ? "Finnhub (Live)" : "Simulated"}
                </Badge>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-sm">US10Y</span>
                <Badge variant="secondary">Simulated</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AI Features Status</CardTitle>
            <CardDescription>Current availability of AI-powered features</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">AI Auto-Trading Filter</span>
                <Badge variant={settings?.openaiApiKey?.isConfigured ? "default" : "secondary"}>
                  {settings?.openaiApiKey?.isConfigured ? "Available" : "Disabled"}
                </Badge>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-sm">AI Market Analysis</span>
                <Badge variant={settings?.openaiApiKey?.isConfigured ? "default" : "secondary"}>
                  {settings?.openaiApiKey?.isConfigured ? "Available" : "Disabled"}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
