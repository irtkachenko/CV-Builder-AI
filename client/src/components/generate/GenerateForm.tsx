import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { FileUploadSection } from "./FileUploadSection";
import { GenerationControls } from "./GenerationControls";

interface GenerateFormProps {
  onSubmit: (e: React.FormEvent) => void;
  selectedFile: File | null;
  onFileSelect: (file: File) => void;
  onFileRemove: () => void;
  isPending?: boolean;
}

export function GenerateForm({
  onSubmit,
  selectedFile,
  onFileSelect,
  onFileRemove,
  isPending = false
}: GenerateFormProps) {
  const { t } = useTranslation();
  
  const [useGenerationPrompt, setUseGenerationPrompt] = useState(false);
  const [generationPrompt, setGenerationPrompt] = useState("");

  return (
    <div className="w-full md:w-3/5 p-4 sm:p-6 lg:p-8 flex flex-col max-h-[58vh] md:max-h-[85vh]">
      <div className="flex-1 overflow-y-auto pr-4 scrollbar-hide">
        <div className="mb-6 sm:mb-8">
          <h2 className="font-display font-bold text-lg sm:text-xl lg:text-2xl mb-2 text-foreground">
            {t("modal.import_content")}
          </h2>
          <p className="text-muted-foreground text-sm">
            <span className="hidden sm:inline">{t("modal.description")}</span>
            <span className="sm:hidden">{t("modal.description_mobile")}</span>
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 sm:space-y-6">
          <FileUploadSection
            selectedFile={selectedFile}
            onFileSelect={onFileSelect}
            onFileRemove={onFileRemove}
            disabled={isPending}
          />

          <GenerationControls
            useGenerationPrompt={useGenerationPrompt}
            generationPrompt={generationPrompt}
            onPromptToggle={setUseGenerationPrompt}
            onPromptChange={setGenerationPrompt}
            disabled={isPending}
          />

          <div className="pt-2 sm:pt-4">
            <button
              type="submit"
              disabled={isPending || !selectedFile}
              className="w-full relative flex items-center justify-center gap-2 px-4 sm:px-6 py-3 sm:py-4 rounded-xl font-bold text-white bg-gradient-to-r from-primary to-accent shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5 active:translate-y-0 active:shadow-md disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none transition-all duration-200 overflow-hidden group text-sm sm:text-base"
            >
              {/* Subtle shine effect */}
              <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent skew-x-12"></div>

              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
                  {t("modal.btn_magic")}
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
  );
}
