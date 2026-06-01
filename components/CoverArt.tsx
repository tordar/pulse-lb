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

  if (!url) {
    return (
      <div
        className={`shrink-0 bg-gradient-to-br from-gray-200 to-gray-300 dark:from-zinc-800 dark:to-zinc-700 flex items-center justify-center text-gray-400 dark:text-gray-600 text-xs ${className}`}
        style={{ width: size, height: size }}
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
      className={`shrink-0 bg-gray-100 dark:bg-zinc-900 ${className}`}
      unoptimized
    />
  );
}
