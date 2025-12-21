import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import UserAvatar from "./UserAvatar";
import LevelBadge from "./LevelBadge";
import StatusDot from "./StatusDot";
import { Calendar, Users, Link2, User, ArrowUpCircle, ArrowDownCircle, Shield, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { User as UserType } from "@shared/schema";

interface Level5GovernanceInfo {
  level5Count: number;
  voteThreshold: number;
  canBootstrap: boolean;
  rules: {
    description: string;
  };
}

interface UserWithDetails extends UserType {
  inviter?: UserType;
  invitees: UserType[];
  inviteCount: number;
}

interface MemberDetailSheetProps {
  memberId: string | null;
  onClose: () => void;
}

export default function MemberDetailSheet({ memberId, onClose }: MemberDetailSheetProps) {
  const [isPromoteDialogOpen, setIsPromoteDialogOpen] = useState(false);
  const [isLevel5DialogOpen, setIsLevel5DialogOpen] = useState(false);
  const [isDemoteDialogOpen, setIsDemoteDialogOpen] = useState(false);
  const [isSetLevelDialogOpen, setIsSetLevelDialogOpen] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState<string>("");
  const [selectedDirectLevel, setSelectedDirectLevel] = useState<string>("");
  const [justification, setJustification] = useState("");
  const [directLevelReason, setDirectLevelReason] = useState("");
  const { toast } = useToast();
  const { user: currentUser } = useAuth();

  const { data: member, isLoading } = useQuery<UserWithDetails>({
    queryKey: ["/api/users", memberId],
    enabled: !!memberId,
  });

  const { data: governanceInfo } = useQuery<Level5GovernanceInfo>({
    queryKey: ["/api/level5-governance"],
    enabled: currentUser?.level === 5,
  });

  const createPromotionMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("POST", "/api/promotions", data);
      return response.json();
    },
    onSuccess: (_, variables) => {
      const isLevel5Request = variables.requestType === "PROMOTE_TO_5" || variables.requestType === "DEMOTE_FROM_5";
      toast({ 
        title: isLevel5Request ? "Level 5 Governance Request Created" : "Promotion Request Created", 
        description: isLevel5Request 
          ? "Level 5 members will now vote on this request."
          : "Level 4+ members will now vote on this promotion."
      });
      setIsPromoteDialogOpen(false);
      setIsLevel5DialogOpen(false);
      setIsDemoteDialogOpen(false);
      setSelectedLevel("");
      setJustification("");
      queryClient.invalidateQueries({ queryKey: ["/api/promotions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/level5-governance"] });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Create Request",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    },
  });

  const bootstrapPromoteMutation = useMutation({
    mutationFn: async (data: { candidateUserId: string; reason: string }) => {
      const response = await apiRequest("POST", "/api/level5-governance/bootstrap-promote", data);
      return response.json();
    },
    onSuccess: () => {
      toast({ 
        title: "Bootstrap Promotion Complete", 
        description: "User has been directly promoted to Level 5."
      });
      setIsLevel5DialogOpen(false);
      setJustification("");
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/level5-governance"] });
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Bootstrap Promote",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    },
  });

  const setLevelDirectlyMutation = useMutation({
    mutationFn: async ({ userId, newLevel, reason }: { userId: string; newLevel: number; reason: string }) => {
      const response = await apiRequest("POST", `/api/users/${userId}/level`, { newLevel, reason });
      return response.json();
    },
    onSuccess: () => {
      toast({ 
        title: "Level Set Successfully", 
        description: "The member's level has been updated directly."
      });
      setIsSetLevelDialogOpen(false);
      setSelectedDirectLevel("");
      setDirectLevelReason("");
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      onClose();
    },
    onError: (error: any) => {
      let errorMessage = "An error occurred";
      
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
      
      toast({
        title: "Failed to Set Level",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const handlePromoteSubmit = () => {
    if (!member) return;

    createPromotionMutation.mutate({
      candidateUserId: member.id,
      currentLevel: member.level,
      proposedLevel: parseInt(selectedLevel),
      justification,
    });
  };

  const handleLevel5PromoteSubmit = () => {
    if (!member) return;

    if (governanceInfo?.canBootstrap) {
      bootstrapPromoteMutation.mutate({
        candidateUserId: member.id,
        reason: justification,
      });
    } else {
      createPromotionMutation.mutate({
        candidateUserId: member.id,
        currentLevel: member.level,
        proposedLevel: 5,
        justification,
        requestType: "PROMOTE_TO_5",
      });
    }
  };

  const handleDemoteSubmit = () => {
    if (!member) return;

    createPromotionMutation.mutate({
      candidateUserId: member.id,
      currentLevel: member.level,
      proposedLevel: 4,
      justification,
      requestType: "DEMOTE_FROM_5",
    });
  };

  const isOpen = !!memberId;
  const displayName = member ? (member.username || `${member.firstName || ""} ${member.lastName || ""}`.trim() || "Unknown") : "";
  
  // Standard promotion (Level 4+, for promotions up to Level 4)
  const canPropose = currentUser && 
    member && 
    currentUser.id !== member.id && 
    currentUser.level >= 4 && 
    member.level < currentUser.level &&
    member.level < 5; // Don't show standard promote for Level 5

  // Level 5 promotion (only for Level 5 users, target must be < Level 5)
  const canProposeLevel5Promotion = currentUser && 
    member && 
    currentUser.id !== member.id && 
    currentUser.level === 5 && 
    member.level < 5;

  // Level 5 demotion (only for Level 5 users, target must be Level 5)
  const canProposeDemotion = currentUser && 
    member && 
    currentUser.id !== member.id && 
    currentUser.level === 5 && 
    member.level === 5 &&
    governanceInfo && 
    governanceInfo.level5Count > 1; // Cannot demote last Level 5

  // Direct level setting (Level 5 only, for users < Level 5)
  const canSetLevelDirectly = currentUser && 
    member && 
    currentUser.id !== member.id && 
    currentUser.level === 5 && 
    member.level < 5;

  const availableLevels = member && currentUser 
    ? [2, 3, 4].filter(l => l > member.level && l <= Math.min(currentUser.level, 4))
    : [];

  const availableDirectLevels = member 
    ? [1, 2, 3, 4].filter(l => l !== member.level)
    : [];

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Member Profile</SheetTitle>
        </SheetHeader>

        {isLoading ? (
          <div className="space-y-4 mt-6">
            <div className="flex flex-col items-center">
              <Skeleton className="h-20 w-20 rounded-full" />
              <Skeleton className="h-6 w-32 mt-4" />
              <Skeleton className="h-4 w-48 mt-2" />
            </div>
            <Skeleton className="h-24" />
            <Skeleton className="h-32" />
          </div>
        ) : member ? (
          <div className="space-y-6 mt-6">
            <div className="flex flex-col items-center text-center">
              <UserAvatar
                name={displayName}
                imageUrl={member.profileImageUrl || undefined}
                level={member.level as 1 | 2 | 3 | 4 | 5}
                size="lg"
              />
              <h2 className="text-xl font-bold mt-4">{displayName}</h2>
              {member.email && <p className="text-sm text-muted-foreground">{member.email}</p>}
              <div className="flex items-center gap-2 mt-2">
                <LevelBadge level={member.level as 1 | 2 | 3 | 4 | 5} />
                <StatusDot status={member.status as "active" | "suspended" | "expelled"} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Card>
                <CardContent className="p-3 text-center">
                  <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                    <Calendar className="h-3.5 w-3.5" />
                    <span className="text-xs">Joined</span>
                  </div>
                  <p className="font-medium text-sm">
                    {member.createdAt ? format(new Date(member.createdAt), "MMM d, yyyy") : "Unknown"}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                    <Link2 className="h-3.5 w-3.5" />
                    <span className="text-xs">Invited</span>
                  </div>
                  <p className="font-medium text-sm">{member.inviteCount} people</p>
                </CardContent>
              </Card>
            </div>

            {member.inviter && (
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-1 text-muted-foreground mb-3">
                    <User className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium">Invited by</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <UserAvatar
                      name={member.inviter.username || `${member.inviter.firstName || ""} ${member.inviter.lastName || ""}`.trim() || "Unknown"}
                      imageUrl={member.inviter.profileImageUrl || undefined}
                      level={member.inviter.level as 1 | 2 | 3 | 4 | 5}
                      size="sm"
                    />
                    <div>
                      <p className="font-medium text-sm">
                        {member.inviter.username || `${member.inviter.firstName || ""} ${member.inviter.lastName || ""}`.trim() || member.inviter.email}
                      </p>
                      <LevelBadge level={member.inviter.level as 1 | 2 | 3 | 4 | 5} size="sm" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {member.invitees && member.invitees.length > 0 && (
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-1 text-muted-foreground mb-3">
                    <Users className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium">People Invited ({member.invitees.length})</span>
                  </div>
                  <div className="space-y-2">
                    {member.invitees.slice(0, 5).map((invitee) => (
                      <div key={invitee.id} className="flex items-center gap-2">
                        <UserAvatar
                          name={invitee.username || `${invitee.firstName || ""} ${invitee.lastName || ""}`.trim() || "Unknown"}
                          imageUrl={invitee.profileImageUrl || undefined}
                          level={invitee.level as 1 | 2 | 3 | 4 | 5}
                          size="sm"
                        />
                        <span className="text-sm">
                          {invitee.username || `${invitee.firstName || ""} ${invitee.lastName || ""}`.trim() || invitee.email}
                        </span>
                        <LevelBadge level={invitee.level as 1 | 2 | 3 | 4 | 5} size="sm" />
                      </div>
                    ))}
                    {member.invitees.length > 5 && (
                      <p className="text-xs text-muted-foreground">
                        + {member.invitees.length - 5} more
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="space-y-2">
              {canPropose && availableLevels.length > 0 && (
                <Button 
                  className="w-full" 
                  variant="outline" 
                  onClick={() => setIsPromoteDialogOpen(true)}
                  data-testid="button-propose-promotion-sheet"
                >
                  <ArrowUpCircle className="h-4 w-4 mr-2" />
                  Propose Promotion
                </Button>
              )}
              
              {canSetLevelDirectly && (
                <Button 
                  className="w-full" 
                  variant="default" 
                  onClick={() => setIsSetLevelDialogOpen(true)}
                  data-testid="button-set-level-directly-sheet"
                >
                  <Shield className="h-4 w-4 mr-2" />
                  Set Level Directly
                </Button>
              )}
              
              {canProposeLevel5Promotion && (
                <Button 
                  className="w-full" 
                  variant="default" 
                  onClick={() => setIsLevel5DialogOpen(true)}
                  data-testid="button-propose-level5-promotion"
                >
                  <Shield className="h-4 w-4 mr-2" />
                  {governanceInfo?.canBootstrap ? "Promote to Level 5 (Direct)" : "Propose Level 5 Promotion"}
                </Button>
              )}
              
              {canProposeDemotion && (
                <Button 
                  className="w-full" 
                  variant="destructive" 
                  onClick={() => setIsDemoteDialogOpen(true)}
                  data-testid="button-propose-demotion"
                >
                  <ArrowDownCircle className="h-4 w-4 mr-2" />
                  Propose Demotion from Level 5
                </Button>
              )}
            </div>
          </div>
        ) : null}

        <Dialog open={isPromoteDialogOpen} onOpenChange={setIsPromoteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Propose Level Promotion</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-3 p-3 bg-muted rounded-md">
                <UserAvatar
                  name={displayName}
                  imageUrl={member?.profileImageUrl || undefined}
                  level={member?.level as 1 | 2 | 3 | 4 | 5}
                  size="sm"
                />
                <div>
                  <p className="font-medium text-sm">{displayName}</p>
                  <p className="text-xs text-muted-foreground">Currently Level {member?.level}</p>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Propose New Level</Label>
                <Select value={selectedLevel} onValueChange={setSelectedLevel}>
                  <SelectTrigger data-testid="select-new-level-sheet">
                    <SelectValue placeholder="Select level" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableLevels.map(level => (
                      <SelectItem key={level} value={level.toString()}>
                        Level {level}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Justification</Label>
                <Textarea
                  placeholder="Explain why this member deserves a promotion..."
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  rows={3}
                  data-testid="input-justification-sheet"
                />
                <p className="text-xs text-muted-foreground">{justification.length}/500 characters</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsPromoteDialogOpen(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handlePromoteSubmit}
                disabled={!selectedLevel || justification.length < 10 || createPromotionMutation.isPending}
                data-testid="button-submit-promotion-sheet"
              >
                {createPromotionMutation.isPending ? "Submitting..." : "Submit Proposal"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={isLevel5DialogOpen} onOpenChange={setIsLevel5DialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                <div className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  {governanceInfo?.canBootstrap ? "Promote to Level 5" : "Propose Level 5 Promotion"}
                </div>
              </DialogTitle>
              <DialogDescription>
                {governanceInfo?.rules.description}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {governanceInfo?.canBootstrap && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    As the only Level 5 member, you can directly promote this user without voting. This is a one-time bootstrap action.
                  </AlertDescription>
                </Alert>
              )}
              <div className="flex items-center gap-3 p-3 bg-muted rounded-md">
                <UserAvatar
                  name={displayName}
                  imageUrl={member?.profileImageUrl || undefined}
                  level={member?.level as 1 | 2 | 3 | 4 | 5}
                  size="sm"
                />
                <div>
                  <p className="font-medium text-sm">{displayName}</p>
                  <p className="text-xs text-muted-foreground">
                    Currently Level {member?.level} → <span className="text-foreground font-medium">Level 5</span>
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Justification</Label>
                <Textarea
                  placeholder="Explain why this member should become Level 5 (Core)..."
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  rows={3}
                  data-testid="input-level5-justification"
                />
                <p className="text-xs text-muted-foreground">{justification.length}/500 characters</p>
              </div>
              {!governanceInfo?.canBootstrap && (
                <p className="text-sm text-muted-foreground">
                  This request requires {governanceInfo?.voteThreshold} votes from Level 5 members to be approved.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setIsLevel5DialogOpen(false); setJustification(""); }}>
                Cancel
              </Button>
              <Button 
                onClick={handleLevel5PromoteSubmit}
                disabled={justification.length < 10 || createPromotionMutation.isPending || bootstrapPromoteMutation.isPending}
                data-testid="button-submit-level5-promotion"
              >
                {createPromotionMutation.isPending || bootstrapPromoteMutation.isPending 
                  ? "Submitting..." 
                  : governanceInfo?.canBootstrap 
                    ? "Promote Now" 
                    : "Submit Proposal"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={isDemoteDialogOpen} onOpenChange={setIsDemoteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                <div className="flex items-center gap-2 text-destructive">
                  <ArrowDownCircle className="h-5 w-5" />
                  Propose Demotion from Level 5
                </div>
              </DialogTitle>
              <DialogDescription>
                {governanceInfo?.rules.description}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  This will create a request to demote this Level 5 member to Level 4. This is a serious action that requires voting approval.
                </AlertDescription>
              </Alert>
              <div className="flex items-center gap-3 p-3 bg-muted rounded-md">
                <UserAvatar
                  name={displayName}
                  imageUrl={member?.profileImageUrl || undefined}
                  level={member?.level as 1 | 2 | 3 | 4 | 5}
                  size="sm"
                />
                <div>
                  <p className="font-medium text-sm">{displayName}</p>
                  <p className="text-xs text-muted-foreground">
                    Currently Level 5 → <span className="text-destructive font-medium">Level 4</span>
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Justification</Label>
                <Textarea
                  placeholder="Explain why this member should be demoted from Level 5..."
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  rows={3}
                  data-testid="input-demotion-justification"
                />
                <p className="text-xs text-muted-foreground">{justification.length}/500 characters</p>
              </div>
              <p className="text-sm text-muted-foreground">
                This request requires {governanceInfo?.voteThreshold} votes from Level 5 members to be approved.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setIsDemoteDialogOpen(false); setJustification(""); }}>
                Cancel
              </Button>
              <Button 
                variant="destructive"
                onClick={handleDemoteSubmit}
                disabled={justification.length < 10 || createPromotionMutation.isPending}
                data-testid="button-submit-demotion"
              >
                {createPromotionMutation.isPending ? "Submitting..." : "Submit Demotion Proposal"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={isSetLevelDialogOpen} onOpenChange={setIsSetLevelDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Set Level Directly</DialogTitle>
              <DialogDescription>
                As a Level 5 member, you can directly set levels for members below Level 5 without voting.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-3 p-3 bg-muted rounded-md">
                <UserAvatar
                  name={displayName}
                  imageUrl={member?.profileImageUrl || undefined}
                  level={member?.level as 1 | 2 | 3 | 4 | 5}
                  size="sm"
                />
                <div>
                  <p className="font-medium text-sm">{displayName}</p>
                  <p className="text-xs text-muted-foreground">
                    Currently Level {member?.level}
                    {selectedDirectLevel && ` → Level ${selectedDirectLevel}`}
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Set New Level</Label>
                <Select value={selectedDirectLevel} onValueChange={setSelectedDirectLevel}>
                  <SelectTrigger data-testid="select-direct-level-sheet">
                    <SelectValue placeholder="Select level" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableDirectLevels.map(level => (
                      <SelectItem key={level} value={level.toString()}>
                        Level {level}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Reason</Label>
                <Textarea
                  placeholder="Explain why you're setting this level..."
                  value={directLevelReason}
                  onChange={(e) => setDirectLevelReason(e.target.value)}
                  rows={3}
                  data-testid="input-direct-level-reason-sheet"
                />
                <p className="text-xs text-muted-foreground">{directLevelReason.length}/500 characters</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setIsSetLevelDialogOpen(false); setSelectedDirectLevel(""); setDirectLevelReason(""); }}>
                Cancel
              </Button>
              <Button 
                onClick={() => {
                  if (!member || !selectedDirectLevel || directLevelReason.length < 10) return;
                  setLevelDirectlyMutation.mutate({
                    userId: member.id,
                    newLevel: parseInt(selectedDirectLevel, 10),
                    reason: directLevelReason,
                  });
                }}
                disabled={!selectedDirectLevel || directLevelReason.length < 10 || setLevelDirectlyMutation.isPending}
                data-testid="button-submit-direct-level-sheet"
              >
                {setLevelDirectlyMutation.isPending ? "Setting..." : "Set Level"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}
