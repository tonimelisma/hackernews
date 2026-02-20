import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import App from "./App";

// Mock react-virtuoso so all items render synchronously in tests
vi.mock("react-virtuoso", () => ({
  Virtuoso: ({ data, itemContent }) => (
    <div data-testid="virtuoso">
      {data.map((item, index) => itemContent(index, item))}
    </div>
  ),
}));

// Mock services
vi.mock("./services/storyService", () => ({
  default: {
    getAll: vi.fn(),
    getHidden: vi.fn(),
    addHidden: vi.fn(),
  },
}));
vi.mock("./services/loginService", () => ({
  default: {
    login: vi.fn(),
    logout: vi.fn(),
    getMe: vi.fn(),
  },
}));

import storyService from "./services/storyService";
import loginService from "./services/loginService";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  storyService.getAll.mockResolvedValue({ data: [] });
  storyService.getHidden.mockResolvedValue({ data: [] });
  loginService.getMe.mockRejectedValue(new Error("not logged in"));
});

describe("App", () => {
  it("renders navbar with title", async () => {
    render(<App />);
    expect(screen.getByText("Top Hacker News Stories")).toBeInTheDocument();
    await waitFor(() => {
      expect(storyService.getAll).toHaveBeenCalled();
    });
  });

  it("shows loading spinner while fetching", async () => {
    // Never resolve the promise to keep loading state
    storyService.getAll.mockReturnValue(new Promise(() => {}));
    render(<App />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    await waitFor(() => {
      expect(loginService.getMe).toHaveBeenCalled();
    });
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

  it("checks login state via getMe on mount", async () => {
    loginService.getMe.mockResolvedValue({ username: "saveduser" });
    storyService.getHidden.mockResolvedValue({ data: [1, 2, 3] });

    render(<App />);

    await waitFor(() => {
      expect(loginService.getMe).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(storyService.getHidden).toHaveBeenCalled();
    });
  });

  it("does not fetch hidden when not logged in", async () => {
    render(<App />);

    await waitFor(() => {
      expect(storyService.getAll).toHaveBeenCalled();
    });

    expect(storyService.getHidden).not.toHaveBeenCalled();
  });

  it("shows error alert when story fetch fails", async () => {
    storyService.getAll.mockRejectedValue(new Error("network error"));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Failed to load stories.")).toBeInTheDocument();
    });
  });

  it("clears error when timespan changes", async () => {
    storyService.getAll.mockRejectedValueOnce(new Error("network error"));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Failed to load stories.")).toBeInTheDocument();
    });

    // Now resolve successfully for next timespan
    storyService.getAll.mockResolvedValue({ data: [] });
    const weekButtons = screen.getAllByText("Week");
    fireEvent.click(weekButtons[0]);

    await waitFor(() => {
      expect(screen.queryByText("Failed to load stories.")).not.toBeInTheDocument();
    });
  });

  it("highlights active timespan button with btn-primary", async () => {
    render(<App />);

    await waitFor(() => {
      expect(storyService.getAll).toHaveBeenCalledWith("Day");
    });

    // Day buttons should have btn-primary (default timespan)
    const dayButtons = screen.getAllByText("Day");
    expect(dayButtons.some((btn) => btn.classList.contains("btn-primary"))).toBe(true);

    // Week buttons should have btn-light
    const weekButtons = screen.getAllByText("Week");
    expect(weekButtons.every((btn) => btn.classList.contains("btn-light") || !btn.classList.contains("btn-primary"))).toBe(true);

    // Click Week
    fireEvent.click(weekButtons[0]);

    await waitFor(() => {
      expect(storyService.getAll).toHaveBeenCalledWith("Week");
    });

    // Now Week should have btn-primary
    const updatedWeekButtons = screen.getAllByText("Week");
    expect(updatedWeekButtons.some((btn) => btn.classList.contains("btn-primary"))).toBe(true);
  });

  it("reverts hidden state when addHidden API call fails", async () => {
    loginService.getMe.mockResolvedValue({ username: "testuser" });
    storyService.getHidden.mockResolvedValue({ data: [] });
    storyService.addHidden.mockRejectedValue(new Error("server error"));
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

    // Wait for story to render
    await waitFor(() => {
      expect(screen.getByText("Test Story")).toBeInTheDocument();
    });

    // Click hide button
    const hideButton = screen.getByLabelText("Hide story");
    fireEvent.click(hideButton);

    // Story should be hidden immediately (optimistic)
    await waitFor(() => {
      expect(screen.queryByText("Test Story")).not.toBeInTheDocument();
    });

    // After API failure, story should reappear (rollback)
    await waitFor(() => {
      expect(screen.getByText("Test Story")).toBeInTheDocument();
    });
  });

  it("disables login button while login is in flight", async () => {
    let resolveLogin;
    loginService.login.mockReturnValue(new Promise((resolve) => { resolveLogin = resolve; }));

    render(<App />);

    await waitFor(() => {
      expect(storyService.getAll).toHaveBeenCalled();
    });

    // Open login dropdown and fill form
    const usernameInput = screen.getByLabelText("Username");
    const passwordInput = screen.getByLabelText("Password");
    fireEvent.change(usernameInput, { target: { value: "testuser" } });
    fireEvent.change(passwordInput, { target: { value: "pass" } });

    const loginButton = screen.getByRole("button", { name: /log/i });
    expect(loginButton).not.toBeDisabled();

    // Submit form
    fireEvent.click(loginButton);

    // Button should be disabled while request is in flight
    await waitFor(() => {
      expect(loginButton).toBeDisabled();
    });
    expect(loginButton).toHaveTextContent("Logging in");

    // Resolve login — component transitions to logged-in state (form disappears)
    resolveLogin({ username: "testuser" });
    await waitFor(() => {
      expect(screen.getByText(/Logged in as/)).toBeInTheDocument();
    });
  });

  it("renders timespan buttons", async () => {
    render(<App />);

    expect(screen.getAllByText("Day").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Week").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Month").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Year").length).toBeGreaterThan(0);
    expect(screen.getAllByText("All").length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(storyService.getAll).toHaveBeenCalled();
    });
  });

  it("shows spinner until hidden state is loaded for logged-in users", async () => {
    let resolveHidden;
    loginService.getMe.mockResolvedValue({ username: "testuser" });
    storyService.getHidden.mockReturnValue(new Promise((resolve) => { resolveHidden = resolve; }));
    storyService.getAll.mockResolvedValue({
      data: [{ id: 1, title: "Story 1", by: "a", score: 100, descendants: 10, time: new Date().toISOString(), url: "https://example.com" }],
    });

    render(<App />);

    // Spinner should show while waiting for hidden
    await waitFor(() => {
      expect(storyService.getHidden).toHaveBeenCalled();
    });
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    // Resolve hidden — stories should appear
    resolveHidden({ data: [] });
    await waitFor(() => {
      expect(screen.getByText("Story 1")).toBeInTheDocument();
    });
  });

  it("loads hidden from localStorage on mount", async () => {
    localStorage.setItem("hiddenStories", JSON.stringify([42, 99]));
    storyService.getAll.mockResolvedValue({
      data: [
        { id: 42, title: "Hidden Story", by: "a", score: 100, descendants: 10, time: new Date().toISOString(), url: "https://example.com/1" },
        { id: 1, title: "Visible Story", by: "b", score: 200, descendants: 20, time: new Date().toISOString(), url: "https://example.com/2" },
      ],
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Visible Story")).toBeInTheDocument();
    });
    expect(screen.queryByText("Hidden Story")).not.toBeInTheDocument();
  });

  it("persists hidden to localStorage when hiding a story", async () => {
    storyService.getAll.mockResolvedValue({
      data: [{ id: 7, title: "Test Story", by: "a", score: 100, descendants: 10, time: new Date().toISOString(), url: "https://example.com" }],
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Test Story")).toBeInTheDocument();
    });

    const hideButton = screen.getByLabelText("Hide story");
    fireEvent.click(hideButton);

    await waitFor(() => {
      expect(screen.queryByText("Test Story")).not.toBeInTheDocument();
    });
    expect(JSON.parse(localStorage.getItem("hiddenStories"))).toContain(7);
  });

  it("merges server and localStorage hidden on login", async () => {
    localStorage.setItem("hiddenStories", JSON.stringify([1, 2]));
    loginService.getMe.mockResolvedValue({ username: "testuser" });
    storyService.getHidden.mockResolvedValue({ data: [2, 3] });
    storyService.getAll.mockResolvedValue({ data: [] });

    render(<App />);

    await waitFor(() => {
      expect(storyService.getHidden).toHaveBeenCalled();
    });

    // Merged hidden should contain 1, 2, 3
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem("hiddenStories"));
      expect(saved).toEqual(expect.arrayContaining([1, 2, 3]));
      expect(saved).toHaveLength(3);
    });
  });

  it("syncs localStorage-only hidden IDs to server on login", async () => {
    localStorage.setItem("hiddenStories", JSON.stringify([1, 2]));
    loginService.getMe.mockResolvedValue({ username: "testuser" });
    storyService.getHidden.mockResolvedValue({ data: [2, 3] });
    storyService.addHidden.mockResolvedValue({});
    storyService.getAll.mockResolvedValue({ data: [] });

    render(<App />);

    // ID 1 is in localStorage but not on server — should be POSTed
    await waitFor(() => {
      expect(storyService.addHidden).toHaveBeenCalledWith(1);
    });
    // ID 2 is on both server and localStorage — should NOT be POSTed
    expect(storyService.addHidden).not.toHaveBeenCalledWith(2);
    // ID 3 is on server only — should NOT be POSTed
    expect(storyService.addHidden).not.toHaveBeenCalledWith(3);
  });

  it("restores saved timespan from localStorage on load", async () => {
    localStorage.setItem("timespan", JSON.stringify({ value: "Week", timestamp: Date.now() }));

    render(<App />);

    await waitFor(() => {
      expect(storyService.getAll).toHaveBeenCalledWith("Week");
    });
    // Week button should be highlighted
    const weekButtons = screen.getAllByText("Week");
    expect(weekButtons.some((btn) => btn.classList.contains("btn-primary"))).toBe(true);
  });

  it("defaults to Day when localStorage timespan is empty", async () => {
    render(<App />);

    await waitFor(() => {
      expect(storyService.getAll).toHaveBeenCalledWith("Day");
    });
  });

  it("defaults to Day when saved timespan is older than 3 hours", async () => {
    const fourHoursAgo = Date.now() - 4 * 60 * 60 * 1000;
    localStorage.setItem("timespan", JSON.stringify({ value: "Year", timestamp: fourHoursAgo }));

    render(<App />);

    await waitFor(() => {
      expect(storyService.getAll).toHaveBeenCalledWith("Day");
    });
  });

  it("saves timespan to localStorage when changed", async () => {
    render(<App />);

    await waitFor(() => {
      expect(storyService.getAll).toHaveBeenCalledWith("Day");
    });

    const weekButtons = screen.getAllByText("Week");
    fireEvent.click(weekButtons[0]);

    await waitFor(() => {
      expect(storyService.getAll).toHaveBeenCalledWith("Week");
    });

    const saved = JSON.parse(localStorage.getItem("timespan"));
    expect(saved.value).toBe("Week");
    expect(saved.timestamp).toBeGreaterThan(0);
  });
});
