import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import Story from "./Story";

// Mock moment to return consistent output
jest.mock("moment", () => {
  const mockMoment = () => ({
    fromNow: () => "2 hours ago",
  });
  return {
    __esModule: true,
    default: mockMoment,
  };
});

const mockStory = {
  id: 12345,
  title: "Test Story Title",
  by: "testauthor",
  score: 150,
  descendants: 42,
  time: "2024-01-01T00:00:00.000Z",
  url: "https://example.com/article",
};

describe("Story", () => {
  const mockAddHidden = jest.fn();

  beforeEach(() => {
    mockAddHidden.mockClear();
  });

  it("renders title as a link", () => {
    render(<Story story={mockStory} addHidden={mockAddHidden} />);

    const link = screen.getByText("Test Story Title");
    expect(link).toBeInTheDocument();
    expect(link.closest("a")).toHaveAttribute(
      "href",
      "https://example.com/article"
    );
  });

  it("renders author name", () => {
    render(<Story story={mockStory} addHidden={mockAddHidden} />);
    // Author text is inside a <small> element mixed with other content
    expect(screen.getByText(/testauthor/)).toBeInTheDocument();
  });

  it("renders score", () => {
    render(<Story story={mockStory} addHidden={mockAddHidden} />);
    expect(screen.getByText(/150/)).toBeInTheDocument();
  });

  it("renders comment count", () => {
    render(<Story story={mockStory} addHidden={mockAddHidden} />);
    expect(screen.getByText(/42/)).toBeInTheDocument();
  });

  it("renders time using moment fromNow", () => {
    render(<Story story={mockStory} addHidden={mockAddHidden} />);
    expect(screen.getByText(/2 hours ago/)).toBeInTheDocument();
  });

  it("renders HN discussion link", () => {
    render(<Story story={mockStory} addHidden={mockAddHidden} />);

    const links = document.querySelectorAll("a");
    const hnLink = Array.from(links).find((a) =>
      a.href.includes("news.ycombinator.com")
    );
    expect(hnLink).toBeTruthy();
    expect(hnLink.href).toBe("https://news.ycombinator.com/item?id=12345");
  });

  it("calls addHidden when hide button is clicked", () => {
    render(<Story story={mockStory} addHidden={mockAddHidden} />);

    const hideButton = screen.getByRole("button", { name: "Hide story" });
    fireEvent.click(hideButton);

    expect(mockAddHidden).toHaveBeenCalledWith(12345);
  });

  it("renders favicon from story URL domain", () => {
    render(<Story story={mockStory} addHidden={mockAddHidden} />);

    const favicon = screen.getByAltText("favicon");
    expect(favicon).toBeInTheDocument();
    expect(favicon.src).toContain("google.com/s2/favicons");
    expect(favicon.src).toContain("example.com");
  });

  it("does not render javascript: URL as clickable link", () => {
    jest.spyOn(console, "log").mockImplementation(() => {});
    const xssStory = { ...mockStory, url: "javascript:alert(1)" };
    render(<Story story={xssStory} addHidden={mockAddHidden} />);

    const title = screen.getByText("Test Story Title");
    expect(title.closest("a")).toBeNull();
    expect(title.closest("span")).toBeInTheDocument();
    console.log.mockRestore();
  });

  it("renders valid https URL as clickable link", () => {
    render(<Story story={mockStory} addHidden={mockAddHidden} />);

    const title = screen.getByText("Test Story Title");
    expect(title.closest("a")).toHaveAttribute("href", "https://example.com/article");
  });

  it("renders HN favicon when story has no URL", () => {
    jest.spyOn(console, "log").mockImplementation(() => {});
    const storyNoUrl = { ...mockStory, url: undefined };
    render(<Story story={storyNoUrl} addHidden={mockAddHidden} />);

    const favicon = screen.getByAltText("favicon");
    expect(favicon.src).toContain("news.ycombinator.com");
    console.log.mockRestore();
  });
});
