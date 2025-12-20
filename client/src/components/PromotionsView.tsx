import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import PromotionCard from "./PromotionCard";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import type { PromotionRequest, User, Vote } from "@shared/schema";

interface PromotionWithDetails extends PromotionRequest {
  candidate: User;
  createdBy: User;
  votes: Vote[];
  votesFor: number;
  votesAgainst: number;
}

export default function PromotionsView() {
  const [tab, setTab] = useState("open");
  const { toast } = useToast();
  const { user } = useAuth();

  const { data: promotions = [], isLoading } = useQuery<PromotionWithDetails[]>({
    queryKey: ["/api/promotions"],
  });

  const voteMutation = useMutation({
    mutationFn: async ({ id, vote, comment }: { id: string; vote: "for" | "against"; comment?: string }) => {
      const response = await apiRequest("POST", `/api/promotions/${id}/vote`, { vote, comment });
      return response.json();
    },
    onSuccess: (data, { vote }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/promotions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({
        title: "Vote Submitted",
        description: `You voted ${vote} the promotion.${data.promotionStatus === "approved" ? " The promotion was approved!" : ""}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Vote Failed",
        description: error.message || "Failed to submit vote",
        variant: "destructive",
      });
    },
  });

  const handleVote = (id: string, vote: "for" | "against", comment?: string) => {
    voteMutation.mutate({ id, vote, comment });
  };

  const openPromotions = promotions.filter(p => p.status === "open");
  const closedPromotions = promotions.filter(p => p.status !== "open");

  const hasUserVoted = (promo: PromotionWithDetails) => {
    return promo.votes.some(v => v.voterUserId === user?.id);
  };

  const canUserVote = (promo: PromotionWithDetails) => {
    if (!user) return false;
    return user.level >= promo.allowedVoterMinLevel;
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Promotions & Demotions</h1>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="open" data-testid="tab-open-promotions">
            Open ({openPromotions.length})
          </TabsTrigger>
          <TabsTrigger value="closed" data-testid="tab-closed-promotions">
            Closed ({closedPromotions.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="open" className="space-y-3 mt-4">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-32" />
              <Skeleton className="h-32" />
            </div>
          ) : openPromotions.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No open promotion requests</p>
          ) : (
            openPromotions.map(promotion => (
              <PromotionCard
                key={promotion.id}
                id={promotion.id}
                candidateName={promotion.candidate.username || `${promotion.candidate.firstName || ""} ${promotion.candidate.lastName || ""}`.trim() || "Unknown"}
                candidateImage={promotion.candidate.profileImageUrl || undefined}
                currentLevel={promotion.currentLevel as 1 | 2 | 3 | 4 | 5}
                proposedLevel={promotion.proposedLevel as 1 | 2 | 3 | 4 | 5}
                createdByName={promotion.createdBy.username || `${promotion.createdBy.firstName || ""} ${promotion.createdBy.lastName || ""}`.trim() || "Unknown"}
                justification={promotion.justification}
                createdAt={new Date(promotion.createdAt || Date.now())}
                votesFor={promotion.votesFor}
                votesAgainst={promotion.votesAgainst}
                requiredVotes={promotion.requiredVotes}
                status={promotion.status as "open" | "approved" | "rejected" | "expired"}
                requestType={promotion.requestType as "PROMOTE" | "DEMOTE" | "PROMOTE_TO_5" | "DEMOTE_FROM_5" | undefined}
                allowedVoterMinLevel={promotion.allowedVoterMinLevel}
                hasVoted={hasUserVoted(promotion)}
                canVote={canUserVote(promotion)}
                onVote={handleVote}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="closed" className="space-y-3 mt-4">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-32" />
            </div>
          ) : closedPromotions.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No closed promotions yet</p>
          ) : (
            closedPromotions.map(promotion => (
              <PromotionCard
                key={promotion.id}
                id={promotion.id}
                candidateName={promotion.candidate.username || `${promotion.candidate.firstName || ""} ${promotion.candidate.lastName || ""}`.trim() || "Unknown"}
                candidateImage={promotion.candidate.profileImageUrl || undefined}
                currentLevel={promotion.currentLevel as 1 | 2 | 3 | 4 | 5}
                proposedLevel={promotion.proposedLevel as 1 | 2 | 3 | 4 | 5}
                createdByName={promotion.createdBy.username || `${promotion.createdBy.firstName || ""} ${promotion.createdBy.lastName || ""}`.trim() || "Unknown"}
                justification={promotion.justification}
                createdAt={new Date(promotion.createdAt || Date.now())}
                votesFor={promotion.votesFor}
                votesAgainst={promotion.votesAgainst}
                requiredVotes={promotion.requiredVotes}
                status={promotion.status as "open" | "approved" | "rejected" | "expired"}
                requestType={promotion.requestType as "PROMOTE" | "DEMOTE" | "PROMOTE_TO_5" | "DEMOTE_FROM_5" | undefined}
                allowedVoterMinLevel={promotion.allowedVoterMinLevel}
                hasVoted={hasUserVoted(promotion)}
                canVote={false}
                onVote={handleVote}
              />
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
