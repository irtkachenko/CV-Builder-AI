import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api, buildUrl } from "@shared/routes";
import { z } from "zod";
import i18n from "@/lib/i18n";
import { parseWithLogging } from "@/utils/validation";

// Input type for file upload
type GenerateCvInput = {
  templateId: number;
  file: File;
  generationPrompt?: string;
};

export function useGenerateCv() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: GenerateCvInput) => {
      // Create FormData for file upload
      const formData = new FormData();
      formData.append('file', data.file);
      formData.append('templateId', data.templateId.toString());
      if (data.generationPrompt?.trim()) {
        formData.append('generationPrompt', data.generationPrompt.trim());
      }
      formData.append("temperature", "0.5");

      const res = await fetch(api.generate.start.path, {
        method: api.generate.start.method,
        body: formData,
        credentials: "include",
        headers: {
          'x-language': i18n.language || 'ua'
        }
      });

      if (!res.ok) {
        if (res.status === 400 || res.status === 429) {
          const error = await res.json();
          throw new Error(error.message || i18n.t("errors.validation_failed"));
        }
        throw new Error(i18n.t("errors.generate_start_failed"));
      }

      const responseData = await res.json();
      return parseWithLogging(api.generate.start.responses[202], responseData, "generate.start");
    },
    retry: 1, // Retry once for generation failures
    retryDelay: 2000, // Wait 2 seconds before retry
    onSuccess: () => {
      // Invalidate the resumes list to show the new pending CV
      queryClient.invalidateQueries({ queryKey: [api.resumes.list.path] });
      // Scroll to top to show the new CV being generated
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
}

// Hook for polling an individual CV's status
export function usePollingJob(jobId: number, initialStatus: string) {
  const isJobActive = initialStatus === "pending" || initialStatus === "processing";
  const pollingScope = isJobActive ? "active" : "inactive";
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [api.generate.status.path, jobId, pollingScope],
    queryFn: async () => {
      const url = buildUrl(api.generate.status.path, { jobId });

      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        throw new Error(i18n.t("errors.fetch_job_status_failed"));
      }

      const data = await res.json();

      const parsed = parseWithLogging(api.generate.status.responses[200], data, "generate.status");

      return parsed;
    },
    // Override global staleTime Infinity so polling can restart from cached complete state
    staleTime: 0,
    refetchOnMount: "always",
    // Retry logic for polling
    retry: (failureCount, error) => {
      // Aggressive retry for polling since it's critical
      if (failureCount < 5) {
        console.warn(`Job status poll attempt ${failureCount + 1} failed:`, error);
        return true;
      }
      return false;
    },
    retryDelay: (attemptIndex) => {
      // Faster retry for polling (1s, 2s, 4s, 8s, 16s max)
      return Math.min(1000 * 2 ** attemptIndex, 16000);
    },
    // Poll every 2 seconds if status is still pending or processing
    refetchInterval: (query) => {
      const currentStatus = query.state.data?.status || initialStatus;
      if (currentStatus === "pending" || currentStatus === "processing") {
        return 2000;
      }
      return false;
    },
    enabled: jobId > 0 && isJobActive,
  });

  // Handle side effects (like invalidating queries) in useEffect, not in queryFn
  useEffect(() => {
    if (query.data?.status === "complete" || query.data?.status === "failed") {
      queryClient.invalidateQueries({ queryKey: [api.resumes.list.path] });
    }
  }, [query.data?.status, queryClient, jobId]);

  return query;
}
