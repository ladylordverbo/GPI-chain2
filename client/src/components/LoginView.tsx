import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SiGoogle } from "react-icons/si";
import { Users, Shield, Link2, AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface LoginViewProps {
  onLogin: () => void;
  inviteToken?: string;
  inviterName?: string;
  error?: string;
}

export default function LoginView({ onLogin, inviteToken, inviterName, error: initialError }: LoginViewProps) {
  const isInviteFlow = !!inviteToken;
  const [mode, setMode] = useState<"signup" | "signin">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | undefined>(initialError);
  const { toast } = useToast();

  // Get invite token from URL if not passed as prop
  const urlParams = new URLSearchParams(window.location.search);
  const urlInviteToken = urlParams.get("invite") || inviteToken;

  const signupMutation = useMutation({
    mutationFn: async ({ email, password, inviteToken }: { email: string; password: string; inviteToken?: string }) => {
      console.log('[SIGNUP] Starting signup request:', { email, hasInviteToken: !!inviteToken });
      
      try {
        const response = await apiRequest("POST", "/api/auth/signup", {
          email,
          password,
          inviteToken,
        });
        
        console.log('[SIGNUP] Response received:', {
          status: response.status,
          statusText: response.statusText,
          contentType: response.headers.get("content-type"),
          ok: response.ok,
        });
        
        // Check if response has content before parsing
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          const text = await response.text();
          console.error('[SIGNUP] Non-JSON response:', text);
          throw new Error(text || "Invalid response from server");
        }
        
        const text = await response.text();
        console.log('[SIGNUP] Response text:', text.substring(0, 200));
        
        if (!text) {
          console.error('[SIGNUP] Empty response body');
          throw new Error("Empty response from server");
        }
        
        try {
          const data = JSON.parse(text);
          console.log('[SIGNUP] Parsed JSON:', data);
          return data;
        } catch (e) {
          console.error('[SIGNUP] JSON parse error:', e, 'Response text:', text.substring(0, 200));
          throw new Error(`Invalid JSON response: ${text.substring(0, 100)}`);
        }
      } catch (error: any) {
        console.error('[SIGNUP] Request error:', error);
        throw error;
      }
    },
    onSuccess: (data) => {
      if (data.pending) {
        // User needs to complete registration with username
        queryClient.invalidateQueries({ queryKey: ["/api/auth/pending-registration"] });
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        // Redirect will happen automatically via App.tsx checking pending registration
        window.location.reload();
      } else {
        toast({
          title: "Account Created",
          description: "Your account has been created successfully.",
        });
        window.location.reload();
      }
    },
    onError: (error: any) => {
      let errorMessage = "Failed to create account";
      if (error.message) {
        const match = error.message.match(/^\d+:\s*(.+)$/);
        if (match) {
          try {
            const errorData = JSON.parse(match[1]);
            errorMessage = errorData.message || errorMessage;
          } catch {
            errorMessage = match[1];
          }
        } else {
          errorMessage = error.message;
        }
      }
      setError(errorMessage);
      toast({
        title: "Sign Up Failed",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const signinMutation = useMutation({
    mutationFn: async ({ email, password, inviteToken }: { email: string; password: string; inviteToken?: string }) => {
      const response = await apiRequest("POST", "/api/login", {
        email,
        password,
        invite: inviteToken,
      });
      
      // Check if response has content before parsing
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text();
        throw new Error(text || "Invalid response from server");
      }
      
      const text = await response.text();
      if (!text) {
        throw new Error("Empty response from server");
      }
      
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new Error(`Invalid JSON response: ${text.substring(0, 100)}`);
      }
    },
    onSuccess: (data) => {
      if (data.pending) {
        // User needs to complete registration with username
        queryClient.invalidateQueries({ queryKey: ["/api/auth/pending-registration"] });
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        window.location.reload();
      } else if (data.success) {
        // Login successful
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        window.location.reload();
      }
    },
    onError: (error: any) => {
      let errorMessage = "Login failed";
      if (error.message) {
        const match = error.message.match(/^\d+:\s*(.+)$/);
        if (match) {
          try {
            const errorData = JSON.parse(match[1]);
            errorMessage = errorData.message || errorMessage;
          } catch {
            errorMessage = match[1];
          }
        } else {
          errorMessage = error.message;
        }
      }
      setError(errorMessage);
      toast({
        title: "Sign In Failed",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validatePassword = (password: string): { valid: boolean; message?: string } => {
    if (password.length < 8) {
      return { valid: false, message: "Password must be at least 8 characters" };
    }
    return { valid: true };
  };

  const handleSignup = (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);

    if (!validateEmail(email)) {
      setError("Please enter a valid email address");
      return;
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      setError(passwordValidation.message || "Invalid password");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    signupMutation.mutate({ email, password, inviteToken: urlInviteToken });
  };

  const handleSignin = (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);

    if (!validateEmail(email)) {
      setError("Please enter a valid email address");
      return;
    }

    if (!password) {
      setError("Password is required");
      return;
    }

    signinMutation.mutate({ email, password, inviteToken: urlInviteToken });
  };

  const isSignupValid = email && password && confirmPassword && 
    validateEmail(email) && 
    validatePassword(password).valid && 
    password === confirmPassword;

  const isSigninValid = email && password && validateEmail(email);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center mb-4">
            <Users className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold">Community HQ</h1>
          <p className="text-muted-foreground">
            {isInviteFlow 
              ? "You've been invited to join our community"
              : "Membership management for your creative community"
            }
          </p>
        </div>

        {error && (
          <Card className="border-destructive/50 bg-destructive/10">
            <CardContent className="p-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-destructive">
                  {mode === "signup" ? "Sign Up Failed" : "Sign In Failed"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">{error}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {inviterName && (
          <Card className="border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-900/10">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-full bg-purple-100 dark:bg-purple-900/30">
                <Link2 className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-purple-900 dark:text-purple-100">Invited by {inviterName}</p>
                <p className="text-xs text-purple-700 dark:text-purple-300 mt-1">Click below to accept your invitation</p>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-lg">
              {isInviteFlow ? "Accept Invitation" : mode === "signup" ? "Create Account" : "Sign In"}
            </CardTitle>
            <CardDescription>
              {isInviteFlow 
                ? "Create an account or sign in to join the community"
                : mode === "signup"
                ? "Create a new account to get started"
                : "Sign in to access your membership dashboard"
              }
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs value={mode} onValueChange={(v) => { setMode(v as "signup" | "signin"); setError(undefined); }}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signup">Sign Up</TabsTrigger>
                <TabsTrigger value="signin">Sign In</TabsTrigger>
              </TabsList>

              <TabsContent value="signup" className="space-y-4 mt-4">
                <form onSubmit={handleSignup} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email</Label>
                    <Input
                      id="signup-email"
                      type="email"
                      placeholder="your@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={signupMutation.isPending}
                      required
                      data-testid="input-signup-email"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Password</Label>
                    <div className="relative">
                      <Input
                        id="signup-password"
                        type={showPassword ? "text" : "password"}
                        placeholder="At least 8 characters"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={signupMutation.isPending}
                        required
                        className="pr-10"
                        data-testid="input-signup-password"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full px-3"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    {password && !validatePassword(password).valid && (
                      <p className="text-xs text-muted-foreground">
                        {validatePassword(password).message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-confirm-password">Confirm Password</Label>
                    <div className="relative">
                      <Input
                        id="signup-confirm-password"
                        type={showConfirmPassword ? "text" : "password"}
                        placeholder="Confirm your password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        disabled={signupMutation.isPending}
                        required
                        className="pr-10"
                        data-testid="input-signup-confirm-password"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full px-3"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      >
                        {showConfirmPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    {confirmPassword && password !== confirmPassword && (
                      <p className="text-xs text-destructive">Passwords do not match</p>
                    )}
                  </div>
                  <Button
                    type="submit"
                    className="w-full"
                    size="lg"
                    disabled={!isSignupValid || signupMutation.isPending}
                    data-testid="button-signup-submit"
                  >
                    {signupMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Creating Account...
                      </>
                    ) : (
                      "Create Account"
                    )}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signin" className="space-y-4 mt-4">
                <form onSubmit={handleSignin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signin-email">Email</Label>
                    <Input
                      id="signin-email"
                      type="email"
                      placeholder="your@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={signinMutation.isPending}
                      required
                      data-testid="input-signin-email"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signin-password">Password</Label>
                    <div className="relative">
                      <Input
                        id="signin-password"
                        type={showPassword ? "text" : "password"}
                        placeholder="Enter your password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={signinMutation.isPending}
                        required
                        className="pr-10"
                        data-testid="input-signin-password"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full px-3"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                  <Button
                    type="submit"
                    className="w-full"
                    size="lg"
                    disabled={!isSigninValid || signinMutation.isPending}
                    data-testid="button-signin-submit"
                  >
                    {signinMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Signing In...
                      </>
                    ) : (
                      "Sign In"
                    )}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
              </div>
            </div>

            <Button 
              className="w-full bg-purple-600 hover:bg-purple-700" 
              size="lg"
              onClick={onLogin}
              disabled={signupMutation.isPending || signinMutation.isPending}
              data-testid="button-google-signin"
            >
              <SiGoogle className="h-4 w-4 mr-2" />
              Continue with Google
            </Button>
          </CardContent>
        </Card>

        {isInviteFlow && (
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="text-sm font-medium">By joining, you agree to:</p>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li className="flex items-start gap-2">
                  <Shield className="h-4 w-4 mt-0.5 text-purple-600 shrink-0" />
                  <span>Follow community guidelines and respect all members</span>
                </li>
                <li className="flex items-start gap-2">
                  <Users className="h-4 w-4 mt-0.5 text-purple-600 shrink-0" />
                  <span>Only invite people you trust and vouch for</span>
                </li>
                <li className="flex items-start gap-2">
                  <Link2 className="h-4 w-4 mt-0.5 text-purple-600 shrink-0" />
                  <span>Maintain the integrity of the invitation chain</span>
                </li>
              </ul>
            </CardContent>
          </Card>
        )}

        <p className="text-center text-xs text-muted-foreground">
          {isInviteFlow 
            ? "This is an invite-only community. Your invitation link is valid for one use."
            : "Access is by invitation only. Contact an existing member for an invite."
          }
        </p>
      </div>
    </div>
  );
}
