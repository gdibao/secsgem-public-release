(() => {
  "use strict";
  const storageKey = "chituo-theme";
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const allowed = new Set(["light", "dark", "system"]);
  const getMode = () => {
    try {
      const value = localStorage.getItem(storageKey);
      return allowed.has(value) ? value : "system";
    } catch {
      return "system";
    }
  };
  const apply = (mode) => {
    const effective =
      mode === "system" ? (media.matches ? "dark" : "light") : mode;
    document.documentElement.dataset.themeMode = mode;
    document.documentElement.dataset.theme = effective;
    document.querySelectorAll("[data-theme-value]").forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.themeValue === mode),
      );
    });
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", effective === "dark" ? "#101820" : "#086da8");
  };
  document.addEventListener("DOMContentLoaded", () => {
    apply(getMode());
    document.querySelectorAll("[data-theme-value]").forEach((button) => {
      button.addEventListener("click", () => {
        const mode = button.dataset.themeValue;
        if (!allowed.has(mode)) return;
        try {
          localStorage.setItem(storageKey, mode);
        } catch {
          /* Preferences still apply for this page. */
        }
        apply(mode);
      });
    });
  });
  media.addEventListener?.("change", () => {
    if (getMode() === "system") apply("system");
  });
})();
