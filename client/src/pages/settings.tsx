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
import { Settings, Key, CheckCircle, AlertCircle, Info, Loader2, Eye, EyeOff } from "lucide-react";

interface SettingsData {
  finnhubApiKey: {
    isConfigured: boolean;
    source: string;
    maskedValue: string | null;
  };
}

export default function SettingsPage() {
  const { toast } = useToast();
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);

  const { data: settings, isLoading } = useQuery<SettingsData>({
    queryKey: ["/api/settings"],
    refetchInterval: false,
  });

  const updateKeyMutation = useMutation({
    mutationFn: async (newApiKey: string) => {
      const response = await apiRequest("/api/settings/finnhub-key", {
        method: "POST",
        body: JSON.stringify({ apiKey: newApiKey }),
      });
      return response as { success: boolean; message: string };
    },
    onSuccess: (data) => {
      toast({
        title: "Success",
        description: data.message,
      });
      setApiKey("");
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

  const handleSaveKey = () => {
    updateKeyMutation.mutate(apiKey);
  };

  const handleClearKey = () => {
    updateKeyMutation.mutate("");
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
                        type={showKey ? "text" : "password"}
                        placeholder="Enter your Finnhub API key"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        data-testid="input-finnhub-key"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
                        onClick={() => setShowKey(!showKey)}
                        data-testid="button-toggle-key-visibility"
                      >
                        {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                    <Button
                      onClick={handleSaveKey}
                      disabled={!apiKey.trim() || updateKeyMutation.isPending}
                      data-testid="button-save-key"
                    >
                      {updateKeyMutation.isPending ? (
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
                    onClick={handleClearKey}
                    disabled={updateKeyMutation.isPending}
                    data-testid="button-clear-key"
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
      </div>
    </div>
  );
}
