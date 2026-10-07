"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import type { Concert } from "@/lib/db/schema";

export type Editing =
  | { kind: "new-concert" } | { kind: "new-festival" }
  | { kind: "concert"; id: string } | { kind: "festival"; id: string }
  | { kind: "add-to-festival"; festivalId: string }
  | { kind: "from-setlist"; initial: Partial<Concert> };

type EditModeValue = {
  editMode: boolean;
  setEditMode: (v: boolean) => void;
  editing: Editing | null;
  setEditing: (e: Editing | null) => void;
  close: () => void;
};

const Ctx = createContext<EditModeValue | null>(null);

// Shared by the owner-only bar (which toggles it) and the public list (which
// only reads it). Visitors never render the bar, so editMode stays false.
export function ConcertsEditProvider({ children }: { children: React.ReactNode }) {
  const [editMode, setEditMode] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const router = useRouter();
  const close = useCallback(() => { setEditing(null); router.refresh(); }, [router]);
  return <Ctx.Provider value={{ editMode, setEditMode, editing, setEditing, close }}>{children}</Ctx.Provider>;
}

export function useEditMode(): EditModeValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useEditMode must be used inside <ConcertsEditProvider>");
  return v;
}
