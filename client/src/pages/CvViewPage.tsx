import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Download, Loader2, FileText, CheckCircle, Sparkles, AlertCircle, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { api, buildUrl } from "@shared/routes";
import { GeneratedCvResponse } from "@shared/schema";
import { generatePdfFromUrl } from "@/lib/pdf-generator-fixed";
import { usePollingJob } from "@/hooks/use-generate";
import { useQueryClient } from "@tanstack/react-query";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "react-i18next";
import { useCvIframePreview } from "@/hooks/use-cv-iframe-preview";

const AI_EDIT_PROMPT_MIN_LENGTH = 10;
const AI_EDIT_PROMPT_MAX_LENGTH = 1000;

function withCacheBust(url: string | null | undefined, marker: string | number | Date): string | null {
  if (!url) return null;
  const separator = url.includes("?") ? "&" : "?";
  const markerValue = marker instanceof Date ? marker.getTime() : marker;
  return `${url}${separator}v=${encodeURIComponent(String(markerValue))}`;
}

export default function CvViewPage() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const [cvData, setCvData] = useState<GeneratedCvResponse | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isAiDialogOpen, setIsAiDialogOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [useOriginalDocumentContext, setUseOriginalDocumentContext] = useState(false);
  const [isSubmittingAiEdit, setIsSubmittingAiEdit] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const lastFailedMessageRef = useRef<string | null>(null);
  const syncedTerminalStatusRef = useRef<string | null>(null);

  const fetchCvData = useCallback(async () => {
    if (!id) return;

    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(`/api/resumes/${id}`, {
        credentials: "include",
      });

      if (!response.ok) {
        if (response.status === 404) {
          setError(t("cv_view.errors.not_found"));
        } else {
          setError(t("cv_view.errors.load_failed"));
        }
        return;
      }

      const data: GeneratedCvResponse = await response.json();
      setCvData(data);
      setPdfUrl(withCacheBust(data.pdfUrl, data.updatedAt || Date.now()));

      queryClient.setQueryData([api.resumes.list.path], (oldData: GeneratedCvResponse[] | undefined) => {
        if (!oldData || !Array.isArray(oldData)) return oldData;
        return oldData.map((item) => (item.id === data.id ? { ...item, ...data } : item));
      });
    } catch (err) {
      console.error("Error fetching CV:", err);
      setError(t("cv_view.errors.load_failed"));
    } finally {
      setIsLoading(false);
    }
  }, [id, queryClient, t]);

  useEffect(() => {
    fetchCvData();
  }, [fetchCvData]);

  const pollingInitialStatus = cvData?.status || "complete";
  const { data: polledJob } = usePollingJob(cvData?.id || 0, pollingInitialStatus);

  useEffect(() => {
    if (!polledJob) return;

    setCvData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        status: polledJob.status,
        progress: polledJob.progress ?? prev.progress,
        errorMessage: polledJob.errorMessage ?? prev.errorMessage,
        pdfUrl: polledJob.pdfUrl ?? prev.pdfUrl,
        template: polledJob.template || prev.template,
      };
    });

    if (polledJob.pdfUrl) {
      const shouldBust = polledJob.status === "complete" || polledJob.status === "failed";
      setPdfUrl(shouldBust ? withCacheBust(polledJob.pdfUrl, Date.now()) : polledJob.pdfUrl);
    }

    if (polledJob.status === "complete" && polledJob.errorMessage) {
      if (lastFailedMessageRef.current !== polledJob.errorMessage) {
        lastFailedMessageRef.current = polledJob.errorMessage;
        toast({
          title: t("cv_view.toasts.ai_edit_failed_title"),
          description: polledJob.errorMessage,
          variant: "destructive",
        });
      }
    }

    if (polledJob.status === "complete" || polledJob.status === "failed") {
      if (syncedTerminalStatusRef.current !== polledJob.status) {
        syncedTerminalStatusRef.current = polledJob.status;
        fetchCvData();
      }
    } else {
      syncedTerminalStatusRef.current = null;
    }
  }, [polledJob, fetchCvData, t, toast]);

  useEffect(() => {
    if (!cvData || cvData.status !== "failed") return;

    const errorMessage = cvData.errorMessage || t("cv_view.toasts.ai_edit_failed_fallback");
    if (lastFailedMessageRef.current === errorMessage) return;

    lastFailedMessageRef.current = errorMessage;
    toast({
      title: t("cv_view.toasts.ai_edit_failed_title"),
      description: errorMessage,
      variant: "destructive",
    });
  }, [cvData, t, toast]);

  useEffect(() => {
    const hasOriginalContext =
      Boolean(cvData?.originalDocText?.trim()) ||
      (Array.isArray(cvData?.originalDocLinks) && cvData.originalDocLinks.length > 0);
    if (!hasOriginalContext && useOriginalDocumentContext) {
      setUseOriginalDocumentContext(false);
    }
  }, [cvData?.originalDocText, cvData?.originalDocLinks, useOriginalDocumentContext]);

  const { scale, iframeHeight, iframeReady, handleIframeLoad } = useCvIframePreview({
    containerRef,
    sourceUrl: pdfUrl,
    paddingPx: 32,
    enabled: Boolean(cvData),
    defaultHeight: "297mm",
  });

  const handleDownloadPDF = async () => {
    if (!cvData?.id || !pdfUrl) {
      toast({
        title: t("cv_view.toasts.download_failed_title"),
        description: t("cv_view.toasts.download_failed_desc"),
        variant: "destructive",
      });
      return;
    }

    try {
      setIsGeneratingPdf(true);
      await generatePdfFromUrl({
        url: pdfUrl,
        filename: `cv-${cvData.id}.pdf`,
        windowWidth: 800,
        contentWidthMm: 190,
        autoPrint: true,
      });
      toast({
        title: t("cv_view.toasts.pdf_generated_title"),
        description: t("cv_view.toasts.pdf_generated_desc"),
      });
    } catch (downloadError) {
      console.error("Error generating PDF:", downloadError);
      toast({
        title: t("cv_view.toasts.pdf_generation_failed_title"),
        description: t("cv_view.toasts.pdf_generation_failed_desc"),
        variant: "destructive",
      });
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleSubmitAiEdit = async () => {
    if (!cvData) return;

    const trimmedPrompt = aiPrompt.replace(/\u0000/g, "").trim();
    if (trimmedPrompt.length < AI_EDIT_PROMPT_MIN_LENGTH) {
      toast({
        title: t("cv_view.toasts.prompt_too_short_title"),
        description: t("cv_view.toasts.prompt_too_short_desc", { min: AI_EDIT_PROMPT_MIN_LENGTH }),
        variant: "destructive",
      });
      return;
    }

    if (trimmedPrompt.length > AI_EDIT_PROMPT_MAX_LENGTH) {
      toast({
        title: t("cv_view.toasts.prompt_too_long_title"),
        description: t("cv_view.toasts.prompt_too_long_desc", { max: AI_EDIT_PROMPT_MAX_LENGTH }),
        variant: "destructive",
      });
      return;
    }

    try {
      setIsSubmittingAiEdit(true);
      const url = buildUrl(api.resumes.aiEdit.path, { id: cvData.id });
      const response = await fetch(url, {
        method: api.resumes.aiEdit.method,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: trimmedPrompt,
          useOriginalDocumentContext: hasOriginalDocumentContext ? useOriginalDocumentContext : false,
          temperature: 0.5,
        }),
      });

      if (!response.ok) {
        let message = t("cv_view.errors.ai_edit_start_failed");
        try {
          const errorBody = await response.json();
          if (typeof errorBody?.message === "string" && errorBody.message) {
            message = errorBody.message;
          }
        } catch {
          // Ignore JSON parse errors
        }

        toast({
          title:
            response.status === 429
              ? t("cv_view.errors.rate_limit_exceeded")
              : t("cv_view.errors.ai_edit_rejected"),
          description: message,
          variant: "destructive",
        });
        return;
      }

      const startPayload = await response.json();
      void startPayload;

      setCvData((prev) =>
        prev
          ? {
              ...prev,
              status: "processing",
              progress: t("cv_view.progress.ai_editing"),
              errorMessage: null,
            }
          : prev
      );

      queryClient.setQueryData([api.generate.status.path, cvData.id, "active"], {
        id: cvData.id,
        status: "processing",
        progress: t("cv_view.progress.ai_editing"),
        pdfUrl: cvData.pdfUrl || undefined,
        errorMessage: undefined,
        template: cvData.template,
      });
      queryClient.setQueryData([api.resumes.list.path], (oldData: GeneratedCvResponse[] | undefined) => {
        if (!oldData || !Array.isArray(oldData)) return oldData;
        return oldData.map((item) =>
          item.id === cvData.id
            ? {
                ...item,
                status: "processing",
                progress: t("cv_view.progress.ai_editing"),
                errorMessage: null,
              }
            : item
        );
      });
      queryClient.invalidateQueries({ queryKey: [api.resumes.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.generate.status.path, cvData.id, "active"] });

      setIsAiDialogOpen(false);
      setAiPrompt("");
      toast({
        title: t("cv_view.toasts.ai_edit_started_title"),
        description: t("cv_view.toasts.ai_edit_started_desc"),
      });
    } catch (submitError) {
      console.error("AI edit submit error:", submitError);
      toast({
        title: t("cv_view.toasts.ai_edit_failed_title"),
        description: t("cv_view.toasts.ai_edit_failed_desc"),
        variant: "destructive",
      });
    } finally {
      setIsSubmittingAiEdit(false);
    }
  };

  const handleGoBack = () => {
    setLocation("/my-resumes");
  };

  if (isLoading && !cvData) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">{t("cv_view.loading")}</p>
        </div>
      </div>
    );
  }

  if (error || !cvData) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold text-foreground mb-4">{t("cv_view.errors.not_found")}</h1>
          <p className="text-muted-foreground mb-6">{error || t("cv_view.errors.load_failed")}</p>
          <button
            onClick={handleGoBack}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {t("cv_view.back_to_my_cvs")}
          </button>
        </div>
      </div>
    );
  }

  const isProcessing = cvData.status === "pending" || cvData.status === "processing";
  const isFailed = cvData.status === "failed";
  const canEditWithAi = !isProcessing && !isSubmittingAiEdit;
  const hasOriginalDocumentContext =
    Boolean(cvData.originalDocText?.trim()) ||
    (Array.isArray(cvData.originalDocLinks) && cvData.originalDocLinks.length > 0);
  const statusLabel = isProcessing ? t("cv_view.status.processing") : isFailed ? t("cv_view.status.failed") : t("cv_view.status.completed");

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40 print:hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-4">
              <button
                onClick={handleGoBack}
                className="flex items-center gap-2 px-3 py-2 text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="font-medium">{t("common.back")}</span>
              </button>
              <div className="hidden sm:block h-6 w-px bg-gray-300" />
              <div className="hidden sm:block">
                <h1 className="text-lg font-semibold text-gray-900">{t("cv_view.title")}</h1>
                <p className="text-sm text-gray-500">{cvData.name || cvData.template?.name || t("cv_view.professional_cv")}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setUseOriginalDocumentContext(false);
                  setIsAiDialogOpen(true);
                }}
                disabled={!canEditWithAi}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                <Sparkles className="w-4 h-4" />
                <span className="hidden sm:inline">{t("cv_view.edit_with_ai")}</span>
              </button>

              <button
                onClick={handleDownloadPDF}
                disabled={isGeneratingPdf || isProcessing || !pdfUrl}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                {isGeneratingPdf ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="hidden sm:inline">{t("cv_view.generating")}</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span className="hidden sm:inline">{t("cv_view.download_pdf")}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
            className="bg-white rounded-xl shadow-2xl overflow-x-hidden"
          >
            <div className="bg-gray-50 border-b border-gray-200 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <div className="w-3 h-3 rounded-full bg-yellow-500" />
                <div className="w-3 h-3 rounded-full bg-green-500" />
              </div>
              <div className="text-sm text-gray-500 font-medium">{t("cv_view.a4_format")}</div>
            </div>

            <div
              ref={containerRef}
              className="bg-gray-100 px-4 sm:px-8 pt-4 sm:pt-8 pb-8 sm:pb-12 flex justify-center items-start overflow-x-hidden"
              style={{ minHeight: "500px" }}
            >
              <div
                className="transition-transform duration-200 ease-out"
                style={{
                  transform: `scale(${scale})`,
                  transformOrigin: "top center",
                  width: "210mm",
                  height: `calc(${iframeHeight} * ${scale})`,
                }}
              >
                <div
                  className="bg-white shadow-lg relative"
                  style={{
                    width: "210mm",
                    minWidth: "210mm",
                    height: iframeHeight,
                    minHeight: "297mm",
                  }}
                >
                  {isProcessing ? (
                    <div className="w-full h-full flex items-center justify-center bg-white">
                      <div className="text-center p-8">
                        <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-4" />
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">{t("cv_view.processing_title")}</h3>
                        <p className="text-gray-500">{cvData.progress || t("cv_view.please_wait")}</p>
                      </div>
                    </div>
                  ) : isFailed ? (
                    <div className="w-full h-full flex items-center justify-center bg-white">
                      <div className="text-center p-8 max-w-lg">
                        <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-4" />
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">{t("cv_view.failed_title")}</h3>
                        <p className="text-gray-500">
                          {cvData.errorMessage || t("cv_view.failed_desc")}
                        </p>
                      </div>
                    </div>
                  ) : pdfUrl ? (
                    <iframe
                      src={pdfUrl}
                      onLoad={handleIframeLoad}
                      className={`w-full h-full border-0 absolute top-0 left-0 transition-opacity duration-150 ${iframeReady ? "opacity-100" : "opacity-0"}`}
                      style={{
                        width: "210mm",
                        height: iframeHeight,
                      }}
                      title={t("cv_view.iframe_title")}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-white">
                      <div className="text-center p-8">
                        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                          <FileText className="w-8 h-8 text-gray-400" />
                        </div>
                        <h3 className="text-lg font-medium text-gray-900 mb-2">{t("cv_view.unavailable_title")}</h3>
                        <p className="text-gray-500">{t("cv_view.unavailable_desc")}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>

          <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                  <FileText className="w-5 h-5 text-blue-600" />
                </div>
                <h3 className="font-semibold text-gray-900">{t("cv_view.cards.format_title")}</h3>
              </div>
              <p className="text-gray-600 text-sm">{t("cv_view.cards.format_desc")}</p>
            </div>

            <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
              <div className="flex items-center gap-3 mb-3">
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    isFailed ? "bg-red-100" : isProcessing ? "bg-amber-100" : "bg-green-100"
                  }`}
                >
                  {isFailed ? (
                    <AlertCircle className="w-5 h-5 text-red-600" />
                  ) : isProcessing ? (
                    <Loader2 className="w-5 h-5 text-amber-600 animate-spin" />
                  ) : (
                    <CheckCircle className="w-5 h-5 text-green-600" />
                  )}
                </div>
                <h3 className="font-semibold text-gray-900">{t("cv_view.cards.status_title")}</h3>
              </div>
              <p className="text-gray-600 text-sm">{statusLabel}</p>
            </div>

            <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-purple-600" />
                </div>
                <h3 className="font-semibold text-gray-900">{t("cv_view.cards.updated_title")}</h3>
              </div>
              <p className="text-gray-600 text-sm">
                {new Date(cvData.updatedAt || cvData.createdAt).toLocaleString("uk-UA", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>
        </div>
      </main>

      <AnimatePresence>
        {isAiDialogOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-[1px]"
              onClick={!isSubmittingAiEdit ? () => setIsAiDialogOpen(false) : undefined}
            />
            <motion.div
              initial={{ opacity: 0, y: -14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              transition={{ duration: 0.18 }}
              className="fixed top-16 left-0 right-0 z-50 pointer-events-none px-3 sm:px-6 lg:px-8"
            >
              <div className="max-w-3xl mx-auto pointer-events-auto">
                <div className="rounded-2xl border border-gray-200 bg-white/95 backdrop-blur-sm shadow-2xl overflow-hidden">
                  <div className="px-4 sm:px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-lg sm:text-xl font-semibold text-gray-900">{t("cv_view.ai_panel.title")}</h2>
                      <p className="text-sm text-gray-600 mt-1">
                        {t("cv_view.ai_panel.description")}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsAiDialogOpen(false)}
                      disabled={isSubmittingAiEdit}
                      className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
                      aria-label={t("cv_view.ai_panel.close_aria")}
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="px-4 sm:px-6 py-4 space-y-3">
                    <Textarea
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      placeholder={t("cv_view.ai_panel.placeholder")}
                      className="min-h-[96px] max-h-[220px] resize-y"
                      maxLength={AI_EDIT_PROMPT_MAX_LENGTH}
                      disabled={isSubmittingAiEdit}
                    />
                    <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 bg-gray-50">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
                        checked={useOriginalDocumentContext}
                        onChange={(e) => setUseOriginalDocumentContext(e.target.checked)}
                        disabled={isSubmittingAiEdit || !hasOriginalDocumentContext}
                      />
                      <div>
                        <p className="text-sm font-medium text-gray-800">
                          {t("cv_view.ai_panel.use_original_context_label")}
                        </p>
                        <p className="text-xs text-gray-600 mt-0.5">
                          {hasOriginalDocumentContext
                            ? t("cv_view.ai_panel.use_original_context_hint")
                            : t("cv_view.ai_panel.use_original_context_unavailable")}
                        </p>
                      </div>
                    </label>
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-xs text-gray-500">
                        {t("cv_view.ai_panel.hint")}
                      </p>
                      <p className="text-xs text-gray-500">
                        {aiPrompt.length}/{AI_EDIT_PROMPT_MAX_LENGTH}
                      </p>
                    </div>
                  </div>

                  <div className="px-4 sm:px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setIsAiDialogOpen(false)}
                      className="px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-100"
                      disabled={isSubmittingAiEdit}
                    >
                      {t("common.close")}
                    </button>
                    <button
                      type="button"
                      onClick={handleSubmitAiEdit}
                      className="px-4 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                      disabled={isSubmittingAiEdit}
                    >
                      {isSubmittingAiEdit ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {t("common.sending")}
                        </span>
                      ) : (
                        t("common.send")
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <style
        dangerouslySetInnerHTML={{
          __html: `
          @media print {
            body {
              background: white !important;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            
            .print\\:hidden {
              display: none !important;
            }
            
            .bg-gray-100 {
              background: white !important;
            }
            
            .shadow-2xl {
              box-shadow: none !important;
            }
            
            .rounded-xl {
              border-radius: 0 !important;
            }
            
            @page {
              margin: 0;
              size: A4;
            }
          }
        `,
        }}
      />
    </div>
  );
}
