import { useState } from "react";
import { useTemplates } from "@/hooks/use-templates";
import { GenerateModal } from "@/components/GenerateModal";
import { Navbar } from "@/components/layout/Navbar";
import { motion } from "framer-motion";
import { Loader2, Plus } from "lucide-react";
import type { CvTemplate } from "@shared/routes";
import { useTranslation } from "react-i18next";
import { SmartImage } from "@/components/ui/smart-image";

export default function GalleryPage() {
  const { t } = useTranslation();
  const { data: templates, isLoading, error } = useTemplates();
  const [selectedTemplate, setSelectedTemplate] = useState<CvTemplate | null>(null);

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 }
  };

  return (
    <div className="min-h-screen bg-mesh pb-20 pt-24">
      <Navbar />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        <div className="mb-10 text-center max-w-2xl mx-auto">
          <h1 className="font-display text-4xl font-bold text-foreground mb-4">{t("gallery.title")}</h1>
          <p className="text-muted-foreground text-lg">
            {t("gallery.description")}
          </p>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="w-10 h-10 animate-spin text-primary mb-4" />
            <p className="text-muted-foreground font-medium">{t("gallery.loading")}</p>
          </div>
        ) : error ? (
          <div className="bg-destructive/10 border border-destructive/20 text-destructive p-6 rounded-xl text-center max-w-md mx-auto">
            <p className="font-bold">{t("gallery.error")}</p>
            <p className="text-sm mt-1">{t("common.refresh")}</p>
          </div>
        ) : (
          <motion.div
            variants={container}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8"
          >
            {templates?.map((template) => (
              <motion.div
                key={template.id}
                variants={item}
                className="group relative glass-card rounded-2xl overflow-hidden flex flex-col hover:shadow-2xl hover:shadow-primary/10 transition-all duration-300 hover:-translate-y-1"
              >
                {/* Preview Image */}
                <div className="relative aspect-[1/1.4] w-full bg-secondary overflow-hidden">
                  <SmartImage
                    src={template.screenshotUrl}
                    alt={template.name}
                    imgClassName="transition-transform duration-500 group-hover:scale-105"
                  />

                  {/* Overlay on Hover */}
                  <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center z-10">
                    <button
                      onClick={() => setSelectedTemplate(template)}
                      className="flex items-center gap-2 px-6 py-3 rounded-full font-bold text-white bg-primary shadow-lg hover:bg-primary/90 hover:scale-105 transition-all transform translate-y-4 group-hover:translate-y-0"
                    >
                      <Plus className="w-5 h-5" />
                      {t("gallery.use_template")}
                    </button>
                  </div>
                </div>

                {/* Template Info */}
                <div className="p-5 bg-card relative z-20">
                  <h3 className="font-display font-bold text-lg text-foreground mb-1">{template.name}</h3>
                  {template.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">{template.description}</p>
                  )}
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </main>

      <GenerateModal
        template={selectedTemplate}
        isOpen={!!selectedTemplate}
        onClose={() => setSelectedTemplate(null)}
      />
    </div>
  );
}
