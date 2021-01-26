import React from "react";
import Story from "./Story";

// story.by, descendants, score, time, title, url

const StoryList = ({ stories, hidden, addHidden }) => {
  const filterHiddenStories = (story) => !hidden.includes(story.id);
  const filteredStories = hidden.length
    ? stories.filter(filterHiddenStories)
    : stories;
  return filteredStories.map((story) => (
    <Story key={story.id} story={story} addHidden={addHidden} />
  ));
};
export default StoryList;
