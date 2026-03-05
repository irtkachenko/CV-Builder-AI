import { useState, useRef } from "react";
import { usePollingJob } from "@/hooks/use-generate";
import { useDeleteResume } from "@/hooks/use-cvs";
import { FileText, Loader2, CheckCircle2, AlertCircle, Calendar, Eye, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { GeneratedCvResponse } from "@shared/routes";
import { useTranslation } from "react-i18next";
import { useCvIframePreview } from "@/hooks/use-cv-iframe-preview";
import { SmartImage } from "@/components/ui/smart-image";

export function CvStatusCard({ cv }: { cv: GeneratedCvResponse }) {
  const { t } = useTranslation();
  // Poll if status is pending/processing
  const { data: polledJob } = usePollingJob(cv.id, cv.status);

  const displayData = polledJob || cv;
  const isProcessing = displayData.status === "pending" || displayData.status === "processing";
  const isFailed = displayData.status === "failed";
  const isComplete = displayData.status === "complete";

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Use the centralized delete hook instead of manual implementation
  const { mutate: deleteCv, isPending: isDeleting } = useDeleteResume();

  const handleDelete = () => {
    deleteCv(cv.id, {
      onSuccess: () => {
        setIsDeleteDialogOpen(false);
      }
    });
  };

  const templateScreenshot = displayData.template?.screenshotUrl || cv.template?.screenshotUrl;
  const cvName = displayData.name || cv.name;
  const displayName = cvName || displayData.template?.name || cv.template?.name || t("common.template");
  const previewSourceUrl = isComplete ? displayData.pdfUrl : null;
  const { scale, iframeHeight, iframeReady, handleIframeLoad } = useCvIframePreview({
    containerRef,
    sourceUrl: previewSourceUrl,
    paddingPx: 16,
    enabled: isComplete,
    defaultHeight: "297mm",
  });

  return (
    <>
      {/* Delete Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cv_card.delete_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("cv_card.delete_desc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <button className="px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80">
                {t("common.cancel")}
              </button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete();
                }}
                disabled={isDeleting}
                className="px-4 py-2 bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 disabled:opacity-50"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    {t("common.deleting")}
                  </>
                ) : (
                  t("common.delete")
                )}
              </button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Link href={`/cv/${cv.id}`} className="block group">
        <div className="glass-card rounded-2xl overflow-hidden group relative flex flex-col cursor-pointer hover:shadow-xl transition-all duration-300">
          {/* Delete Button */}
          {!isProcessing && (
            <button
              disabled={isDeleting}
              className="absolute top-3 left-3 p-2 bg-destructive hover:bg-destructive/90 text-white rounded-full shadow-lg transition-all duration-200 hover:scale-110 hover:shadow-xl z-10 disabled:opacity-50 disabled:cursor-not-allowed"
              title={t("cv_card.delete_btn")}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDeleteDialogOpen(true);
              }}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}

          {/* Delete Processing Overlay */}
          {!isProcessing && isDeleteDialogOpen && isDeleting && (
            <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-20 flex items-center justify-center">
              <div className="text-center text-sm text-muted-foreground flex items-center">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                {t("common.deleting")}
              </div>
            </div>
          )}

          <div className="relative aspect-[4/5] lg:aspect-[1/1.414] bg-secondary/30 w-full overflow-hidden border-b border-border/50">
            {isComplete && displayData.pdfUrl ? (
              <div 
                ref={containerRef}
                className="w-full h-full flex justify-center items-start bg-gray-100 pt-4"
              >
                <div
                  className="transition-transform duration-200 ease-out"
                  style={{
                    transform: `scale(${scale})`,
                    transformOrigin: 'top center',
                    width: '210mm',
                    height: `calc(${iframeHeight} * ${scale})`,
                  }}
                >
                  <div
                    className="bg-white shadow-sm relative"
                    style={{
                      width: '210mm',
                      minWidth: '210mm',
                      height: iframeHeight,
                      minHeight: '297mm'
                    }}
                  >
                    <iframe
                      src={displayData.pdfUrl}
                      onLoad={handleIframeLoad}
                      className={`w-full h-full border-0 absolute top-0 left-0 transition-opacity duration-150 ${iframeReady ? "opacity-100" : "opacity-0"}`}
                      style={{
                        width: '210mm',
                        height: iframeHeight
                      }}
                      title={t("cv_card.iframe_title")}
                    />
                  </div>
                </div>
              </div>
            ) : templateScreenshot ? (
              <SmartImage
                src={templateScreenshot}
                alt={displayName}
                imgClassName={`transition-transform duration-500 group-hover:scale-105 ${isProcessing ? 'opacity-30 grayscale' : ''}`}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                <FileText className="w-12 h-12 opacity-20" />
              </div>
            )}

            {/* Processing Overlay */}
            {isProcessing && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/40 backdrop-blur-[2px] p-6 text-center">
                <div className="w-16 h-16 relative mb-4">
                  <div className="absolute inset-0 rounded-full border-4 border-primary/20"></div>
                  <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin"></div>
                </div>
                <h4 className="font-display font-bold text-foreground mb-1">{t("cv_card.ai_working")}</h4>
                <p className="text-sm text-primary font-medium animate-pulse">
                  {displayData.progress || t("cv_card.preparing_format")}
                </p>
              </div>
            )}

            {/* Failed Overlay */}
            {isFailed && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-destructive/10 backdrop-blur-sm p-6 text-center">
                <AlertCircle className="w-12 h-12 text-destructive mb-3" />
                <h4 className="font-display font-bold text-destructive mb-1">{t("cv_card.gen_error")}</h4>
                <p className="text-xs text-destructive/80 font-medium px-4 break-words">
                  {displayData.errorMessage || t("cv_card.gen_error_desc")}
                </p>
              </div>
            )}

            {/* Success Overlay */}
            {isComplete && (
              <div className="absolute inset-0 bg-background/80 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center">
                <div className="text-center">
                  <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
                  <p className="text-sm font-medium text-foreground">{t("cv_card.ready")}</p>
                </div>
              </div>
            )}
          </div>

          {/* Info Area */}
          <div className="p-4 lg:p-5 h-[110px] lg:h-[110px] flex flex-col justify-between bg-card">
            <div>
              <div className="flex justify-between items-start mb-2">
                <h3 className="font-display font-bold text-foreground line-clamp-1">{displayName}</h3>
                {/* Status Badge */}
                <div className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${isProcessing ? 'bg-amber-500/10 text-amber-600 border border-amber-500/20' :
                  isComplete ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20' :
                    'bg-red-500/10 text-red-600 border border-red-500/20'
                  }`}>
                  {isProcessing ? t("cv_card.processing") : displayData.status}
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-3">
                <Calendar className="w-3.5 h-3.5" />
                {format(new Date(cv.updatedAt || cv.createdAt), 'MMM d, yyyy, HH:mm')}
              </div>
              {isComplete && (
                <div className="flex items-center gap-1.5 text-xs text-primary mt-2">
                  <Eye className="w-3.5 h-3.5" />
                  {t("cv_card.click_to_view")}
                </div>
              )}
            </div>

            {/* Progress Text - TEMPORARILY HIDDEN */}
            {/* {isProcessing && (
              <div className="mt-2 text-xs text-muted-foreground text-center">
                <span className="block truncate" title={displayData.progress || t("cv_card.processing")}>
                  {displayData.progress || t("cv_card.processing")}
                </span>
              </div>
            )} */}
          </div>
        </div>
      </Link>
    </>
  );
}
