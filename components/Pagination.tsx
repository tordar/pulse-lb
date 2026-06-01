import Link from "next/link";

export function Pagination({
  basePath,
  searchParams,
  page,
  hasMore,
}: {
  basePath: string;
  searchParams: Record<string, string | undefined>;
  page: number;
  hasMore: boolean;
}) {
  const mkUrl = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) if (v && k !== "page") sp.set(k, v);
    if (p > 0) sp.set("page", String(p));
    return `${basePath}${sp.toString() ? `?${sp}` : ""}`;
  };

  return (
    <div className="flex items-center justify-between text-sm pt-4">
      {page > 0 ? (
        <Link href={mkUrl(page - 1)} className="px-3 py-1.5 border border-gray-300 dark:border-gray-700 rounded hover:bg-gray-100 dark:hover:bg-zinc-900">
          ← Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-gray-500">Page {page + 1}</span>
      {hasMore ? (
        <Link href={mkUrl(page + 1)} className="px-3 py-1.5 border border-gray-300 dark:border-gray-700 rounded hover:bg-gray-100 dark:hover:bg-zinc-900">
          Next →
        </Link>
      ) : (
        <span />
      )}
    </div>
  );
}
