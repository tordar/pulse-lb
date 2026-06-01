export default function SongsPage() {
  return <Placeholder title="Top Songs" />;
}

function Placeholder({ title }: { title: string }) {
  return (
    <div className="py-16 text-center text-gray-500">
      <p className="text-2xl font-semibold mb-2">{title}</p>
      <p className="text-sm">Coming in Phase 2 — paginated list with search, sort, and grid/list views.</p>
    </div>
  );
}
