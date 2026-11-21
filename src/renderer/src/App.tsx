import { useEffect, useState, type ReactNode } from "react";
import { emptyBrandKit, type BrandKit } from "@shared/brand";
import { api } from "./api";
import { BrandForm } from "./BrandForm";
import { BrandView } from "./BrandView";
import { Dashboard } from "./Dashboard";
import { IdeasView } from "./IdeasView";
import { SettingsView } from "./SettingsView";
import { brandVars } from "./theme";

type Page = "dashboard" | "brand" | "ideas" | "edit" | "settings";

type Screen =
  | { name: "loading" }
  | { name: "error"; message: string }
  | { name: "onboarding" }
  | { name: Page; brand: BrandKit };

const PAGE_TITLES: Record<Page, string> = {
  dashboard: "Dashboard",
  brand: "Brand",
  ideas: "Video ideas",
  edit: "Edit brand",
  settings: "Settings",
};

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: "loading" });
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    api
      .getBrand()
      .then((brand) => setScreen(brand ? { name: "dashboard", brand } : { name: "onboarding" }))
      .catch((e) => setScreen({ name: "error", message: String(e?.message ?? e) }));
  }, []);

  if (screen.name === "loading") return null;

  if (screen.name === "error") {
    return (
      <main className="mx-auto max-w-xl px-6 py-24">
        <h1 className="font-display text-2xl font-bold">Could not open your data</h1>
        <p className="mt-3 opacity-70">{screen.message}</p>
      </main>
    );
  }

  if (screen.name === "onboarding") {
    return (
      // No brand exists yet, so onboarding is themed with the starter palette.
      <div style={brandVars(emptyBrandKit())} className="min-h-full bg-[var(--bg)] text-[var(--ink)]">
        <BrandForm
          mode="onboarding"
          initial={emptyBrandKit()}
          onSaved={(brand) => setScreen({ name: "dashboard", brand })}
        />
      </div>
    );
  }

  const { brand, name: page } = screen;
  const go = (name: Page) => setScreen({ name, brand });

  const navItem = (name: Page, label: string, icon: ReactNode) => {
    const current = page === name || (name === "brand" && page === "edit");
    return (
      <button
        type="button"
        aria-current={current ? "page" : undefined}
        onClick={() => go(name)}
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium ${
          current ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/5 hover:text-white"
        }`}
      >
        {icon}
        {label}
      </button>
    );
  };

  return (
    <div style={brandVars(brand)} className="flex h-full bg-[var(--frame)] text-[var(--ink)]">
      {sidebarOpen && (
        <aside className="flex w-60 shrink-0 flex-col p-3 text-white">
          <div className="flex items-center gap-2.5 px-3 py-3">
            <span className="h-3 w-3 rounded-full bg-[var(--accent)]" />
            <span className="truncate font-display font-semibold">{brand.name}</span>
          </div>

          <button
            type="button"
            onClick={() => go("ideas")}
            className="mt-2 flex items-center gap-2.5 rounded-lg bg-[var(--ink)] px-3 py-2 text-sm font-semibold text-[var(--frame)] hover:opacity-90"
          >
            <Icon d="M12 5v14M5 12h14" />
            New video ideas
          </button>

          <nav className="mt-4 space-y-1">
            {navItem("dashboard", "Dashboard", <Icon d="M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z" />)}
            {navItem("ideas", "Video ideas", <Icon d="M4 5h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4zM17 10l4-2.5v9L17 14" />)}
          </nav>

          <p className="mt-6 px-3 text-xs font-medium text-white/40">Brand</p>
          <nav className="mt-2 space-y-1">
            {navItem("brand", "Brand kit", <Icon d="M12 3l2.5 5.5L20 9.3l-4 4 1 5.7-5-2.8-5 2.8 1-5.7-4-4 5.5-.8z" />)}
          </nav>

          <nav className="mt-auto space-y-1 border-t border-white/10 pt-3">
            {navItem(
              "settings",
              "Settings",
              <Icon d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4M14 4v4M6 10v4M12 16v4" />,
            )}
          </nav>
        </aside>
      )}

      {/* The content sits on a rounded panel inset from the dark frame. */}
      <div className="m-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-[var(--bg)]">
        <header className="flex shrink-0 items-center gap-3 border-b border-[var(--line)] bg-[var(--surface)] px-4 py-3">
          <button
            type="button"
            aria-label={sidebarOpen ? "Hide menu" : "Show menu"}
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="rounded-md p-1.5 hover:bg-[var(--tint)]"
          >
            <Icon d="M4 5h16v14H4zM9 5v14" />
          </button>
          <span className="h-4 w-px bg-[var(--line)]" />
          <h1 className="font-display font-semibold">{PAGE_TITLES[page]}</h1>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          {page === "dashboard" && (
            <Dashboard brand={brand} onOpenIdeas={() => go("ideas")} onOpenBrand={() => go("brand")} />
          )}
          {page === "brand" && <BrandView brand={brand} onEdit={() => go("edit")} />}
          {page === "ideas" && <IdeasView brand={brand} onOpenSettings={() => go("settings")} />}
          {page === "settings" && <SettingsView />}
          {page === "edit" && (
            <BrandForm
              mode="edit"
              initial={brand}
              onSaved={(saved) => setScreen({ name: "brand", brand: saved })}
              onCancel={() => go("brand")}
            />
          )}
        </main>
      </div>
    </div>
  );
}

/** A 20px line icon drawn from a single path. */
function Icon({ d }: { d: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0"
    >
      <path d={d} />
    </svg>
  );
}
