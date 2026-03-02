import { useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { X, Sparkles, Loader2, FileText, AlertCircle } from "lucide-react";
import { useGenerateCv } from "@/hooks/use-generate";
import { useToast } from "@/hooks/use-toast";
import { Dropzone } from "@/components/ui/dropzone";
import type { CvTemplate } from "@shared/routes";
import { DEFAULT_GENERATION_TEMPERATURE, MODEL_TEMPERATURE_MAX, MODEL_TEMPERATURE_MIN } from "@shared/config";
import { useTranslation } from "react-i18next";

interface GenerateModalProps {
  template: CvTemplate | null;
  isOpen: boolean;
  onClose: () => void;
}

export function GenerateModal({ template, isOpen, onClose }: GenerateModalProps) {
  const { t } = useTranslation();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [useGenerationPrompt, setUseGenerationPrompt] = useState(false);
  const [generationPrompt, setGenerationPrompt] = useState("");
  const [generationTemperature, setGenerationTemperature] = useState(DEFAULT_GENERATION_TEMPERATURE);

  const { mutate: generateCv, isPending } = useGenerateCv();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const handleClose = () => {
    setUseGenerationPrompt(false);
    setGenerationPrompt("");
    setGenerationTemperature(DEFAULT_GENERATION_TEMPERATURE);
    onClose();
  };

  if (!template || !isOpen) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedFile) {
      toast({
        title: t("modal.error_file_required"),
        description: t("modal.error_file_desc"),
        variant: "destructive",
      });
      return;
    }

    if (!template) {
      toast({
        title: t("modal.error_no_template"),
        description: t("modal.error_no_template_desc"),
        variant: "destructive",
      });
      return;
    }

    try {
      generateCv({
        templateId: template.id,
        file: selectedFile,
        generationPrompt: useGenerationPrompt ? generationPrompt : undefined,
        temperature: generationTemperature,
      }, {
        onSuccess: (response) => {
          toast({
            title: t("toast.gen_started_title"),
            description: t("toast.gen_started_desc"),
          });

          // Close modal and redirect to my-resumes
          handleClose();
          setLocation("/my-resumes");
        },
        onError: (error) => {
          toast({
            title: t("toast.gen_failed_title"),
            description: error instanceof Error ? error.message : t("toast.gen_failed_fallback"),
            variant: "destructive",
          });
        }
      });
    } catch (error) {
      toast({
        title: t("toast.gen_failed_title"),
        description: t("toast.gen_failed_fallback"),
        variant: "destructive",
      });
    }
  };

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
  };

  const handleFileRemove = () => {
    setSelectedFile(null);
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center px-2 sm:px-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={!isPending ? handleClose : undefined}
          className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        />

        {/* Modal Content */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="relative w-full max-w-2xl mx-2 sm:mx-4 bg-card rounded-2xl shadow-2xl border border-border/50 flex flex-col md:flex-row overflow-hidden max-h-[95vh] md:max-h-[85vh] my-auto"
        >
          {/* Close Button */}
          <button
            onClick={handleClose}
            disabled={isPending}
            className="absolute top-3 right-3 sm:top-4 sm:right-4 p-2 sm:p-3 bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20 rounded-full transition-colors z-10 disabled:opacity-50 touch-manipulation"
          >
            <X className="w-4 h-4 sm:w-5 sm:h-5 text-foreground" />
          </button>

          {/* Left: Template Preview */}
          <div className="w-full md:w-2/5 bg-secondary/50 p-3 sm:p-4 lg:p-6 flex flex-col items-center justify-center border-b md:border-b-0 md:border-r border-border">
            <h3 className="font-display font-bold text-sm sm:text-base lg:text-lg mb-2 sm:mb-3 lg:mb-4 text-center">{t("modal.selected_template")}</h3>
            <div className="relative w-full max-w-[160px] sm:max-w-[200px] lg:max-w-none aspect-[1/1.4] rounded-lg overflow-hidden shadow-lg border border-border/50 bg-white">
              <img
                src={template.screenshotUrl}
                alt={template.name}
                className="w-full h-full object-cover"
                onError={(e) => { e.currentTarget.src = 'https://images.unsplash.com/photo-1586281380349-632531db7ed4?w=400&q=80' }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end p-1.5 sm:p-2 lg:p-4">
                <span className="text-white font-medium text-xs sm:text-xs lg:text-sm">{template.name}</span>
              </div>
            </div>
          </div>

          {/* Right: Form */}
          <div className="w-full md:w-3/5 p-4 sm:p-6 lg:p-8 flex flex-col max-h-[58vh] md:max-h-[85vh]">
            <div className="flex-1 overflow-y-auto pr-3 custom-scrollbar">
              <div className="mb-6 sm:mb-8">
                <h2 className="font-display font-bold text-lg sm:text-xl lg:text-2xl mb-2 text-foreground">{t("modal.import_content")}</h2>
                <p className="text-muted-foreground text-sm">
                  <span className="hidden sm:inline">{t("modal.description")}</span>
                  <span className="sm:hidden">{t("modal.description_mobile")}</span>
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
              <div className="space-y-2">
                <label htmlFor="file-upload" className="block text-sm font-medium text-foreground">
                  {t("modal.upload_label")}
                </label>

                <Dropzone
                  onFileSelect={handleFileSelect}
                  selectedFile={selectedFile}
                  onFileRemove={handleFileRemove}
                  disabled={isPending || isValidating}
                  className="min-h-[120px] sm:min-h-[140px]"
                />

                <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground bg-primary/5 p-2 rounded-lg border border-primary/10">
                  <FileText className="w-3 h-3 text-primary" />
                  <span className="hidden sm:inline">{t("modal.upload_hint")}</span>
                  <span className="sm:hidden">{t("modal.upload_hint_mobile")}</span>
                </div>

                {selectedFile && (
                  <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground bg-blue-50 dark:bg-blue-950/20 p-2 rounded-lg border border-blue-200 dark:border-blue-800">
                    <AlertCircle className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                    <span className="hidden sm:inline">{t("modal.ai_processing")}</span>
                    <span className="sm:hidden">{t("modal.ai_processing_mobile")}</span>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="flex items-start gap-3 p-3 rounded-lg border border-border bg-secondary/40">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary disabled:opacity-50"
                    checked={useGenerationPrompt}
                    onChange={(e) => setUseGenerationPrompt(e.target.checked)}
                    disabled={isPending}
                  />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {t("modal.use_generation_prompt_label")}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t("modal.use_generation_prompt_hint")}
                    </p>
                  </div>
                </label>

                {useGenerationPrompt && (
                  <textarea
                    value={generationPrompt}
                    onChange={(e) => setGenerationPrompt(e.target.value)}
                    placeholder={t("modal.generation_prompt_placeholder")}
                    maxLength={600}
                    disabled={isPending}
                    className="w-full min-h-[90px] max-h-[180px] resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30"
                  />
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground">{t("modal.temperature_label")}</p>
                  <p className="text-xs text-muted-foreground">{generationTemperature.toFixed(2)}</p>
                </div>
                <input
                  type="range"
                  min={MODEL_TEMPERATURE_MIN}
                  max={MODEL_TEMPERATURE_MAX}
                  step={0.05}
                  value={generationTemperature}
                  onChange={(e) => setGenerationTemperature(Number(e.target.value))}
                  disabled={isPending}
                  className="w-full accent-primary"
                />
                <p className="text-xs text-muted-foreground">{t("modal.temperature_hint")}</p>
              </div>

              <div className="pt-2 sm:pt-4">
                <button
                  type="submit"
                  disabled={isPending || isValidating || !selectedFile}
                  className="w-full relative flex items-center justify-center gap-2 px-4 sm:px-6 py-3 sm:py-4 rounded-xl font-bold text-white bg-gradient-to-r from-primary to-accent shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5 active:translate-y-0 active:shadow-md disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none transition-all duration-200 overflow-hidden group text-sm sm:text-base"
                >
                  {/* Subtle shine effect */}
                  <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent skew-x-12"></div>

                  {isPending || isValidating ? (
                    <>
                      <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
                      {isValidating ? t("modal.btn_processing") : t("modal.btn_magic")}
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 sm:w-5 sm:h-5" />
                      <span className="hidden sm:inline">{t("modal.btn_generate")}</span>
                      <span className="sm:hidden">{t("modal.btn_generate_mobile")}</span>
                    </>
                  )}
                </button>
              </div>
              </form>
            </div>
          </div>
        </motion.div>
      </div>
      <style>{`
        .custom-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: rgba(0,0,0,0.25) transparent;
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: rgba(0,0,0,0.35);
          border-radius: 999px;
          border: 2px solid transparent;
          background-clip: padding-box;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background-color: rgba(0,0,0,0.45);
        }
      `}</style>
    </AnimatePresence>
  );
}
