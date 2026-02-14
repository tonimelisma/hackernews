import React from "react";
import { Virtuoso } from "react-virtuoso";
import Story from "./Story";

const StoryList = ({ stories, hidden, addHidden }) => {
  const filteredStories = hidden.length
    ? stories.filter((story) => !hidden.includes(story.id))
    : stories;

  if (filteredStories.length === 0) return null;

  return (
    <Virtuoso
      useWindowScroll
      data={filteredStories}
      itemContent={(index, story) => (
        <Story key={story.id} story={story} addHidden={addHidden} />
      )}
    />
  );
};
export default StoryList;
