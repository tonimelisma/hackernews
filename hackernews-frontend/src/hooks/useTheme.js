import { useEffect } from "react";

const useTheme = () => {
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const applyTheme = (e) => {
      document.documentElement.setAttribute(
        "data-bs-theme",
        e.matches ? "dark" : "light"
      );
    };

    applyTheme(mediaQuery);
    mediaQuery.addEventListener("change", applyTheme);

    return () => {
      mediaQuery.removeEventListener("change", applyTheme);
    };
  }, []);
};

export default useTheme;
