import { useEffect, useRef, useState, type ReactNode } from "react";
import { emptyBrandKit, type BrandKit } from "@shared/brand";
import { useAgentChat } from "./agentChat";
import { AgentChatPanel, IconButton, type OpenReference, type ReferenceTarget } from "./AgentView";
import { api } from "./api";
import { BrandForm } from "./BrandForm";
import { BrandView } from "./BrandView";
import { Dashboard } from "./Dashboard";
import { IdeasView } from "./IdeasView";
import { ResearchView } from "./ResearchView";
import { SettingsView } from "./SettingsView";
import { UsageView } from "./UsageView";
import { CastView } from "./CastView";
import { OpenVideoContext, StudioView } from "./StudioView";
import { brandVars } from "./theme";

type Page = "dashboard" | "agent" | "brand" | "cast" | "ideas" | "edit" | "research" | "studio" | "usage" | "settings";

type Screen =
  | { name: "loading" }
  | { name: "error"; message: string }
  | { name: "onboarding" }
  | { name: Page; brand: BrandKit; /** A post or idea to open on arrival. */ focus?: string };

const PAGE_TITLES: Record<Page, string> = {
  dashboard: "Dashboard",
  agent: "Agent",
  brand: "Brand",
  ideas: "Ideas",
  edit: "Edit brand",
  research: "Research",
  studio: "Studio",
  cast: "Cast",
  usage: "Usage",
  settings: "Settings",
};

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: "loading" });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // The agent's chat lives here so it carries on across screens and in its floating window.
  const agent = useAgentChat();
  const [dockOpen, setDockOpen] = useState(false);
  /** The post or idea opened on the Research or Ideas page, so the agent can offer it first. */
  const [openItem, setOpenItem] = useState<ReferenceTarget | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  /** The screen to return to when the chat is popped out of the Agent page. */
  const lastPage = useRef<Page>("dashboard");

  useEffect(() => {
    api
      .getBrand()
      .then((brand) => setScreen(brand ? { name: "dashboard", brand } : { name: "onboarding" }))
      .catch((e) => setScreen({ name: "error", message: String(e?.message ?? e) }));
    // Start listening for links sent to the Telegram bot, if one is set up.
    void api.syncTelegram();
  }, []);

  // The agent can change the brand kit, so read it again whenever the agent has finished working.
  useEffect(() => {
    if (agent.revision === 0) return;
    void api.getBrand().then((fresh) => {
      if (fresh) setScreen((s) => ("brand" in s ? { ...s, brand: fresh } : s));
    });
  }, [agent.revision]);

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
  const go = (name: Page) => {
    if (page !== "agent") lastPage.current = page;
    if (name === "agent") void agent.checkKey();
    setScreen({ name, brand });
  };
  const onAgentPage = page === "agent";
  const openReference: OpenReference = (kind, id) => {
    if (page !== "agent") lastPage.current = page;
    if (kind === "brand") return setScreen({ name: "brand", brand });
    if (kind === "research" || kind === "ideas") return setScreen({ name: kind, brand });
    if (kind === "video" || kind === "series") return setScreen({ name: "studio", brand, focus: id });
    if (kind === "character") return setScreen({ name: "cast", brand });
    setScreen({ name: kind === "post" ? "research" : "ideas", brand, focus: id });
  };
  // What the page behind the chat shows, most specific first.
  const onScreen: ReferenceTarget[] =
    page === "research"
      ? [...(openItem?.kind === "post" ? [openItem] : []), { kind: "research", id: "all" }]
      : page === "ideas"
        ? [...(openItem?.kind === "idea" ? [openItem] : []), { kind: "ideas", id: "all" }]
        : page === "brand" || page === "edit"
          ? [{ kind: "brand", id: "kit" }]
          : [];
  const openDock = () => {
    void agent.checkKey();
    setDockOpen(true);
  };

  const navItem = (name: Page, label: string, icon: ReactNode) => {
    const current = page === name || (name === "brand" && page === "edit");
    return (
      <button
        type="button"
        aria-current={current ? "page" : undefined}
        onClick={() => go(name)}
        // When minimised only the icon shows, so the name moves to a tooltip.
        title={sidebarOpen ? undefined : label}
        aria-label={label}
        className={`flex w-full items-center gap-3 rounded-lg py-2 text-left text-sm font-medium ${
          sidebarOpen ? "px-3" : "justify-center"
        } ${current ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/5 hover:text-white"}`}
      >
        {icon}
        {sidebarOpen && label}
      </button>
    );
  };

  return (
    <div style={brandVars(brand)} className="flex h-full bg-[var(--frame)] text-[var(--ink)]">
      {/* The menu is either full width or minimised to a strip of icons. */}
      {
        <aside className={`flex shrink-0 flex-col text-white ${sidebarOpen ? "w-60 p-3" : "w-14 px-2 py-3"}`}>
          <div className={`flex items-center gap-2.5 py-3 ${sidebarOpen ? "px-3" : "justify-center"}`} title={brand.name}>
            <span className="h-3 w-3 shrink-0 rounded-full bg-[var(--accent)]" />
            {sidebarOpen && <span className="truncate font-display font-semibold">{brand.name}</span>}
          </div>

          <button
            type="button"
            onClick={() => go("ideas")}
            title={sidebarOpen ? undefined : "New ideas"}
            aria-label="New ideas"
            className={`mt-2 flex items-center gap-2.5 rounded-lg bg-[var(--ink)] py-2 text-sm font-semibold text-[var(--frame)] hover:opacity-90 ${
              sidebarOpen ? "px-3" : "justify-center"
            }`}
          >
            <Icon d="M12 5v14M5 12h14" />
            {sidebarOpen && "New ideas"}
          </button>

          <nav className="mt-4 space-y-1">
            {navItem("dashboard", "Dashboard", <Icon d="M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z" />)}
            {navItem("agent", "Agent", <Icon d="M5 4l14 8-6 2-2 6z" />)}
            {navItem("ideas", "Ideas", <Icon d="M4 5h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4zM17 10l4-2.5v9L17 14" />)}
            {navItem("research", "Research", <Icon d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" />)}
            {navItem("studio", "Studio", <Icon d="M4 9h16v10H4zM4 9l1.500-4 3 4 2-4 3 4 2-4 3 4" />)}
          </nav>

          {sidebarOpen ? (
            <p className="mt-6 px-3 text-xs font-medium text-white/40">Brand</p>
          ) : (
            <div className="mx-2 mt-4 border-t border-white/10" />
          )}
          <nav className="mt-2 space-y-1">
            {navItem("brand", "Brand kit", <Icon d="M12 3l2.5 5.5L20 9.3l-4 4 1 5.7-5-2.8-5 2.8 1-5.7-4-4 5.5-.8z" />)}
            {navItem("cast", "Cast", <Icon d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3 2.700-5 6-5s6 2 6 5M16 11a3 3 0 1 0 0-6M21 20c0-2.500-1.700-4.200-4-4.800" />)}
          </nav>

          <nav className="mt-auto space-y-1 border-t border-white/10 pt-3">
            {navItem("usage", "Usage", <Icon d="M4 20V11M10 20V4M16 20v-7M21 20H3" />)}
            {navItem(
              "settings",
              "Settings",
              <Icon d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4M14 4v4M6 10v4M12 16v4" />,
            )}
          </nav>
        </aside>
      }

      {/* The content sits on a rounded panel inset from the dark frame. */}
      <div className="flex min-w-0 flex-1 flex-col">
      <div className="m-2 mb-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-[var(--bg)]">
        <header className="flex shrink-0 items-center gap-3 border-b border-[var(--line)] bg-[var(--surface)] px-4 py-3">
          <button
            type="button"
            aria-label={sidebarOpen ? "Minimise menu" : "Expand menu"}
            title={sidebarOpen ? "Minimise menu" : "Expand menu"}
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="rounded-md p-1.5 hover:bg-[var(--tint)]"
          >
            <Icon d="M4 5h16v14H4zM9 5v14" />
          </button>
          <span className="h-4 w-px bg-[var(--line)]" />
          <h1 className="font-display font-semibold">{PAGE_TITLES[page]}</h1>
        </header>

        <OpenVideoContext.Provider value={(id) => setScreen({ name: "studio", brand, focus: id })}>
        <main className={`min-h-0 flex-1 ${page === "agent" ? "overflow-hidden" : "overflow-y-auto"}`}>
          {onAgentPage && (
            <AgentChatPanel
              chat={agent}
              variant="page"
              onOpenReference={openReference}
              onScreen={onScreen}
              onOpenSettings={() => go("settings")}
              actions={
                <IconButton
                  label="Open as a small window"
                  onClick={() => {
                    setDockOpen(true);
                    go(lastPage.current);
                  }}
                >
                  <path d="M4 5h16v14H4zM12 12h6v5h-6z" />
                </IconButton>
              }
            />
          )}
          {page === "dashboard" && (
            <Dashboard brand={brand} onOpenIdeas={() => go("ideas")} onOpenBrand={() => go("brand")} />
          )}
          {page === "brand" && (
            <BrandView
              brand={brand}
              onEdit={(section) => setScreen({ name: "edit", brand, focus: section === undefined ? undefined : String(section) })}
              onChange={(changed) => setScreen({ name: "brand", brand: changed })}
              onOpenSettings={() => go("settings")}
            />
          )}
          {page === "ideas" && (
            <IdeasView key={screen.focus} brand={brand} focusId={screen.focus} onOpenItem={(id) => setOpenItem(id ? { kind: "idea", id } : null)} onOpenSettings={() => go("settings")} onOpenResearch={() => go("research")} />
          )}
          {page === "research" && <ResearchView key={screen.focus} focusId={screen.focus} onOpenItem={(id) => setOpenItem(id ? { kind: "post", id } : null)} onOpenSettings={() => go("settings")} />}
          {page === "studio" && (
            <StudioView key={screen.focus} brand={brand} focusId={screen.focus} onOpenSettings={() => go("settings")} onOpenCast={() => go("cast")} />
          )}
          {page === "cast" && <CastView brand={brand} onOpenSettings={() => go("settings")} onOpenBrand={() => go("brand")} />}
          {page === "usage" && <UsageView />}
          {page === "settings" && <SettingsView />}
          {page === "edit" && (
            <BrandForm
              mode="edit"
              section={screen.focus === undefined ? undefined : Number(screen.focus)}
              initial={brand}
              onSaved={(saved) => setScreen({ name: "brand", brand: saved })}
              onCancel={() => go("brand")}
            />
          )}
        </main>
        </OpenVideoContext.Provider>
      </div>

        {/* The agent is one click away on every screen. */}
        <footer className="flex h-10 min-w-0 shrink-0 items-center justify-end gap-1 px-3">
          {/* One tab for each chat kept open; the newest are shown if there are many. */}
          {agent.tabs.slice(-4).map((tab) => {
            const showing = tab.id === agent.chatId && (dockOpen || onAgentPage);
            return (
              <button
                key={tab.id}
                type="button"
                title={tab.title}
                aria-pressed={showing}
                onClick={() => {
                  if (showing && !onAgentPage) return setDockOpen(false);
                  void agent.openChat(tab.id);
                  if (!onAgentPage) openDock();
                }}
                className={`flex min-w-0 max-w-[14rem] items-center gap-2 rounded-lg px-3 py-1 text-sm font-medium ${
                  showing ? "bg-white/10 text-white" : "text-white/55 hover:bg-white/5 hover:text-white"
                }`}
              >
                {(tab.running || tab.unread) && (
                  <span className={`h-2 w-2 shrink-0 rounded-full bg-[var(--accent)] ${tab.running ? "animate-pulse" : ""}`} />
                )}
                <span className="truncate">{tab.title || "Chat"}</span>
              </button>
            );
          })}
          <button
            type="button"
            title="Start a new chat with the agent"
            onClick={() => {
              agent.newChat();
              if (!onAgentPage) openDock();
            }}
            className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-1 text-sm font-medium text-white/85 hover:bg-white/5 hover:text-white"
          >
            <Icon d="M5 4l14 8-6 2-2 6z" />
            Agent
          </button>
          <div className="relative shrink-0">
            <button
              type="button"
              aria-label="Chat history"
              title="Chat history"
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen(!historyOpen)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-white/60 hover:bg-white/5 hover:text-white"
            >
              <Icon d="M4 12a8 8 0 1 0 2.5-5.800M4 4v4h4M12 8v4l3 2" />
            </button>
            {historyOpen && (
              <>
                {/* Clicking anywhere else closes the list. */}
                <div className="fixed inset-0 z-40" onClick={() => setHistoryOpen(false)} />
                <div className="absolute bottom-9 right-0 z-50 max-h-80 w-96 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1.5 text-[var(--ink)] shadow-2xl">
                  <p className="px-2.5 py-1.5 text-xs opacity-50">Chat history</p>
                  {agent.chats.length === 0 && <p className="px-2.5 py-2 text-sm opacity-60">No chats yet.</p>}
                  {agent.chats.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--tint)]"
                      onClick={() => {
                        setHistoryOpen(false);
                        void agent.openChat(c.id);
                        if (!onAgentPage) openDock();
                      }}
                    >
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          agent.runningIds.has(c.id) ? "animate-pulse bg-[var(--accent)]" : agent.unread.has(c.id) ? "bg-[var(--accent)]" : ""
                        }`}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.title}</span>
                      <span className="shrink-0 text-xs opacity-50">{agent.runningIds.has(c.id) ? "working" : timeAgo(c.updatedAt)}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </footer>
      </div>

      {dockOpen && !onAgentPage && (
        <div
          role="dialog"
          aria-label="Agent chat"
          className="fixed bottom-12 right-4 z-40 flex h-[min(640px,calc(100vh-5rem))] w-[440px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--bg)] shadow-2xl"
        >
          <AgentChatPanel
            chat={agent}
            variant="dock"
            onOpenReference={openReference}
              onScreen={onScreen}
            onOpenSettings={() => go("settings")}
            actions={
              <>
                <IconButton label="Minimise" onClick={() => setDockOpen(false)}>
                  <path d="M6 18h12" />
                </IconButton>
                <IconButton label="Open on the Agent page" onClick={() => { setDockOpen(false); go("agent"); }}>
                  <path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" />
                </IconButton>
                <IconButton
                  label="Close this chat"
                  onClick={() => {
                    setDockOpen(false);
                    // Takes it off the footer; it stays in the history.
                    agent.closeTab(agent.chatId);
                  }}
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </IconButton>
              </>
            }
          />
        </div>
      )}
    </div>
  );
}

/** "just now", "13min", "2h", "3d", then a date. */
function timeAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}min`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / (60 * 24))}d`;
  return new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });
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
