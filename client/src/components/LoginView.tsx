import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SiGoogle } from "react-icons/si";
import { Users, Shield, Link2, AlertCircle } from "lucide-react";

interface LoginViewProps {
  onLogin: () => void;
  inviteToken?: string;
  inviterName?: string;
  error?: string;
}

export default function LoginView({ onLogin, inviteToken, inviterName, error }: LoginViewProps) {
  const isInviteFlow = !!inviteToken;

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
                <p className="text-sm font-medium text-destructive">Sign In Failed</p>
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
              {isInviteFlow ? "Accept Invitation" : "Sign In"}
            </CardTitle>
            <CardDescription>
              {isInviteFlow 
                ? "Sign in with Google to join the community"
                : "Sign in to access your membership dashboard"
              }
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button 
              className="w-full bg-purple-600 hover:bg-purple-700" 
              size="lg"
              onClick={onLogin}
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
