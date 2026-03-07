import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useGenerateCv } from "@/hooks/use-generate";
import { useToast } from "@/hooks/use-toast";
import { TemplatePreview } from "./generate/TemplatePreview";
import { GenerateForm } from "./generate/GenerateForm";
import { useTranslation } from "react-i18next";
import type { CvTemplate } from "@shared/routes";

interface GenerateModalProps {
  template: CvTemplate | null;
  isOpen: boolean;
  onClose: () => void;
}

export function GenerateModal({ template, isOpen, onClose }: GenerateModalProps) {
  const { t } = useTranslation();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [generationPrompt, setGenerationPrompt] = useState("");

  const { mutate: generateCv, isPending } = useGenerateCv();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const handleClose = () => {
    setSelectedFile(null);
    setGenerationPrompt("");
    onClose();
  };

  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen]);

  if (!template || !isOpen) {
    return null;
  }

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
  };

  const handleFileRemove = () => {
    setSelectedFile(null);
  };

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

    try {
      generateCv({
        templateId: template.id,
        file: selectedFile,
        generationPrompt: generationPrompt.trim() || undefined,
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
          <TemplatePreview template={template} />

          {/* Right: Form */}
          <GenerateForm
            onSubmit={handleSubmit}
            selectedFile={selectedFile}
            onFileSelect={handleFileSelect}
            onFileRemove={handleFileRemove}
            isPending={isPending}
          />
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
