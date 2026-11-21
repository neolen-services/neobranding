import { useEffect, useState } from "react";
import { emptyBrandKit, type BrandKit } from "@shared/brand";
import { api } from "./api";
import { BrandForm } from "./BrandForm";
import { BrandView } from "./BrandView";

type Screen =
  | { name: "loading" }
  | { name: "error"; message: string }
  | { name: "onboarding" }
  | { name: "brand"; brand: BrandKit }
  | { name: "edit"; brand: BrandKit };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: "loading" });

  useEffect(() => {
    api
      .getBrand()
      .then((brand) => setScreen(brand ? { name: "brand", brand } : { name: "onboarding" }))
      .catch((e) => setScreen({ name: "error", message: String(e?.message ?? e) }));
  }, []);

  switch (screen.name) {
    case "loading":
      return null;
    case "error":
      return (
        <main className="mx-auto max-w-xl px-6 py-24">
          <h1 className="font-display text-2xl font-bold">Could not open your data</h1>
          <p className="mt-3 text-slate-600">{screen.message}</p>
        </main>
      );
    case "onboarding":
      return (
        <BrandForm
          mode="onboarding"
          initial={emptyBrandKit()}
          onSaved={(brand) => setScreen({ name: "brand", brand })}
        />
      );
    case "edit":
      return (
        <BrandForm
          mode="edit"
          initial={screen.brand}
          onSaved={(brand) => setScreen({ name: "brand", brand })}
          onCancel={() => setScreen({ name: "brand", brand: screen.brand })}
        />
      );
    case "brand":
      return (
        <BrandView brand={screen.brand} onEdit={() => setScreen({ name: "edit", brand: screen.brand })} />
      );
  }
}
