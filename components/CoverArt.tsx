import Image from "next/image";
import { coverArtUrl, type CoverArtRef } from "@/lib/listenbrainz/coverArt";

export function CoverArt({
  art,
  size = 64,
  alt,
  className = "",
}: {
  art: CoverArtRef;
  size?: number;
  alt: string;
  className?: string;
}) {
  const px = size <= 96 ? 250 : size <= 300 ? 500 : 1200;
  const url = coverArtUrl(art, px);

  // When the caller is sizing via className (w-full / aspect-square), the
  // inline pixel size would override and shove placeholders off-grid. Drop the
  // inline style in that case and let the parent dictate the box.
  const containerSized = /\b(w-full|h-full|aspect-square)\b/.test(className);

  if (!url) {
    return (
      <div
        className={`${containerSized ? "" : "shrink-0"} bg-gradient-to-br from-gray-200 to-gray-300 dark:from-zinc-800 dark:to-zinc-700 flex items-center justify-center text-subtle-foreground dark:text-gray-600 text-xs ${className}`}
        style={containerSized ? undefined : { width: size, height: size }}
        aria-label={alt}
      >
        ♪
      </div>
    );
  }
  return (
    <Image
      src={url}
      alt={alt}
      width={size}
      height={size}
      className={`shrink-0 bg-muted ${className}`}
      unoptimized
    />
  );
}
