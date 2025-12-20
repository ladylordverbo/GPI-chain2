import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Users, Check, X, Loader2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface UsernameRegistrationProps {
  onComplete: () => void;
}

export default function UsernameRegistration({ onComplete }: UsernameRegistrationProps) {
  const [username, setUsername] = useState("");
  const [debouncedUsername, setDebouncedUsername] = useState("");
  const { toast } = useToast();

  const { data: pendingData } = useQuery<{ pending: boolean; isFirstUser: boolean; firstName?: string; lastName?: string }>({
    queryKey: ["/api/auth/pending-registration"],
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedUsername(username.toLowerCase().trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [username]);

  const { data: availabilityData, isLoading: checkingAvailability } = useQuery<{ available: boolean; reason: string | null }>({
    queryKey: ["/api/username/check", debouncedUsername],
    enabled: debouncedUsername.length >= 3,
  });

  const registerMutation = useMutation({
    mutationFn: async (username: string) => {
      const response = await apiRequest("POST", "/api/auth/complete-registration", { username });
      return response.json();
    },
    onSuccess: async () => {
      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/pending-registration"] });
      
      // Wait a moment for session to persist, then retry
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Force refetch
      await queryClient.refetchQueries({ queryKey: ["/api/auth/user"] });
      await queryClient.refetchQueries({ queryKey: ["/api/auth/pending-registration"] });
      
      toast({
        title: "Welcome!",
        description: "Your account has been created successfully.",
      });
      onComplete();
    },
    onError: (error: any) => {
      toast({
        title: "Registration Failed",
        description: error.message || "Failed to complete registration",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (availabilityData?.available) {
      registerMutation.mutate(username);
    }
  };

  const isValid = debouncedUsername.length >= 3 && availabilityData?.available;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-primary flex items-center justify-center mb-4">
            <Users className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold" data-testid="text-welcome-title">Welcome to Community HQ</h1>
          <p className="text-muted-foreground">
            {pendingData?.firstName ? `Hi ${pendingData.firstName}! ` : ""}
            Choose a unique username for your account
          </p>
        </div>

        {pendingData?.isFirstUser && (
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-full bg-primary/10">
                <Users className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium">Founding Administrator</p>
                <p className="text-xs text-muted-foreground">You will be the first Level 5 admin</p>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-lg">Choose Your Username</CardTitle>
            <CardDescription>
              This will be your unique identifier in the community
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <div className="relative">
                  <Input
                    id="username"
                    type="text"
                    placeholder="your_username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 30))}
                    className="pr-10"
                    autoComplete="off"
                    data-testid="input-username"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {checkingAvailability && debouncedUsername.length >= 3 && (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                    {!checkingAvailability && availabilityData?.available && (
                      <Check className="h-4 w-4 text-green-500" />
                    )}
                    {!checkingAvailability && availabilityData && !availabilityData.available && (
                      <X className="h-4 w-4 text-destructive" />
                    )}
                  </div>
                </div>
                {debouncedUsername.length > 0 && debouncedUsername.length < 3 && (
                  <p className="text-xs text-muted-foreground">Username must be at least 3 characters</p>
                )}
                {availabilityData?.reason && (
                  <p className="text-xs text-destructive">{availabilityData.reason}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  3-30 characters, letters, numbers, and underscores only
                </p>
              </div>

              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={!isValid || registerMutation.isPending}
                data-testid="button-complete-registration"
              >
                {registerMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating Account...
                  </>
                ) : (
                  "Complete Registration"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
