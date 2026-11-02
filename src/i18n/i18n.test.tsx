import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { I18nProvider, useI18n } from "./index";

function Probe() {
  const { language, setLanguage, t } = useI18n();
  return (
    <div>
      <span>{language}</span>
      <span>{t("common.save", "Save")}</span>
      <button type="button" onClick={() => setLanguage(language === "en" ? "id" : "en")}>
        switch
      </button>
    </div>
  );
}

describe("i18n provider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.lang = "";
  });

  it("defaults to English and switches to Indonesian instantly", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );

    expect(screen.getByText("en")).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "switch" }));

    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("Simpan")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("id");
    expect(window.localStorage.getItem("bits.language")).toBe("id");
  });
});
