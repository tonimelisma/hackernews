import React from "react";
import { render, screen } from "@testing-library/react";
import StoryList from "./StoryList";

// Mock Story component for isolation
vi.mock("./Story", () => ({
  default: function MockStory({ story }) {
    return <div data-testid={`story-${story.id}`}>{story.title}</div>;
  },
}));

const mockStories = [
  { id: 1, title: "Story 1", by: "a", score: 100, descendants: 10, time: new Date().toISOString(), url: "https://example.com/1" },
  { id: 2, title: "Story 2", by: "b", score: 200, descendants: 20, time: new Date().toISOString(), url: "https://example.com/2" },
  { id: 3, title: "Story 3", by: "c", score: 300, descendants: 30, time: new Date().toISOString(), url: "https://example.com/3" },
];

describe("StoryList", () => {
  it("renders all stories when no hidden", () => {
    render(<StoryList stories={mockStories} hidden={[]} addHidden={() => {}} />);

    expect(screen.getByTestId("story-1")).toBeInTheDocument();
    expect(screen.getByTestId("story-2")).toBeInTheDocument();
    expect(screen.getByTestId("story-3")).toBeInTheDocument();
  });

  it("filters out hidden stories", () => {
    render(<StoryList stories={mockStories} hidden={[2]} addHidden={() => {}} />);

    expect(screen.getByTestId("story-1")).toBeInTheDocument();
    expect(screen.queryByTestId("story-2")).not.toBeInTheDocument();
    expect(screen.getByTestId("story-3")).toBeInTheDocument();
  });

  it("renders empty when all stories are hidden", () => {
    const { container } = render(
      <StoryList stories={mockStories} hidden={[1, 2, 3]} addHidden={() => {}} />
    );

    expect(container.innerHTML).toBe("");
  });

  it("renders empty for empty stories array", () => {
    const { container } = render(
      <StoryList stories={[]} hidden={[]} addHidden={() => {}} />
    );

    expect(container.innerHTML).toBe("");
  });
});
