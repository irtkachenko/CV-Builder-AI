import { useEffect, useState } from "react";

type SmartImageProps = {
  src: string;
  alt: string;
  className?: string;
  fallbackSrc?: string;
  imgClassName?: string;
};

const DEFAULT_FALLBACK =
  "https://images.unsplash.com/photo-1586281380349-632531db7ed4?w=400&q=80";

export function SmartImage({
  src,
  alt,
  className = "",
  imgClassName = "",
  fallbackSrc = DEFAULT_FALLBACK,
}: SmartImageProps) {
  const [currentSrc, setCurrentSrc] = useState(src);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setCurrentSrc(src);
    setIsLoaded(false);
  }, [src]);

  return (
    <div className={`relative w-full h-full overflow-hidden ${className}`}>
      {!isLoaded && (
        <div className="absolute inset-0 z-10 overflow-hidden bg-muted/70">
          <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-muted/30 via-muted/70 to-muted/30" />
        </div>
      )}

      <img
        src={currentSrc}
        alt={alt}
        loading="lazy"
        onLoad={() => setIsLoaded(true)}
        onError={(e) => {
          if (currentSrc === fallbackSrc) {
            setIsLoaded(true);
            return;
          }
          setCurrentSrc(fallbackSrc);
          e.currentTarget.src = fallbackSrc;
        }}
        className={`w-full h-full object-cover transition-opacity duration-300 ${isLoaded ? "opacity-100" : "opacity-0"} ${imgClassName}`}
      />
    </div>
  );
}
