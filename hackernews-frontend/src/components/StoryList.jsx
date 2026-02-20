import React from "react";
import { Virtuoso } from "react-virtuoso";
import Story from "./Story";

const StoryList = ({ stories, addHidden }) => {
  if (stories.length === 0) return null;

  return (
    <Virtuoso
      useWindowScroll
      data={stories}
      itemContent={(index, story) => (
        <Story key={story.id} story={story} addHidden={addHidden} />
      )}
    />
  );
};
export default StoryList;
