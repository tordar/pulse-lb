import Link from "next/link";
import { UserNav } from "./UserNav";

export default async function UserLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;

  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-6xl mx-auto px-6 pt-4">
          <div className="flex items-baseline gap-3 mb-3">
            <Link href="/" className="text-sm text-gray-500 hover:text-gray-900 dark:hover:text-gray-100">
              ← pulse
            </Link>
            <h1 className="text-2xl font-bold">{username}</h1>
          </div>
          <UserNav username={username} />
        </div>
      </header>
      <div className="max-w-6xl mx-auto px-6 py-6">{children}</div>
    </div>
  );
}
