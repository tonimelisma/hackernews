import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import App from "./App";

// Mock bootstrap JS to avoid JSDOM issues
jest.mock("bootstrap/dist/js/bootstrap.bundle.min", () => {});

// Mock services
jest.mock("./services/storyService");
jest.mock("./services/loginService");

import storyService from "./services/storyService";
import loginService from "./services/loginService";

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  storyService.getAll.mockResolvedValue({ data: [] });
  storyService.getHidden.mockResolvedValue({ data: [] });
});

describe("App", () => {
  it("renders navbar with title", async () => {
    render(<App />);
    expect(screen.getByText("Top Hacker News Stories")).toBeInTheDocument();
  });

  it("shows loading spinner while fetching", () => {
    // Never resolve the promise to keep loading state
    storyService.getAll.mockReturnValue(new Promise(() => {}));
    render(<App />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders stories after fetch completes", async () => {
    storyService.getAll.mockResolvedValue({
      data: [
        {
          id: 1,
          title: "Test Story",
          by: "author",
          score: 100,
          descendants: 50,
          time: new Date().toISOString(),
          url: "https://example.com",
        },
      ],
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Test Story")).toBeInTheDocument();
    });
  });

  it("fetches stories with Day timespan by default", async () => {
    render(<App />);

    await waitFor(() => {
      expect(storyService.getAll).toHaveBeenCalledWith("Day");
    });
  });

  it("changes timespan when button is clicked", async () => {
    render(<App />);

    await waitFor(() => {
      expect(storyService.getAll).toHaveBeenCalledWith("Day");
    });

    // Click one of the "Week" buttons (there may be multiple due to responsive design)
    const weekButtons = screen.getAllByText("Week");
    fireEvent.click(weekButtons[0]);

    await waitFor(() => {
      expect(storyService.getAll).toHaveBeenCalledWith("Week");
    });
  });

  it("loads token from localStorage on mount", async () => {
    window.localStorage.setItem("loginToken", "saved-token");
    storyService.getHidden.mockResolvedValue({ data: [1, 2, 3] });

    render(<App />);

    await waitFor(() => {
      expect(storyService.getHidden).toHaveBeenCalledWith("saved-token");
    });
  });

  it("does not fetch hidden when no token", async () => {
    render(<App />);

    await waitFor(() => {
      expect(storyService.getAll).toHaveBeenCalled();
    });

    expect(storyService.getHidden).not.toHaveBeenCalled();
  });

  it("renders timespan buttons", () => {
    render(<App />);

    expect(screen.getAllByText("Day").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Week").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Month").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Year").length).toBeGreaterThan(0);
    expect(screen.getAllByText("All").length).toBeGreaterThan(0);
  });
});
