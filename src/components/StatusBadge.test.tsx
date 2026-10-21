import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "./ui";

describe("StatusBadge", () => {
  it("renders human-readable status labels", () => {
    render(<StatusBadge status="needs_login" />);
    expect(screen.getByText("Needs sign-in")).toBeInTheDocument();
  });

  it("renders a succeeded badge", () => {
    render(<StatusBadge status="succeeded" />);
    expect(screen.getByText("Succeeded")).toBeInTheDocument();
  });
});
